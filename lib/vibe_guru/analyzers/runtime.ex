defmodule VibeGuru.Analyzers.Runtime do
  @moduledoc """
  Turns runtime observation into `Finding`s — deterministically, like every analyzer.

  Where `Analyzers.Memory` asks "what did this route *retain*", this one asks the
  blunter question a coding agent actually needs answered first: **did the app break
  while it ran?** An uncaught exception on mount is a white screen; a request that
  404s is a dead feature; a component that re-renders forever pins a CPU core. None
  of that shows up in a memory delta, and none of it shows up in static analysis
  either — you have to run the thing.

  ## Method

  The driver rides along on the memory cycle (same browser, same navigation) and
  reports two streams:

    * `:runtime_event` evidence — one per *distinct* problem, already deduplicated by
      message signature, carrying an occurrence `count` and the routes it fired on.
    * `mutations` / `mutationWindowMs` on each cycle `:sample` — how much the DOM
      churned while that route was mounted.

  Counts are what make this deterministic rather than flaky. A run of N cycles that
  produces N copies of the same error is systematic and gets high confidence; the
  same error seen once is reported at medium confidence rather than suppressed, so a
  real crash on an unlucky route is never silently dropped.

  Render loops are detected by mutation *rate*, not raw count: a healthy route mounts,
  mutates in a burst, and goes quiet, so its rate over the visit window stays low.
  A component that sets state in an unguarded effect never goes quiet.
  """

  @behaviour VibeGuru.Analyzer

  alias VibeGuru.Finding

  @defaults %{
    # DOM mutations/sec sustained over a route visit before we call it a loop.
    # A heavy mount burst is a few hundred over ~1s; a loop is thousands.
    render_loop_mutations_per_s: 400,
    render_loop_consistency: 0.6
  }

  @impl true
  def id, do: :runtime

  @impl true
  def analyze(evidences, config) do
    th = Map.merge(@defaults, Map.get(config, :thresholds, %{}))
    cycles = Map.get(config, :cycles, 20)

    events = Enum.filter(evidences, &(&1.kind == :runtime_event))
    samples = Enum.filter(evidences, &(&1.kind == :sample and &1.phase == :cycle))

    loops = render_loop_findings(samples, th)

    observed = Enum.flat_map(events, &event_finding(&1, cycles))

    {:ok, Finding.sort(reject_echoes(observed, loops) ++ loops)}
  end

  # One defect often shows up twice: React narrates a runaway render as "Maximum
  # update depth exceeded", and Chrome narrates every failed request as "Failed to
  # load resource". Both arrive as console errors alongside the finding that already
  # describes the problem properly. Emitting both sends an agent hunting two bugs
  # where there is one, so the weaker echo is dropped.
  #
  # Both rules are deliberately narrow — the echo is only dropped on a route where
  # the stronger finding was actually reported — so an unrelated console error on
  # the same route still surfaces.
  @loop_symptom ~r/maximum update depth|too many re-?renders/i
  @network_symptom ~r/failed to load resource/i

  defp reject_echoes(observed, loops) do
    looping = MapSet.new(loops, & &1.location.route)

    failing_network =
      for f <- observed,
          f.signature in [:failed_request, :http_error],
          into: MapSet.new(),
          do: f.location.route

    Enum.reject(observed, fn f ->
      f.signature == :console_error and
        (echo?(f, looping, @loop_symptom) or echo?(f, failing_network, @network_symptom))
    end)
  end

  defp echo?(finding, routes, pattern) do
    MapSet.member?(routes, finding.location.route) and
      Regex.match?(pattern, finding.metrics.message)
  end

  # --- observed events ----------------------------------------------------

  defp event_finding(%{data: data, context: ctx}, cycles) do
    type = data["type"]
    message = data["message"] || ""
    count = data["count"] || 1
    routes = ctx["routes"] || [ctx["route"] || "/"]
    route = List.first(routes) || "/"

    case signature_for(type, data) do
      nil ->
        []

      {signature, severity} ->
        [
          build(
            route,
            signature,
            severity,
            confidence(count, cycles),
            title(signature, route),
            summary(signature, message, count, routes),
            %{
              occurrences: count,
              routes: Enum.join(routes, ", "),
              message: truncate(message),
              source: data["frame"] || data["url"] || "unknown"
            },
            fix_for(signature, data)
          )
        ]
    end
  end

  # An uncaught exception is the white-screen class of failure, so it outranks
  # everything else. 4xx is the app asking for something that isn't there —
  # real, but not necessarily fatal — so it sits a rung lower than 5xx.
  defp signature_for("page_error", _), do: {:uncaught_exception, :critical}
  defp signature_for("console_error", _), do: {:console_error, :high}
  defp signature_for("request_failed", _), do: {:failed_request, :high}

  defp signature_for("http_error", %{"status" => status})
       when is_integer(status) and status >= 500,
       do: {:failed_request, :high}

  defp signature_for("http_error", _), do: {:http_error, :medium}
  defp signature_for(_, _), do: nil

  # Fired at least once per cycle => reproducible, not a fluke.
  defp confidence(count, cycles) when is_integer(cycles) and cycles > 0 and count >= cycles,
    do: :high

  defp confidence(count, _cycles) when count > 1, do: :medium
  defp confidence(_, _), do: :low

  # --- render loop --------------------------------------------------------

  defp render_loop_findings(samples, th) do
    samples
    |> Enum.filter(&has_mutation_data?/1)
    # Cycle 1 includes first-mount work (lazy chunks, hydration), so it is not
    # representative — same warm-up exclusion the memory analyzer makes.
    |> Enum.reject(&(&1.cycle == 1))
    |> Enum.group_by(&route_of/1, &mutation_rate/1)
    |> Enum.flat_map(fn {route, rates} -> loop_finding(route, rates, th) end)
  end

  defp loop_finding(route, rates, th) do
    rates = Enum.reject(rates, &is_nil/1)
    n = length(rates)

    with true <- n > 0,
         avg = Enum.sum(rates) / n,
         hot = Enum.count(rates, &(&1 >= th.render_loop_mutations_per_s)),
         true <- avg >= th.render_loop_mutations_per_s,
         true <- hot / n >= th.render_loop_consistency do
      [
        build(
          route,
          :render_loop,
          :critical,
          if(hot == n, do: :high, else: :medium),
          "Runaway re-render on #{route}",
          "#{route} mutates the DOM ~#{round(avg)} times/second for as long as it is " <>
            "mounted, in #{hot} of #{n} visits. A view that has finished rendering goes " <>
            "quiet; one that keeps mutating is re-rendering in a loop and will pin a CPU core.",
          %{mutations_per_second: round(avg), visits_affected: "#{hot}/#{n}"},
          %{
            summary: "Break the state-update cycle in the component's effect",
            hint:
              "Look for a useEffect that sets state it also depends on, a missing or " <>
                "incorrect dependency array, or an object/array literal recreated every " <>
                "render and passed as a dependency (use useMemo/useCallback, or move the " <>
                "value outside the component).",
            files_to_check: ["component rendered at route #{route}"]
          }
        )
      ]
    else
      _ -> []
    end
  end

  defp has_mutation_data?(%{data: data}),
    do: is_number(data["mutations"]) and is_number(data["mutationWindowMs"])

  defp mutation_rate(%{data: %{"mutations" => m, "mutationWindowMs" => ms}}) when ms > 0,
    do: m * 1000 / ms

  defp mutation_rate(_), do: nil

  defp route_of(%{context: ctx}), do: Map.get(ctx || %{}, "route", "/")

  # --- copy ---------------------------------------------------------------

  defp title(:uncaught_exception, route), do: "Uncaught exception on #{route}"
  defp title(:console_error, route), do: "Console error on #{route}"
  defp title(:failed_request, route), do: "Request fails on #{route}"
  defp title(:http_error, route), do: "HTTP error response on #{route}"

  defp summary(:uncaught_exception, message, count, routes) do
    "An uncaught exception was thrown #{occurrences(count)} while exercising " <>
      "#{route_list(routes)}: #{truncate(message)}. Whatever was rendering when it threw " <>
      "did not finish, so the user sees a blank or partial view."
  end

  defp summary(:console_error, message, count, routes) do
    "The app logged an error #{occurrences(count)} on #{route_list(routes)}: " <>
      "#{truncate(message)}. The page kept running, so this is a defect the app knows " <>
      "about and swallowed rather than a hard crash."
  end

  defp summary(:failed_request, message, count, routes) do
    "A network request failed #{occurrences(count)} on #{route_list(routes)}: " <>
      "#{truncate(message)}. Any view depending on that response renders empty, stale, " <>
      "or stuck in a loading state."
  end

  defp summary(:http_error, message, count, routes) do
    "The server answered with an error status #{occurrences(count)} on " <>
      "#{route_list(routes)}: #{truncate(message)}. Either the client is calling the " <>
      "wrong path or the endpoint does not exist yet."
  end

  defp fix_for(:uncaught_exception, data) do
    %{
      summary: "Fix the throwing code path and guard the data it assumed",
      hint:
        "Most mount-time exceptions are an assumption about data that is not true yet: " <>
          "reading a property off a value that is still undefined on first render, or " <>
          "destructuring an API response before it arrives. Guard the access, give the " <>
          "state a sensible initial value, and handle the loading case explicitly." <>
          source_hint(data),
      files_to_check: [data["frame"] || "the frame named in the stack above"]
    }
  end

  defp fix_for(:console_error, data) do
    %{
      summary: "Resolve the logged error rather than silencing it",
      hint:
        "Read the message and fix the underlying cause. If it comes from a framework " <>
          "(a React key warning, an invalid prop type, a hydration mismatch), it is " <>
          "pointing at a real correctness bug even when the page still renders." <>
          source_hint(data),
      files_to_check: [data["frame"] || "the source named in the message"]
    }
  end

  defp fix_for(:failed_request, data), do: request_fix(data)
  defp fix_for(:http_error, data), do: request_fix(data)

  defp request_fix(data) do
    %{
      summary: "Make the request succeed, and handle the failure case in the UI",
      hint:
        "Check the URL, method and payload against the actual endpoint — a wrong path " <>
          "or a missing base URL is the usual cause. Then make sure the calling " <>
          "component renders an error state instead of hanging, so a future failure is " <>
          "visible rather than silent." <> source_hint(data),
      files_to_check: [data["url"] || "the module issuing this request"]
    }
  end

  defp source_hint(%{"frame" => frame}) when is_binary(frame) and frame != "",
    do: " Reported at: #{frame}."

  defp source_hint(_), do: ""

  defp occurrences(1), do: "once"
  defp occurrences(n), do: "#{n} times"

  defp route_list([single]), do: single
  defp route_list(routes), do: Enum.join(routes, ", ")

  defp truncate(text) when is_binary(text) do
    text = text |> String.replace(~r/\s+/, " ") |> String.trim()
    if String.length(text) > 200, do: String.slice(text, 0, 200) <> "…", else: text
  end

  defp truncate(other), do: to_string(other)

  # --- finding construction ----------------------------------------------

  defp build(route, signature, severity, confidence, title, summary, metrics, fix) do
    %Finding{
      id: "runtime.client.#{signature}.#{slug(route)}",
      vector: :"runtime.client",
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
    Where: route #{route}
    Problem: #{summary}
    Evidence: #{format_metrics(metrics)}
    Fix: #{fix.summary}. #{fix.hint}
    Action: reproduce this by loading #{route}, fix the cause described above, then re-run `vibeguru run` to confirm the finding is gone.
    """
    |> String.trim()
  end

  defp format_metrics(metrics), do: Enum.map_join(metrics, ", ", fn {k, v} -> "#{k}=#{v}" end)

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
