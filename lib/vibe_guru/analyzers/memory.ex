defmodule VibeGuru.Analyzers.Memory do
  @moduledoc """
  Turns `memory.client` evidence into memory `Finding`s — deterministically.

  ## Method

  The driver samples aggregate counters, with GC confirmation recorded separately.
  Samples are labeled by a route visit or a user-flow checkpoint. A consecutive diff
  associates growth with that measured interval; it does not identify its cause or
  establish that a component unmounted:

      baseline → c1/clean → c1/detached → … → cN/charts → cooldown

  We average those per-label deltas (skipping the warm-up
  first cycle) and flag a route when the average exceeds a per-metric floor *and* the
  growth is consistent across cycles. We additionally compute an overall per-metric
  **recovery ratio** (`(peak - cooldown) / (peak - baseline)`) as a health summary.

  ## Signatures emitted in v1

    * `detached_dom_leak`  — aggregate DOM node growth; detachment is unverified
    * `listener_leak`      — aggregate listener count growth; ownership is unverified
    * `route_heap_growth`  — JS heap growth, suppressed when node growth is also flagged
    * `initial_bundle_heap`— baseline heap itself is very large
    * `slow_recovery`      — a metric only partially recovers (advisory)

  These compatibility signature names do not establish a leak or a root cause. Timer,
  GPU and allocation-source claims require additional evidence and are not emitted here.
  """

  @behaviour VibeGuru.Analyzer

  alias VibeGuru.Finding

  @defaults %{
    per_route_min_nodes: 100,
    per_route_min_listeners: 2,
    per_route_min_heap: 150_000,
    consistency_min: 0.6,
    recovery_leak: 0.3,
    recovery_slow_hi: 0.8,
    bundle_heap_bytes: 80_000_000
  }

  @impl true
  def id, do: :memory

  @impl true
  def analyze(evidences, config) do
    th = Map.merge(@defaults, Map.get(config, :thresholds, %{}))
    samples = Enum.filter(evidences, &(&1.kind == :sample))
    baseline = Enum.find(samples, &(&1.phase == :baseline))
    cooldown = Enum.find(samples, &(&1.phase == :cooldown))
    cycles = samples |> Enum.filter(&(&1.phase == :cycle))

    if is_nil(baseline) or cycles == [] do
      {:ok, []}
    else
      max_cycle = cycles |> Enum.map(& &1.cycle) |> Enum.max()
      deltas = consecutive_deltas([baseline | cycles])
      # Drop the warm-up cycle (framework/HMR one-time churn) when we have enough data.
      deltas = if max_cycle >= 3, do: Enum.reject(deltas, &(&1.cycle == 1)), else: deltas

      attrib = attribute(deltas)
      overall = overall_metrics(baseline, cycles, cooldown)
      detached_routes = leaking_routes(attrib, :nodes, th.per_route_min_nodes, th.consistency_min)

      findings =
        detached_findings(attrib, overall, th) ++
          listener_findings(attrib, overall, th, config) ++
          heap_findings(attrib, overall, th, detached_routes) ++
          bundle_finding(baseline, th) ++
          slow_recovery_findings(overall, th, detached_routes)

      {:ok, Finding.sort(findings)}
    end
  end

  # --- delta chain + attribution -----------------------------------------

  defp consecutive_deltas(chain) do
    chain
    |> Enum.chunk_every(2, 1, :discard)
    |> Enum.map(fn [a, b] ->
      %{
        route: route_of(b),
        cycle: b.cycle,
        nodes: delta(b, a, "nodes"),
        listeners: delta(b, a, "listeners"),
        heap: delta(b, a, "heapUsed")
      }
    end)
  end

  defp route_of(sample), do: Map.get(sample.context || %{}, "route", "/")

  defp delta(b, a, key) do
    case {num(b.data[key]), num(a.data[key])} do
      {nil, _} -> nil
      {_, nil} -> nil
      {x, y} -> x - y
    end
  end

  # %{route => %{nodes: stats, listeners: stats, heap: stats}}
  defp attribute(deltas) do
    deltas
    |> Enum.group_by(& &1.route)
    |> Map.new(fn {route, ds} ->
      {route,
       %{
         nodes: stats(Enum.map(ds, & &1.nodes)),
         listeners: stats(Enum.map(ds, & &1.listeners)),
         heap: stats(Enum.map(ds, & &1.heap))
       }}
    end)
  end

  # avg + consistency (fraction of cycles with a positive delta) over non-nil deltas.
  defp stats(values) do
    vals = Enum.reject(values, &is_nil/1)
    n = length(vals)

    if n == 0 do
      %{avg: 0.0, pos_frac: 0.0, total: 0, n: 0}
    else
      total = Enum.sum(vals)
      pos = Enum.count(vals, &(&1 > 0))
      %{avg: total / n, pos_frac: pos / n, total: total, n: n}
    end
  end

  defp leaking_routes(attrib, metric, min, consistency_min) do
    for {route, m} <- attrib, leak?(m[metric], min, consistency_min), do: route
  end

  defp leak?(%{avg: avg, pos_frac: pf}, min, consistency_min),
    do: avg >= min and pf >= consistency_min

  # --- overall per-metric health -----------------------------------------

  defp overall_metrics(baseline, cycles, cooldown) do
    Map.new([{"nodes", :nodes}, {"listeners", :listeners}, {"heapUsed", :heap}], fn {key, name} ->
      base = num(baseline.data[key]) || 0
      cyc_vals = cycles |> Enum.map(&num(&1.data[key])) |> Enum.reject(&is_nil/1)
      peak = if cyc_vals == [], do: base, else: Enum.max([base | cyc_vals])
      final = if cyc_vals == [], do: base, else: List.last(cyc_vals)
      cool = (cooldown && num(cooldown.data[key])) || final

      {name,
       %{
         baseline: base,
         peak: peak,
         final: final,
         cooldown: cool,
         recovery: recovery(base, peak, cool),
         growth: final - base
       }}
    end)
  end

  defp recovery(base, peak, cool) do
    span = peak - base
    if span <= 0, do: 1.0, else: max(0.0, min(1.0, (peak - cool) / span))
  end

  # --- signature builders -------------------------------------------------

  defp detached_findings(attrib, overall, th) do
    for {route, m} <- attrib, leak?(m.nodes, th.per_route_min_nodes, th.consistency_min) do
      per_cycle = round(m.nodes.avg)
      rec = overall.nodes.recovery

      finding(
        route,
        :detached_dom_leak,
        :high,
        confidence(m.nodes),
        "DOM node count growth associated with #{route}",
        "Samples labeled #{route} show an average increase of ~#{per_cycle} DOM nodes per measured interval " <>
          "(positive deltas #{pct(m.nodes.pos_frac)}; node recovery #{pct(rec)}). " <>
          "Node detachment, retaining references and continued growth beyond this run require separate verification.",
        %{
          nodes_per_visit: per_cycle,
          nodes_total_retained: m.nodes.total,
          node_recovery_ratio: round3(rec)
        },
        %{
          summary: "Investigate DOM growth and retaining references",
          hint:
            "Compare repeated runs with an unchanged control, inspect whether growing nodes are attached or detached, and trace their retaining paths. Verify expected component lifetimes before proposing cleanup changes.",
          files_to_check: ["code exercised by route or flow label #{route}"]
        }
      )
    end
  end

  defp listener_findings(attrib, overall, th, config) do
    chart_hint = chart_libs_present?(config)

    for {route, m} <- attrib,
        leak?(m.listeners, th.per_route_min_listeners, th.consistency_min) do
      per_cycle = round(m.listeners.avg)

      base_fix =
        "Inspect listener targets, owners and expected lifetimes. If an independently verified " <>
          "listener outlives its owner, check the corresponding removal or subscription cleanup and re-measure."

      fix_hint =
        if chart_hint,
          do:
            base_fix <>
              " A chart library was detected; verify whether it owns the growing listeners before checking its documented disposal lifecycle.",
          else: base_fix

      finding(
        route,
        :listener_leak,
        :high,
        confidence(m.listeners),
        "Listener count growth associated with #{route}",
        "Samples labeled #{route} show an average listener count increase of ~#{per_cycle} per measured interval " <>
          "(positive deltas #{pct(m.listeners.pos_frac)}). Listener ownership and expected lifetime remain unverified.",
        %{
          listeners_per_visit: per_cycle,
          listeners_total_retained: m.listeners.total,
          listener_recovery_ratio: round3(overall.listeners.recovery)
        },
        %{
          summary: "Investigate listener ownership and lifetime",
          hint: fix_hint,
          files_to_check: ["code exercised by route or flow label #{route}"]
        }
      )
    end
  end

  defp heap_findings(attrib, overall, th, detached_routes) do
    for {route, m} <- attrib,
        leak?(m.heap, th.per_route_min_heap, th.consistency_min),
        route not in detached_routes do
      per_cycle = round(m.heap.avg)

      finding(
        route,
        :route_heap_growth,
        :high,
        confidence(m.heap),
        "JS heap growth associated with #{route}",
        "Samples labeled #{route} show an average JS heap increase of ~#{bytes(per_cycle)} per measured interval " <>
          "(positive deltas #{pct(m.heap.pos_frac)}; heap recovery #{pct(overall.heap.recovery)}). " <>
          "Retaining references, expected steady state and view lifecycle still require verification.",
        %{
          heap_bytes_per_visit: per_cycle,
          heap_bytes_total_retained: m.heap.total,
          heap_recovery_ratio: round3(overall.heap.recovery)
        },
        %{
          summary: "Investigate heap growth and expected retention",
          hint:
            "Compare repeated runs with an unchanged control and inspect heap snapshots or retaining paths. Check caches, stores and subscriptions as candidate sources; verify their expected lifetimes before changing cleanup.",
          files_to_check: ["code exercised by route or flow label #{route}"]
        }
      )
    end
  end

  defp bundle_finding(baseline, th) do
    base_heap = num(baseline.data["heapUsed"]) || 0

    if base_heap >= th.bundle_heap_bytes do
      [
        finding(
          "/",
          :initial_bundle_heap,
          :medium,
          :medium,
          "Large baseline JS heap",
          "The baseline sample records #{bytes(base_heap)} of JS heap before the measured cycles. " <>
            "The contribution of application data, imports and framework overhead needs investigation.",
          %{baseline_heap_bytes: base_heap},
          %{
            summary: "Investigate the baseline heap composition",
            hint:
              "Profile the baseline heap and distinguish expected data from avoidable allocations. Consider lazy loading only if the evidence identifies eager modules as a material contributor.",
            files_to_check: ["entry/bootstrap module", "top-level route imports"]
          }
        )
      ]
    else
      []
    end
  end

  defp slow_recovery_findings(overall, th, detached_routes) do
    # Advisory: a metric that only partially recovers, when not already a hard leak.
    for {name, m} <- overall,
        name != :listeners,
        m.recovery > th.recovery_leak and m.recovery < th.recovery_slow_hi,
        m.growth > 0,
        detached_routes == [] or name != :nodes do
      finding(
        "/",
        :slow_recovery,
        :low,
        :low,
        "Limited #{metric_label(name)} recovery at cooldown",
        "#{metric_label(name)} recovers #{pct(m.recovery)} of its baseline-to-peak increase by the cooldown sample. " <>
          "Expected retention and the required idle period need verification.",
        %{metric: name, recovery_ratio: round3(m.recovery), growth: m.growth},
        %{
          summary: "Investigate expected retention and cooldown behavior",
          hint:
            "Compare a longer idle period and repeated control runs. Inspect cache bounds and buffer lifetimes if retaining-path evidence implicates them before proposing a change.",
          files_to_check: []
        }
      )
    end
  end

  # --- finding + formatting helpers --------------------------------------

  defp finding(route, signature, severity, confidence, title, summary, metrics, fix) do
    %Finding{
      id: "memory.client.#{signature}.#{slug(route)}",
      vector: :"memory.client",
      signature: signature,
      severity: severity,
      confidence: confidence,
      title: title,
      summary: summary,
      metrics: metrics,
      location: %{route: route},
      fix: fix,
      ai_prompt: ai_prompt(signature, route, summary, metrics, fix)
    }
  end

  defp ai_prompt(signature, route, summary, metrics, fix) do
    """
    [Vibe Guru finding: #{signature}]
    Where: route or flow label #{route}
    Observation: #{summary}
    Evidence: #{format_metrics(metrics)}
    Investigation suggestions: #{fix.summary}. #{fix.hint}
    Action: verify measurement coverage and GC status, reproduce against an unchanged control, and trace the observed growth to its owner and expected lifetime. A route or flow label does not confirm a view unmount or a source location. Propose a change only when supporting evidence identifies a cause, then repeat the same measurement to check its effect.
    """
    |> String.trim()
  end

  defp format_metrics(metrics) do
    metrics
    |> Enum.map(fn {k, v} -> "#{k}=#{format_value(k, v)}" end)
    |> Enum.join(", ")
  end

  defp format_value(k, v) when is_integer(v) do
    key = to_string(k)

    if String.contains?(key, "bytes") or String.contains?(key, "heap"),
      do: bytes(v),
      else: Integer.to_string(v)
  end

  defp format_value(_k, v), do: to_string(v)

  defp confidence(%{pos_frac: pf, n: n}) when pf >= 1.0 and n >= 2, do: :high
  defp confidence(%{pos_frac: pf}) when pf >= 0.8, do: :high
  defp confidence(_), do: :medium

  defp chart_libs_present?(config) do
    case config[:profile] do
      %{chart_libs: libs} when is_list(libs) -> libs != []
      _ -> false
    end
  end

  defp metric_label(:nodes), do: "DOM node count"
  defp metric_label(:heap), do: "JS heap"
  defp metric_label(:listeners), do: "Event listeners"
  defp metric_label(other), do: to_string(other)

  defp num(v) when is_number(v), do: v
  defp num(_), do: nil

  defp pct(r), do: "#{round(r * 100)}%"
  defp round3(r) when is_float(r), do: Float.round(r, 3)
  defp round3(r), do: r

  defp bytes(b) when is_integer(b) and b >= 1_000_000, do: "#{Float.round(b / 1_000_000, 2)}MB"
  defp bytes(b) when is_integer(b) and b >= 1000, do: "#{Float.round(b / 1000, 1)}KB"
  defp bytes(b) when is_integer(b), do: "#{b}B"
  defp bytes(b), do: to_string(b)

  defp slug(route) do
    route
    |> String.replace(~r/[^a-zA-Z0-9]+/, "_")
    |> String.trim("_")
    |> case do
      "" -> "root"
      s -> s
    end
  end
end
