defmodule VibeGuru.Analyzers.MemoryTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Evidence
  alias VibeGuru.Analyzers.Memory

  @baseline %{"nodes" => 1_000, "listeners" => 10, "heapUsed" => 10_000_000}

  # --- fixtures -----------------------------------------------------------

  # Build the sample chain the driver produces: a baseline, then one sample per
  # (cycle, route) carrying the running totals, then a cooldown. `per_visit` says
  # what each route leaves behind on every visit, which is exactly what the
  # consecutive-diff attribution is supposed to recover.
  defp chain(per_visit, cycles, opts \\ []) do
    baseline =
      Evidence.new(:"memory.client", :sample,
        phase: :baseline,
        cycle: 0,
        context: %{"route" => "/"},
        data: @baseline
      )

    {cycle_samples, final} =
      Enum.reduce(
        for(cycle <- 1..cycles, {route, delta} <- per_visit, do: {cycle, route, delta}),
        {[], @baseline},
        fn {cycle, route, delta}, {acc, current} ->
          next = %{
            "nodes" => current["nodes"] + Keyword.get(delta, :nodes, 0),
            "listeners" => current["listeners"] + Keyword.get(delta, :listeners, 0),
            "heapUsed" => current["heapUsed"] + Keyword.get(delta, :heap, 0)
          }

          sample =
            Evidence.new(:"memory.client", :sample,
              phase: :cycle,
              cycle: cycle,
              context: %{"route" => route},
              data: next
            )

          {[sample | acc], next}
        end
      )

    cooldown =
      Evidence.new(:"memory.client", :sample,
        phase: :cooldown,
        cycle: cycles + 1,
        context: %{},
        data: Keyword.get(opts, :cooldown, final)
      )

    [baseline | Enum.reverse(cycle_samples)] ++ [cooldown]
  end

  defp analyze(evidences, config \\ %{}) do
    {:ok, findings} = Memory.analyze(evidences, config)
    findings
  end

  defp for_route(findings, route),
    do: Enum.filter(findings, &(&1.location.route == route))

  defp signatures(findings), do: findings |> Enum.map(& &1.signature) |> Enum.sort()

  # --- the control: clean apps must stay clean ----------------------------

  describe "no false positives" do
    test "a route that retains nothing is never flagged" do
      findings = chain([{"/clean", []}], 6) |> analyze()

      assert findings == []
    end

    test "several clean routes stay clean" do
      findings =
        chain([{"/", []}, {"/about", []}, {"/clean", []}], 8)
        |> analyze()

      assert findings == []
    end

    test "growth below the per-visit floor is not a leak" do
      # 40 nodes/visit is real churn but under the 100-node floor.
      findings = chain([{"/small", [nodes: 40]}], 6) |> analyze()

      assert findings == []
    end

    test "an empty or baseline-only run yields nothing rather than crashing" do
      assert analyze([]) == []

      baseline =
        Evidence.new(:"memory.client", :sample, phase: :baseline, cycle: 0, data: @baseline)

      assert analyze([baseline]) == []
    end

    test "inconsistent growth is rejected even when the average is high" do
      # One huge visit, the rest flat: average clears the floor but the growth is
      # not reproducible, so consistency must veto it.
      spike =
        chain([{"/spiky", []}], 6)
        |> Enum.map(fn ev ->
          if ev.phase == :cycle and ev.cycle == 3 do
            put_in(ev.data["nodes"], ev.data["nodes"] + 100_000)
          else
            ev
          end
        end)

      refute Enum.any?(analyze(spike), &(&1.signature == :detached_dom_leak))
    end
  end

  # --- the signatures -----------------------------------------------------

  describe "detached_dom_leak" do
    test "a route retaining DOM nodes every visit is flagged high" do
      [finding] =
        chain([{"/detached", [nodes: 3_000]}], 6)
        |> analyze()
        |> for_route("/detached")

      assert finding.signature == :detached_dom_leak
      assert finding.severity == :high
      assert finding.metrics.nodes_per_visit == 3_000
    end

    test "only the leaking route is blamed, not its neighbours" do
      findings = chain([{"/clean", []}, {"/detached", [nodes: 3_000]}], 6) |> analyze()

      assert for_route(findings, "/clean") == []
      assert [_] = for_route(findings, "/detached")
    end
  end

  describe "listener_leak" do
    test "listeners retained every visit are flagged" do
      [finding] =
        chain([{"/listeners", [listeners: 2]}], 6)
        |> analyze()
        |> for_route("/listeners")

      assert finding.signature == :listener_leak
      assert finding.metrics.listeners_per_visit == 2
    end

    test "the chart-library hint only appears when the stack has one" do
      evidences = chain([{"/charts", [listeners: 5]}], 6)

      plain = evidences |> analyze() |> for_route("/charts") |> hd()
      refute plain.fix.hint =~ "chart.destroy()"

      charted =
        evidences
        |> analyze(%{profile: %{chart_libs: ["chart.js"]}})
        |> for_route("/charts")
        |> hd()

      assert charted.fix.hint =~ "chart.destroy()"
    end
  end

  describe "route_heap_growth" do
    test "heap retained every visit is flagged" do
      [finding] =
        chain([{"/grow", [heap: 200_000]}], 6)
        |> analyze()
        |> for_route("/grow")

      assert finding.signature == :route_heap_growth
      assert finding.metrics.heap_bytes_per_visit == 200_000
    end

    test "heap growth explained by retained nodes is not reported twice" do
      # A detached-node leak necessarily grows the heap. Reporting both would send
      # an agent chasing two bugs where there is one.
      findings =
        chain([{"/detached", [nodes: 3_000, heap: 400_000]}], 6)
        |> analyze()
        |> for_route("/detached")

      assert signatures(findings) == [:detached_dom_leak]
    end
  end

  describe "initial_bundle_heap" do
    test "a very large baseline heap is reported on its own" do
      heavy =
        Evidence.new(:"memory.client", :sample,
          phase: :baseline,
          cycle: 0,
          context: %{"route" => "/"},
          data: %{"nodes" => 1_000, "listeners" => 10, "heapUsed" => 120_000_000}
        )

      [rest_baseline | rest] = chain([{"/clean", []}], 6)
      assert rest_baseline.phase == :baseline

      findings = analyze([heavy | rest])

      assert Enum.any?(findings, &(&1.signature == :initial_bundle_heap))
    end

    test "a normal baseline heap is not reported" do
      findings = chain([{"/clean", []}], 6) |> analyze()
      refute Enum.any?(findings, &(&1.signature == :initial_bundle_heap))
    end
  end

  # --- method guarantees --------------------------------------------------

  describe "attribution method" do
    test "the warm-up cycle is excluded once there is enough data" do
      # Cycle 1 carries one-time framework/HMR churn. With >= 3 cycles it must be
      # dropped, so a route that only churns on first mount stays clean.
      samples =
        chain([{"/warmup", []}], 6)
        |> Enum.map(fn ev ->
          if ev.phase == :cycle and ev.cycle == 1 do
            put_in(ev.data["nodes"], ev.data["nodes"] + 50_000)
          else
            ev
          end
        end)

      # Every later sample inherits the bump, so per-visit deltas after cycle 1
      # are zero and nothing should fire.
      shifted =
        Enum.map(samples, fn ev ->
          if ev.phase == :cycle and ev.cycle > 1 do
            put_in(ev.data["nodes"], ev.data["nodes"] + 50_000)
          else
            ev
          end
        end)

      refute Enum.any?(analyze(shifted), &(&1.signature == :detached_dom_leak))
    end

    test "thresholds are configurable" do
      evidences = chain([{"/borderline", [nodes: 120]}], 6)

      assert [_] = evidences |> analyze() |> for_route("/borderline")
      assert [] = analyze(evidences, %{thresholds: %{per_route_min_nodes: 500}})
    end

    test "findings are sorted most severe first" do
      findings =
        chain([{"/detached", [nodes: 3_000]}, {"/grow", [heap: 200_000]}], 6)
        |> analyze()

      severities = Enum.map(findings, & &1.severity)
      assert severities == Enum.sort_by(severities, &(&1 == :low))
    end

    test "every finding carries an agent-ready prompt naming its route" do
      findings = chain([{"/detached", [nodes: 3_000]}], 6) |> analyze()

      for f <- findings do
        assert f.ai_prompt =~ "[Vibe Guru finding: #{f.signature}]"
        assert f.ai_prompt =~ f.location.route
        assert f.vector == :"memory.client"
      end
    end
  end
end
