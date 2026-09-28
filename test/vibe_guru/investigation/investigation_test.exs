defmodule VibeGuru.InvestigationTest do
  use ExUnit.Case, async: true

  alias VibeGuru.{Evidence, Finding, Investigation}

  @probes [
    %{
      id: "census.client",
      cost: :cheap,
      typical_ms: 120,
      discriminates: [:retained_global_instance, :unreleased_subscription]
    },
    %{
      id: "heap.snapshot",
      cost: :medium,
      typical_ms: 3000,
      discriminates: [:retained_library_object, :unbounded_cache]
    }
  ]

  @facts %{chart_libs: [:chartjs], module_scoped_imports: true}

  defp finding(signature, route, severity \\ :high) do
    %Finding{
      id: "#{signature}.#{route}",
      vector: :"memory.client",
      signature: signature,
      severity: severity,
      title: "#{signature} on #{route}",
      summary: "measured on #{route}",
      location: %{route: route}
    }
  end

  defp sample(route, cycle, data) do
    Evidence.new(:"memory.client", :sample,
      phase: :cycle,
      cycle: cycle,
      context: %{"route" => route},
      data: data
    )
  end

  defp census(route, cycle, counts) do
    Evidence.new(:"memory.client", :census,
      phase: :cycle,
      cycle: cycle,
      context: %{"route" => route},
      data: %{"counts" => counts}
    )
  end

  # The real /charts shape: heap climbing, node count flat, observers accumulating.
  defp charts_evidence do
    for cycle <- 1..4 do
      [
        sample("/charts", cycle, %{"nodes" => 1200, "heapUsed" => 10_000_000 + cycle * 178_800}),
        census("/charts", cycle, %{"MutationObserver" => 2 * cycle})
      ]
    end
    |> List.flatten()
  end

  # --- spending nothing ---------------------------------------------------

  describe "evidence already in hand" do
    test "a flat node count eliminates a DOM leak before anything is spent" do
      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts"),
            probes: @probes
          ),
          charts_evidence()
        )

      dom = Enum.find(state.hypotheses, &(&1.id == :retained_dom_subtree))

      assert dom.status == :eliminated
      assert dom.because =~ "flat"

      # Steps are named for the probe whose evidence produced them, and cost nothing:
      # the survey already paid for these.
      assert [%{probe: "memory.client", cost_ms: 0}, %{probe: "census.client", cost_ms: 0}] =
               state.history
    end

    test "a climbing census count supports an unreleased subscription" do
      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts"),
            probes: @probes
          ),
          charts_evidence()
        )

      sub = Enum.find(state.hypotheses, &(&1.id == :unreleased_subscription))

      assert sub.status == :supported
      assert sub.because =~ "MutationObserver"
    end

    test "evidence for another route is not read as this one's" do
      evidence = [
        census("/other", 1, %{"WebSocket" => 1}),
        census("/other", 2, %{"WebSocket" => 5})
      ]

      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts"),
            probes: @probes
          ),
          evidence
        )

      assert Enum.all?(state.hypotheses, &(&1.status == :open))
      assert state.history == []
    end

    test "a run with no evidence at all changes nothing" do
      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts"),
            probes: @probes
          ),
          []
        )

      assert Enum.all?(state.hypotheses, &(&1.status == :open))
    end
  end

  # --- the loop -----------------------------------------------------------

  describe "running an investigation" do
    test "it asks for the probe the free evidence could not supply" do
      asked = :ets.new(:asked, [:public, :set])

      runner = fn probe_id, focus ->
        :ets.insert(asked, {probe_id, focus})

        {:ok,
         %{
           cost_ms: 2900,
           summary: "4 retained Chart instances",
           updates: %{
             retained_library_object: {:supported, "4 Chart instances retained after GC"},
             unbounded_cache: {:eliminated, "no growing arrays"},
             unreleased_subscription: {:eliminated, "observers belong to the chart"}
           }
         }}
      end

      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], charts_evidence(),
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      # The census already ran in pass 0, so the loop should not pay for it again.
      assert [{"heap.snapshot", focus}] = :ets.tab2list(asked)
      assert focus.route == "/charts"
      assert focus.constructor_hint == "Chart"

      assert [cause_record] = result.causes
      assert cause_record.cause.id == :retained_library_object
      assert cause_record.cause.fix == "call chart.destroy() in the effect cleanup"
    end

    test "one cause absorbs every finding on the route" do
      findings = [
        finding(:route_heap_growth, "/charts"),
        finding(:listener_leak, "/charts"),
        finding(:retained_instances, "/charts")
      ]

      runner = fn _id, _focus ->
        {:ok,
         %{
           cost_ms: 2900,
           summary: "4 retained Chart instances",
           updates: %{
             retained_library_object: {:supported, "4 Chart instances"},
             unbounded_cache: :eliminated,
             unreleased_subscription: :eliminated
           }
         }}
      end

      result =
        Investigation.run(findings, charts_evidence(),
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      # Three findings, one investigation, one answer — not three restatements.
      assert length(result.causes) == 1
      assert result.unresolved == []

      assert Enum.sort(hd(result.causes).cause.explains) == [
               "listener_leak@/charts",
               "retained_instances@/charts",
               "route_heap_growth@/charts"
             ]
    end

    test "the decision trail travels with the result" do
      runner = fn _id, _focus ->
        {:ok,
         %{
           cost_ms: 2900,
           updates: %{
             retained_library_object: {:supported, "found"},
             unbounded_cache: :eliminated,
             unreleased_subscription: :eliminated
           }
         }}
      end

      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], charts_evidence(),
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      trail = hd(result.causes).decisions

      assert [{:probe, "heap.snapshot", _}, {:conclude, _}] = trail
      # census.client is listed because the survey ran it — which is exactly why the loop
      # did not pay to run it again.
      assert hd(result.causes).probes_run == ["memory.client", "census.client", "heap.snapshot"]
    end
  end

  # --- when it cannot finish ----------------------------------------------

  describe "stopping" do
    test "with no probe runner it still reports what the free evidence showed" do
      # Today heap.snapshot does not exist. The run must say so rather than pretend.
      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], charts_evidence(),
          facts: @facts,
          probes: @probes
        )

      assert result.causes == []
      assert [unresolved] = result.unresolved
      assert unresolved.reason in [:stalled, :budget, :exhausted]
      assert "heap.snapshot" in unresolved.probes_run
    end

    test "a failing probe is recorded rather than retried forever" do
      runner = fn _id, _focus -> {:error, :browser_gone} end

      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], charts_evidence(),
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      assert [unresolved] = result.unresolved
      assert length(unresolved.probes_run) <= 3, "a failing probe must not loop"
    end

    test "budget spent on early symptoms leaves later ones unresolved" do
      findings = [
        finding(:route_heap_growth, "/a", :critical),
        finding(:route_heap_growth, "/b", :high)
      ]

      runner = fn _id, _focus -> {:ok, %{cost_ms: 119_000, summary: "slow", updates: %{}}} end

      result =
        Investigation.run(findings, [],
          facts: @facts,
          probes: @probes,
          run_probe: runner,
          budget: %{ms_left: 120_000, probes_left: 8, depth: 0, max_depth: 3}
        )

      assert length(result.unresolved) == 2
      assert result.budget.ms_left == 0
      # The second symptom never got a probe — it was abandoned on budget, not silently.
      assert List.last(result.unresolved).reason == :budget
    end

    test "the worst symptom is investigated first" do
      findings = [
        finding(:route_heap_growth, "/low", :low),
        finding(:render_loop, "/critical", :critical)
      ]

      result = Investigation.run(findings, [], facts: @facts, probes: @probes, max_symptoms: 1)

      assert [only] = result.unresolved ++ result.causes
      assert only.symptom.route == "/critical"
    end

    test "only the top N symptoms are investigated" do
      findings = for n <- 1..10, do: finding(:route_heap_growth, "/r#{n}")

      result = Investigation.run(findings, [], facts: @facts, probes: @probes, max_symptoms: 3)

      assert length(result.causes) + length(result.unresolved) == 3
    end
  end
end
