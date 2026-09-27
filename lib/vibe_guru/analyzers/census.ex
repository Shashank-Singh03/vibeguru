defmodule VibeGuru.Analyzers.Census do
  @moduledoc """
  Turns live-instance counts into findings — the first analyzer that can say what is
  being retained, not just how much.

  `Analyzers.Memory` reports that a route holds 178KB after every visit. True, and
  almost impossible to act on: the fix advice can only be a list of things to go look
  for. A census answers the next question down:

      /charts retains 1 live Chart instance per visit

  Same measurement discipline, one level more specific. That is the whole point of
  probing adaptively rather than reporting a single pass — each extra measurement
  should narrow *where*, never adjust *how confident*.

  ## Runtime-agnostic on purpose

  Nothing here knows what a browser is. The evidence is a map of name => count taken
  after a quiescence point, and the same shape comes out of `gc.get_objects()` in
  Python, a JVM heap histogram, or idle-in-transaction rows in `pg_stat_activity`.
  Adding one of those means writing a probe, not touching this file.

  ## Method

  Identical to the memory analyzer, and deliberately so — consecutive diffs of the
  count chain attribute growth to the route that caused it, the warm-up cycle is
  dropped, and a route is only flagged when growth is both large enough and
  consistent. A count that goes up and down is a cache doing its job; one that only
  goes up is a leak.
  """

  @behaviour VibeGuru.Analyzer

  alias VibeGuru.Finding

  @defaults %{
    # One retained instance per visit is a leak — these are not objects an app should
    # be accumulating. The floor exists to ignore a single stray allocation, not to
    # tolerate growth.
    per_route_min_instances: 1,
    census_consistency_min: 0.6
  }

  # What each class costs when it is retained, in words a developer can act on.
  @consequence %{
    "Chart" => "each retained chart keeps its canvas and full dataset alive",
    "WebGLRenderer" => "each retained renderer holds a GPU context, and browsers cap those",
    "Scene" => "each retained scene keeps its whole object graph and textures alive",
    "Texture" => "each retained texture holds GPU memory that is never reclaimed",
    "MutationObserver" =>
      "each observer keeps firing and retains everything its callback closes over",
    "ResizeObserver" =>
      "each observer keeps firing and retains everything its callback closes over",
    "IntersectionObserver" =>
      "each observer keeps firing and retains everything its callback closes over",
    "PerformanceObserver" => "each observer keeps buffering entries",
    "WebSocket" => "each socket holds an open connection and its handlers",
    "EventSource" => "each stream holds an open connection and keeps reconnecting",
    "Worker" => "each worker is a live thread with its own heap"
  }

  @cleanup %{
    "Chart" => "call chart.destroy() in the effect cleanup",
    "WebGLRenderer" => "call renderer.dispose() and lose the WebGL context in the cleanup",
    "Scene" => "dispose geometries, materials and textures, then drop the scene reference",
    "Texture" => "call texture.dispose() when the material is torn down",
    "MutationObserver" => "call observer.disconnect() in the effect cleanup",
    "ResizeObserver" => "call observer.disconnect() in the effect cleanup",
    "IntersectionObserver" => "call observer.disconnect() in the effect cleanup",
    "PerformanceObserver" => "call observer.disconnect() in the effect cleanup",
    "WebSocket" => "call socket.close() in the effect cleanup",
    "EventSource" => "call source.close() in the effect cleanup",
    "Worker" => "call worker.terminate() in the effect cleanup"
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
          title: "#{class} instances retained on #{route}",
          summary:
            "Visiting #{route} leaves ~#{per_visit} live #{class} instance(s) behind every " <>
              "time (#{stats.total} total across #{stats.n} visits). They survive garbage " <>
              "collection, so nothing will reclaim them — #{consequence(class)}.",
          metrics: %{
            class: class,
            instances_per_visit: per_visit,
            instances_total: stats.total,
            visits_measured: stats.n
          },
          location: %{route: route},
          fix: %{
            summary: "Release the #{class} when the view unmounts",
            hint:
              "#{cleanup(class)}. The count rising on every visit means the reference " <>
                "outlives the component — check for one held in a ref, a module-level " <>
                "variable, or a closure passed to something longer-lived.",
            files_to_check: ["component rendered at route #{route}"]
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
    Where: route #{route}
    Problem: every visit to #{route} leaves ~#{per_visit} live #{class} instance(s) alive after garbage collection (#{stats.total} across #{stats.n} visits). #{String.capitalize(consequence(class))}.
    Evidence: class=#{class}, instances_per_visit=#{per_visit}, instances_total=#{stats.total}
    Fix: #{cleanup(class)}, and make sure nothing outside the component still holds the reference.
    Action: open the component rendered at #{route}, release the #{class} in its unmount/cleanup path, then re-run to confirm the count stops growing.
    """
    |> String.trim()
  end

  defp consequence(class),
    do: Map.get(@consequence, class, "each retained instance holds whatever it references")

  defp cleanup(class),
    do: Map.get(@cleanup, class, "release it explicitly when the view unmounts")

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

  # Half an instance per visit is still an instance the app never releases, so round
  # up rather than reporting a leak as "0 per visit".
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
