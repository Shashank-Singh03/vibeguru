defmodule VibeGuru.Analyzers.Census do
  @moduledoc """
  Turns observed instance-count growth into findings. Constructor names narrow the
  investigation, but counts do not establish ownership, resource activity, a source
  location, a confirmed view unmount or a specific cleanup fix.

  ## Runtime-agnostic on purpose

  Nothing here knows what a browser is. The evidence is a map of name => count taken
  after a quiescence point, and the same shape comes out of `gc.get_objects()` in
  Python, a JVM heap histogram, or idle-in-transaction rows in `pg_stat_activity`.
  Adding one of those means writing a probe, not touching this file.

  ## Method

  Identical to the memory analyzer, and deliberately so — consecutive diffs of the
  count chain associate growth with a route or flow label, the warm-up cycle is
  dropped, and a route is only flagged when growth is both large enough and
  consistent. Expected caching, delayed cleanup and leaks require further evidence
  to distinguish; this analyzer retains the `retained_instances` compatibility signature.
  """

  @behaviour VibeGuru.Analyzer

  alias VibeGuru.Finding

  @defaults %{
    # A reporting floor for growth, not proof of an incorrect object lifetime.
    per_route_min_instances: 1,
    census_consistency_min: 0.6
  }

  # Investigation questions, not resource states inferred from an instance count.
  @consequence %{
    "Chart" =>
      "check whether the counted objects retain a canvas or dataset beyond its expected lifetime",
    "WebGLRenderer" => "check whether the counted renderers still own active GPU resources",
    "Scene" => "inspect the counted scenes' object graphs and expected lifetime",
    "Texture" => "check whether the counted textures still own allocated GPU resources",
    "MutationObserver" =>
      "check whether the counted observers are connected and which callbacks they retain",
    "ResizeObserver" =>
      "check whether the counted observers are connected and which callbacks they retain",
    "IntersectionObserver" =>
      "check whether the counted observers are connected and which callbacks they retain",
    "PerformanceObserver" =>
      "check whether the counted observers are active or buffering entries",
    "WebSocket" => "check the counted sockets' connection states and handler ownership",
    "EventSource" => "check the counted streams' connection states and retry behavior",
    "Worker" => "check whether the counted worker objects represent running workers"
  }

  @cleanup %{
    "Chart" =>
      "if these are confirmed Chart.js instances with ended lifetimes, inspect the chart.destroy() disposal path",
    "WebGLRenderer" =>
      "if renderer ownership and ended lifetimes are confirmed, inspect the library's documented disposal path",
    "Scene" =>
      "if scene ownership and ended lifetimes are confirmed, inspect disposal of owned geometries, materials and textures",
    "Texture" =>
      "if texture ownership and ended lifetimes are confirmed, inspect the texture.dispose() path",
    "MutationObserver" =>
      "if an observer remains connected beyond its expected lifetime, inspect the observer.disconnect() path",
    "ResizeObserver" =>
      "if an observer remains connected beyond its expected lifetime, inspect the observer.disconnect() path",
    "IntersectionObserver" =>
      "if an observer remains connected beyond its expected lifetime, inspect the observer.disconnect() path",
    "PerformanceObserver" =>
      "if an observer remains active beyond its expected lifetime, inspect the observer.disconnect() path",
    "WebSocket" =>
      "if an owned socket remains open beyond its expected lifetime, inspect the socket.close() path",
    "EventSource" =>
      "if an owned stream remains open beyond its expected lifetime, inspect the source.close() path",
    "Worker" =>
      "if an owned worker still runs beyond its expected lifetime, inspect the worker.terminate() path"
  }

  @impl true
  def id, do: :census

  @impl true
  def analyze(evidences, config) do
    th = Map.merge(@defaults, Map.get(config, :thresholds, %{}))

    censuses = Enum.filter(evidences, &(&1.kind == :census))
    baseline = Enum.find(censuses, &(&1.phase == :baseline))
    cycles = Enum.filter(censuses, &(&1.phase == :cycle))

    if is_nil(baseline) or cycles == [] do
      {:ok, []}
    else
      findings =
        [baseline | cycles]
        |> deltas()
        |> drop_warmup(cycles)
        |> attribute()
        |> Enum.flat_map(fn {{route, class}, stats} -> finding(route, class, stats, th) end)

      {:ok, Finding.sort(findings)}
    end
  end

  # --- delta chain --------------------------------------------------------

  defp deltas(chain) do
    chain
    |> Enum.chunk_every(2, 1, :discard)
    |> Enum.flat_map(fn [previous, current] ->
      before = counts(previous)

      current
      |> counts()
      |> Enum.flat_map(fn {class, now} ->
        case {num(now), num(Map.get(before, class))} do
          # A null means the class was never asked about — not that nothing is alive.
          # Treating it as zero would invent a drop, and then a rise on the next cycle.
          {nil, _} ->
            []

          {_, nil} ->
            []

          {now_n, was_n} ->
            [
              %{
                route: route_of(current),
                class: class,
                cycle: current.cycle,
                delta: now_n - was_n
              }
            ]
        end
      end)
    end)
  end

  # Cycle 1 includes first-mount construction — a chart legitimately created once is
  # not a leak. Only drop it when later cycles can carry the signal on their own.
  defp drop_warmup(deltas, cycles) do
    max_cycle = cycles |> Enum.map(& &1.cycle) |> Enum.max(fn -> 0 end)
    if max_cycle >= 3, do: Enum.reject(deltas, &(&1.cycle == 1)), else: deltas
  end

  defp attribute(deltas) do
    deltas
    |> Enum.group_by(&{&1.route, &1.class}, & &1.delta)
    |> Map.new(fn {key, values} -> {key, stats(values)} end)
  end

  defp stats([]), do: %{avg: 0.0, pos_frac: 0.0, total: 0, n: 0}

  defp stats(values) do
    n = length(values)
    positive = Enum.count(values, &(&1 > 0))

    %{avg: Enum.sum(values) / n, pos_frac: positive / n, total: Enum.sum(values), n: n}
  end

  # --- findings -----------------------------------------------------------

  defp finding(route, class, stats, th) do
    if leak?(stats, th) do
      per_visit = round_up(stats.avg)

      [
        %Finding{
          id: "census.instances.#{slug(class)}.#{slug(route)}",
          vector: :"census.client",
          signature: :retained_instances,
          severity: :high,
          confidence: confidence(stats),
          title: "#{class} count growth associated with #{route}",
          summary:
            "Samples labeled #{route} show an average increase of ~#{per_visit} counted #{class} instance(s) " <>
              "per measured interval (#{stats.total} net increase across #{stats.n} intervals; " <>
              "positive deltas #{round(stats.pos_frac * 100)}%). Ownership and expected lifetime remain unverified; #{consequence(class)}.",
          metrics: %{
            class: class,
            instances_per_visit: per_visit,
            instances_total: stats.total,
            visits_measured: stats.n
          },
          location: %{route: route},
          fix: %{
            summary: "Investigate #{class} ownership and expected lifetime",
            hint:
              "Trace retaining paths and verify resource state before proposing a change; #{cleanup(class)}. " <>
                "Compare the same measurement against an unchanged control and verify any candidate change by re-running it.",
            files_to_check: ["code exercised by route or flow label #{route}"]
          },
          ai_prompt: ai_prompt(route, class, per_visit, stats)
        }
      ]
    else
      []
    end
  end

  defp leak?(%{avg: avg, pos_frac: pos_frac}, th),
    do: avg >= th.per_route_min_instances and pos_frac >= th.census_consistency_min

  defp confidence(%{pos_frac: pos_frac, n: n}) when pos_frac >= 1.0 and n >= 2, do: :high
  defp confidence(%{pos_frac: pos_frac}) when pos_frac >= 0.8, do: :high
  defp confidence(_), do: :medium

  defp ai_prompt(route, class, per_visit, stats) do
    """
    [Vibe Guru finding: retained_instances]
    Where: route or flow label #{route}
    Observation: the count of #{class} increases by an average ~#{per_visit} per measured interval labeled #{route} (#{stats.total} net increase across #{stats.n} intervals). Ownership, resource state and expected lifetime require verification. #{String.capitalize(consequence(class))}.
    Evidence: class=#{class}, instances_per_visit=#{per_visit}, instances_total=#{stats.total}
    Investigation suggestions: #{cleanup(class)}. Constructor names alone do not establish a library or a cleanup bug.
    Action: verify measurement coverage and GC status, reproduce against an unchanged control, and trace the counted objects to their owners and expected lifetimes. A route or flow label does not confirm a view unmount or source location. Propose a change only when supporting evidence identifies a cause, then repeat the same measurement to check its effect.
    """
    |> String.trim()
  end

  defp consequence(class),
    do:
      Map.get(
        @consequence,
        class,
        "inspect what the counted objects reference and whether that retention is expected"
      )

  defp cleanup(class),
    do:
      Map.get(
        @cleanup,
        class,
        "if ownership and ended lifetimes are confirmed, inspect the object's documented release or disposal path"
      )

  # --- helpers ------------------------------------------------------------

  defp counts(%{data: data}) do
    case Map.get(data, "counts") do
      counts when is_map(counts) -> counts
      _ -> %{}
    end
  end

  defp route_of(%{context: context}), do: Map.get(context || %{}, "route", "/")

  defp num(value) when is_number(value), do: value
  defp num(_), do: nil

  # Keep small positive average growth visible in the compatibility metric.
  defp round_up(avg) when avg > 0, do: max(1, round(avg))
  defp round_up(_), do: 0

  defp slug(value) do
    value
    |> to_string()
    |> String.replace(~r/[^a-zA-Z0-9]+/, "_")
    |> String.trim("_")
    |> case do
      "" -> "root"
      slug -> slug
    end
  end
end
