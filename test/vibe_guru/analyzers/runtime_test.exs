defmodule VibeGuru.Analyzers.RuntimeTest do
  use ExUnit.Case, async: true

  alias VibeGuru.{Evidence, Finding}
  alias VibeGuru.Analyzers.Runtime

  @cycles 6

  # --- fixtures -----------------------------------------------------------

  defp event(type, opts) do
    routes = Keyword.get(opts, :routes, ["/"])

    Evidence.new(:"memory.client", :runtime_event,
      phase: :cycle,
      cycle: @cycles,
      context: %{"route" => List.first(routes), "routes" => routes},
      data:
        %{
          "type" => type,
          "message" => Keyword.get(opts, :message, "boom"),
          "count" => Keyword.get(opts, :count, 1)
        }
        |> put_optional("frame", Keyword.get(opts, :frame))
        |> put_optional("url", Keyword.get(opts, :url))
        |> put_optional("status", Keyword.get(opts, :status))
    )
  end

  defp put_optional(map, _key, nil), do: map
  defp put_optional(map, key, value), do: Map.put(map, key, value)

  # A cycle sample carrying a mutation window for the render-loop detector.
  defp mutation_sample(route, cycle, mutations, window_ms \\ 1000) do
    Evidence.new(:"memory.client", :sample,
      phase: :cycle,
      cycle: cycle,
      context: %{"route" => route},
      data: %{"mutations" => mutations, "mutationWindowMs" => window_ms}
    )
  end

  defp analyze(evidences, config \\ %{}) do
    {:ok, findings} = Runtime.analyze(evidences, Map.merge(%{cycles: @cycles}, config))
    findings
  end

  defp signatures(findings), do: Enum.map(findings, & &1.signature)

  defp find(findings, signature), do: Enum.find(findings, &(&1.signature == signature))

  # --- no evidence, no findings -------------------------------------------

  describe "quiet runs" do
    test "no evidence produces no findings" do
      assert analyze([]) == []
    end

    test "a clean run with only memory samples produces no findings" do
      samples =
        for cycle <- 1..@cycles, route <- ["/", "/about"] do
          Evidence.new(:"memory.client", :sample,
            phase: :cycle,
            cycle: cycle,
            context: %{"route" => route},
            data: %{"nodes" => 1000, "heapUsed" => 5_000_000}
          )
        end

      assert analyze(samples) == []
    end

    test "an unrecognised event type is ignored rather than guessed at" do
      assert analyze([event("some_future_type", message: "???")]) == []
    end
  end

  # --- observed events ----------------------------------------------------

  describe "runtime events" do
    test "an uncaught exception is critical" do
      [finding] = analyze([event("page_error", message: "Cannot read properties of undefined")])

      assert finding.signature == :uncaught_exception
      assert finding.severity == :critical
      assert finding.vector == :"runtime.client"
      assert finding.summary =~ "Cannot read properties of undefined"
    end

    test "a console error is high, not critical — the page kept running" do
      [finding] = analyze([event("console_error", message: "Each child needs a key")])

      assert finding.signature == :console_error
      assert finding.severity == :high
    end

    test "a transport failure is a failed request" do
      [finding] = analyze([event("request_failed", message: "ERR_CONNECTION_REFUSED — /api/x")])

      assert finding.signature == :failed_request
      assert finding.severity == :high
    end

    test "a 5xx is escalated to the same severity as a transport failure" do
      [finding] = analyze([event("http_error", message: "HTTP 500", status: 500)])

      assert finding.signature == :failed_request
      assert finding.severity == :high
    end

    test "a 4xx stays a rung lower than a 5xx" do
      [finding] = analyze([event("http_error", message: "HTTP 404", status: 404)])

      assert finding.signature == :http_error
      assert finding.severity == :medium
    end

    test "findings are sorted most severe first" do
      findings =
        analyze([
          event("http_error", message: "HTTP 404", status: 404),
          event("page_error", message: "boom"),
          event("console_error", message: "bad prop")
        ])

      assert signatures(findings) == [:uncaught_exception, :console_error, :http_error]
    end
  end

  describe "confidence reflects reproducibility" do
    test "an error in every cycle is systematic — high confidence" do
      [finding] = analyze([event("console_error", count: @cycles)])
      assert finding.confidence == :high
    end

    test "a repeated but not per-cycle error is medium" do
      [finding] = analyze([event("console_error", count: 2)])
      assert finding.confidence == :medium
    end

    test "a single occurrence is reported at low confidence, never dropped" do
      [finding] = analyze([event("console_error", count: 1)])
      assert finding.confidence == :low
    end
  end

  # --- render loop --------------------------------------------------------

  describe "render loop detection" do
    test "a route that keeps mutating is flagged critical" do
      samples = for cycle <- 1..@cycles, do: mutation_sample("/loop", cycle, 5_000)

      finding = analyze(samples) |> find(:render_loop)

      assert finding.severity == :critical
      assert finding.location == %{route: "/loop"}
      assert finding.metrics.mutations_per_second == 5_000
    end

    test "a normal mount burst is not a loop" do
      samples = for cycle <- 1..@cycles, do: mutation_sample("/normal", cycle, 120)

      assert analyze(samples) == []
    end

    test "the warm-up cycle alone cannot trigger a loop finding" do
      # Cycle 1 is first-mount work (lazy chunks, hydration) and is excluded;
      # every later cycle is quiet, so this must stay silent.
      samples = [
        mutation_sample("/warmup", 1, 20_000)
        | for(cycle <- 2..@cycles, do: mutation_sample("/warmup", cycle, 50))
      ]

      assert analyze(samples) == []
    end

    test "an occasional spike is not consistent enough to flag" do
      # One hot visit out of five is below the 0.6 consistency floor.
      samples = [
        mutation_sample("/spiky", 2, 30_000)
        | for(cycle <- 3..@cycles, do: mutation_sample("/spiky", cycle, 10))
      ]

      assert analyze(samples) == []
    end

    test "rate is per second, so a short window is not mistaken for a loop" do
      # 200 mutations in 50ms is a burst that finished, not a sustained loop —
      # but naive count-based detection would flag it. Only cycles >= 2 count.
      samples = for cycle <- 2..@cycles, do: mutation_sample("/burst", cycle, 200, 50)

      assert analyze(samples) |> find(:render_loop) != nil,
             "4000 mutations/sec sustained across visits is a loop"
    end

    test "thresholds are configurable" do
      samples = for cycle <- 2..@cycles, do: mutation_sample("/busy", cycle, 500)

      assert analyze(samples) |> find(:render_loop) != nil
      assert analyze(samples, %{thresholds: %{render_loop_mutations_per_s: 900}}) == []
    end

    test "samples without mutation data are skipped, not treated as zero" do
      samples =
        for cycle <- 1..@cycles do
          Evidence.new(:"memory.client", :sample,
            phase: :cycle,
            cycle: cycle,
            context: %{"route" => "/x"},
            data: %{"nodes" => 100}
          )
        end

      assert analyze(samples) == []
    end
  end

  describe "network echo de-duplication" do
    test "Chrome's \"Failed to load resource\" is dropped when the failure is already reported" do
      failure = event("request_failed", message: "net::ERR_CONNECTION_REFUSED", routes: ["/api"])

      echo =
        event("console_error",
          message: "Failed to load resource: net::ERR_CONNECTION_REFUSED",
          routes: ["/api"]
        )

      assert signatures(analyze([failure, echo])) == [:failed_request]
    end

    test "the echo is kept when no network failure was reported for that route" do
      echo = event("console_error", message: "Failed to load resource: 404", routes: ["/orphan"])

      assert signatures(analyze([echo])) == [:console_error]
    end

    test "an app-authored error on a route with a failed request still surfaces" do
      failure = event("http_error", message: "HTTP 404", status: 404, routes: ["/api"])
      real = event("console_error", message: "Checkout total computed as NaN", routes: ["/api"])

      assert :console_error in signatures(analyze([failure, real]))
    end
  end

  describe "render loop de-duplication" do
    test "React's update-depth warning is suppressed on a route already flagged as looping" do
      samples = for cycle <- 2..@cycles, do: mutation_sample("/loop", cycle, 9_000)

      warning =
        event("console_error",
          message: "Warning: Maximum update depth exceeded. This can happen when...",
          routes: ["/loop"]
        )

      findings = analyze([warning | samples])

      assert signatures(findings) == [:render_loop]
    end

    test "an unrelated error on a looping route still surfaces" do
      samples = for cycle <- 2..@cycles, do: mutation_sample("/loop", cycle, 9_000)
      unrelated = event("console_error", message: "Failed to fetch user", routes: ["/loop"])

      findings = analyze([unrelated | samples])

      assert :console_error in signatures(findings)
      assert :render_loop in signatures(findings)
    end

    test "the same warning on a route that is NOT looping is kept" do
      warning =
        event("console_error", message: "Maximum update depth exceeded", routes: ["/quiet"])

      assert signatures(analyze([warning])) == [:console_error]
    end
  end

  # --- agent-facing output ------------------------------------------------

  describe "ai_prompt" do
    test "carries the signature, route, evidence and a concrete next action" do
      [finding] =
        analyze([
          event("page_error",
            message: "x is not a function",
            routes: ["/checkout"],
            frame: "src/pages/Checkout.jsx:42:10"
          )
        ])

      prompt = finding.ai_prompt

      assert prompt =~ "[Vibe Guru finding: uncaught_exception]"
      assert prompt =~ "Where: route /checkout"
      assert prompt =~ "x is not a function"
      assert prompt =~ "src/pages/Checkout.jsx:42:10"
      assert prompt =~ "vibeguru run"
    end

    test "every finding has an id, a fix and a non-empty prompt" do
      findings =
        analyze([
          event("page_error", message: "a"),
          event("console_error", message: "b"),
          event("request_failed", message: "c"),
          event("http_error", message: "d", status: 404)
        ])

      assert length(findings) == 4

      for %Finding{} = f <- findings do
        assert is_binary(f.id) and f.id != ""
        assert is_binary(f.ai_prompt) and f.ai_prompt != ""
        assert f.fix.summary != ""
        assert f.fix.hint != ""
      end
    end

    test "ids are unique per signature and route" do
      findings =
        analyze([
          event("console_error", message: "a", routes: ["/one"]),
          event("console_error", message: "b", routes: ["/two"])
        ])

      ids = Enum.map(findings, & &1.id)
      assert ids == Enum.uniq(ids)
    end
  end
end
