# Architecture — the investigation loop and the Jev seam

**Status:** Draft (nothing built against it yet)
**Date:** 2026-09-28
**Scope:** How Vibe Guru goes from "this route leaks" to "this line leaks", and the exact
object handed to a decision model at each step.

---

## 1. Why this exists

One pass produces facts with no explanation:

```
/charts retains ~178.8KB of JS heap per visit
/charts retains 5 event listeners per visit
/charts retains 2 MutationObserver instances per visit
```

Three findings, almost certainly **one bug**: `chart.destroy()` is never called. The tool
cannot say that, so the fix advice degrades to a list of things to go look for.

The loop below turns a single survey into an investigation: probe, compare against what
was expected, form a narrower question, probe again. Each additional measurement narrows
**where**, never **how confident** — the numbers stay deterministic, and no model is ever
placed between evidence and a finding.

Two rules that follow from that, and that everything here is shaped by:

1. **The detector establishes what is true. The policy decides what to do about it.**
   Never ask a model a question the filesystem answers. `docker-compose.yml` exists or it
   does not; that is a file read, not a decision.
2. **The policy sees summaries, never raw evidence.** A run produces 44+ samples. Sending
   those to a model per decision would cost more than the browser driving this product
   exists to replace.

---

## 2. The loop

```
PASS 0  survey          full run, all routes, cheap probes
           ↓            findings → symptoms worth investigating
PASS 1..N narrow        for each symptom, in severity order:
                          state  = build(symptom, evidence so far)
                          action = Policy.next_step(state)
                          run the probe it names, focused
                          re-analyze → update hypotheses
                          until conclude | abandon | budget
           ↓
SYNTHESIS               group findings by settled cause → report
```

One `Investigation` targets **one symptom**. That keeps each state object small, keeps
each decision easy to audit, and means a budget overrun costs you the tail of the list
rather than the whole run.

---

## 3. The state object

What the policy receives. Serializable, deliberately small.

```elixir
defmodule VibeGuru.Investigation.State do
  @type t :: %__MODULE__{
          symptom: symptom(),
          facts: map(),
          hypotheses: [hypothesis()],
          history: [step()],
          probes: [probe_offer()],
          budget: budget()
        }
end
```

### JSON, as sent

```json
{
  "symptom": {
    "signature": "route_heap_growth",
    "route": "/charts",
    "severity": "high",
    "measurement": "178.8KB retained per visit, 4 of 4 visits"
  },

  "facts": {
    "stack": "react", "bundler": "vite", "router": "react_router",
    "chart_libs": ["chartjs"],
    "module_scoped_imports": true,
    "routes_declared": 13, "routes_reached": 12
  },

  "hypotheses": [
    { "id": "retained_library_object", "status": "supported",
      "because": "MutationObserver count grows 2/visit; chart.js uses one internally" },
    { "id": "unbounded_cache",        "status": "open",     "because": null },
    { "id": "retained_dom_subtree",   "status": "eliminated",
      "because": "node count flat across cycles" }
  ],

  "history": [
    { "probe": "census.client", "cost_ms": 118,
      "result": "MutationObserver +2/visit; Chart not visible (module-scoped)" }
  ],

  "probes": [
    { "id": "heap.snapshot",    "cost": "medium", "typical_ms": 3000,
      "discriminates": ["retained_library_object", "unbounded_cache"],
      "note": "sees module-scoped classes by constructor name" },
    { "id": "listener.census",  "cost": "cheap",  "typical_ms": 200,
      "discriminates": ["unreleased_subscription"] },
    { "id": "allocation.sample","cost": "medium", "typical_ms": 4000,
      "discriminates": ["unbounded_cache", "retained_library_object"],
      "note": "yields file:line" }
  ],

  "budget": { "ms_left": 96000, "probes_left": 6, "depth": 1, "max_depth": 3 }
}
```

**Roughly 700 tokens per decision.** At ~24 decisions that is under 20k for a whole run —
against the ~114k a generic browser-automation server costs an agent for *one*
verification. Keeping that ratio is the product; anything added to this object has to be
weighed against it.

### Field notes

| Field | Why it is shaped this way |
|---|---|
| `symptom.measurement` | Prose, not raw numbers. The policy needs the magnitude and the consistency, not the delta chain. |
| `facts.module_scoped_imports` | Tells the policy that `census.client` cannot see library classes here, so `heap.snapshot` is the only probe that settles `retained_library_object`. Facts exist to make probe choice obvious. |
| `hypotheses[].because` | Every status change carries its evidence. This is what makes a decision auditable after the fact. |
| `probes[].discriminates` | The whole point of the catalog. A probe that cannot change any open hypothesis is not worth running, whatever it costs. |
| `history` | Prevents re-running a probe that already answered. Also how `stalled` is detected. |

---

## 4. The decision

Typed and closed. The policy chooses from a fixed set; it never returns free text.

```elixir
@type decision ::
        {:probe, probe_id :: String.t(), focus :: map()}
        | {:conclude, cause :: cause()}
        | {:abandon, reason :: :exhausted | :budget | :stalled}
```

```json
{ "action": "probe",
  "probe": "heap.snapshot",
  "focus": { "route": "/charts", "constructor_hint": "Chart" },
  "testing": "retained_library_object",
  "confidence": 0.72 }
```

```json
{ "action": "conclude",
  "cause": {
    "id": "retained_library_object",
    "what": "Chart instance retained per visit",
    "where": "src/pages/Charts.jsx:14",
    "fix": "call chart.destroy() in the effect cleanup",
    "explains": ["route_heap_growth@/charts",
                 "listener_leak@/charts",
                 "retained_instances@/charts"]
  },
  "confidence": 0.94 }
```

`explains` is where the value lands. Three findings collapse into one cause with one fix,
which is the difference between a report someone triages and a report someone acts on.

### Stopping

| Reason | Condition |
|---|---|
| `conclude` | one hypothesis supported, competitors eliminated |
| `exhausted` | no remaining probe discriminates between what is open |
| `budget` | `ms_left` or `probes_left` gone, or `depth == max_depth` |
| `stalled` | the last probe changed no hypothesis status |

`stalled` is the one usually forgotten. Without it the loop grinds through its budget
learning nothing, which is the expensive failure.

**Defaults:** `max_depth: 3`, `probes_left: 8`, `ms_left: 120_000`, top 5 symptoms only.
Three levels is symptom → category → cause; deeper is reading source, which is the
calling agent's job, not this tool's.

---

## 5. Two policies, one contract

```elixir
@callback next_step(State.t()) :: decision()
```

| | `Policy.Rules` | `Policy.Jev` |
|---|---|---|
| Built | first | after the rules exist |
| Cost | free | one call per decision |
| Deterministic | yes | only if pinned |
| Handles | the obvious ~80% | the ambiguous remainder |

Write the rules first, not because a model could not do the easy nodes, but because
writing them is how you find out **which nodes are actually hard** — and those are the
only ones worth paying for. The detector taught this lesson already: nearly everything
that looked like judgment turned out to be a file read.

### Reproducibility

A model choosing the path means two runs of the same repo can diverge. Acceptable for an
interactive report; fatal for a CI gate meant to block a merge.

- **Interactive** — consult the policy live.
- **CI** — replay a pinned policy version. Same state, same decision, same findings.

Every decision is recorded with the state hash that produced it, so a path can be
replayed and audited regardless of which policy produced it.

---

## 6. Vocabulary

Closed sets, so the policy chooses from known values rather than inventing them.

**Hypotheses**

| id | settled by |
|---|---|
| `retained_dom_subtree` | node counts, heap snapshot |
| `retained_global_instance` | `census.client` |
| `retained_library_object` | `heap.snapshot` (module-scoped classes) |
| `unbounded_cache` | `heap.snapshot`, `allocation.sample` |
| `unreleased_subscription` | `listener.census`, `census.client` |
| `runaway_render` | mutation rate (already measured in pass 0) |
| `container_resource_leak` | `docker.stats` |

**Probes** — `memory.client` and `census.client` exist today. `heap.snapshot`,
`allocation.sample`, `listener.census` and `docker.stats` are planned; the catalog is
built from what is registered, so a state object never offers a probe that cannot run.

---

## 7. Polyglot probes

Nothing above assumes a language. `VibeGuru.Driver` already spawns a subprocess, writes
config as JSON and reads NDJSON off stdout — the one thing tying it to Node is
`System.find_executable("node")`. Parameterise the interpreter and a Python probe is:

```
python probes/docker_stats.py --config cfg.json
```

emitting the same events. Elixir stays the orchestrator; each probe is written in whichever
language has the best library for that job.

---

## 8. Open questions

1. **Focused re-runs.** `memory.client` currently exercises every route. A focused probe
   needs to exercise one. Cheap to add, but the config shape should be settled before more
   probes are written against it.
2. **Cross-symptom synthesis.** `explains` is emitted per investigation, but two
   investigations may reach the same cause. Deduplicating those is a synthesis-pass
   concern that this document does not yet cover.
3. **Calibration.** `confidence` is only meaningful if measured against outcomes. That
   needs labelled runs, which needs run history, which does not exist yet — so treat the
   field as advisory until there is data behind it.
