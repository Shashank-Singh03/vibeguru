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
      data: Map.put_new(data, "gcOk", true)
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
    test "flat aggregate DOM counts leave retention open and preserve the observations" do
      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts"),
            probes: @probes
          ),
          charts_evidence()
        )

      dom = Enum.find(state.hypotheses, &(&1.id == :retained_dom_subtree))

      assert dom.status == :open
      assert dom.because == nil

      # Steps are named for the probe whose evidence produced them, and cost nothing:
      # the survey already paid for these.
      assert [%{probe: "memory.client", cost_ms: 0}, %{probe: "census.client", cost_ms: 0}] =
               state.history

      assert Enum.all?(state.history, &(&1.source == :survey))
      assert length(hd(state.history).observations) == 4
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
      assert sub.because =~ "ownership and cleanup are unverified"
    end

    test "small valid DOM growth is a lead, not eliminated by a size threshold" do
      evidence = for cycle <- 1..3, do: sample("/charts", cycle, %{"nodes" => 1200 + cycle})

      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts")),
          evidence
        )

      dom = Enum.find(state.hypotheses, &(&1.id == :retained_dom_subtree))
      assert dom.status == :supported
      assert dom.because =~ "retaining paths are unverified"
    end

    test "missing intermediate counts and failed GC do not turn endpoints into support" do
      for middle <- [nil, "unknown", -1] do
        evidence = [
          sample("/charts", 1, %{"nodes" => 100}),
          sample("/charts", 2, %{"nodes" => middle}),
          sample("/charts", 3, %{"nodes" => 200})
        ]

        state =
          Investigation.seed(
            VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts")),
            evidence
          )

        assert Enum.all?(state.hypotheses, &(&1.status == :open))
      end

      evidence = [
        sample("/charts", 1, %{"nodes" => 100}),
        sample("/charts", 2, %{"nodes" => 200, "gcOk" => false})
      ]

      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts")),
          evidence
        )

      assert Enum.all?(state.hypotheses, &(&1.status == :open))
    end

    test "flat, unavailable and malformed census counts do not eliminate or support candidates" do
      for middle <- [
            nil,
            "unknown",
            %{},
            %{"MutationObserver" => nil},
            %{"MutationObserver" => -1}
          ] do
        evidence = [
          census("/charts", 1, %{"MutationObserver" => 1}),
          census("/charts", 2, middle),
          census("/charts", 3, %{"MutationObserver" => 4})
        ]

        state =
          Investigation.seed(
            VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts")),
            evidence
          )

        assert Enum.all?(state.hypotheses, &(&1.status == :open))
      end

      evidence = for cycle <- 1..3, do: census("/charts", cycle, %{"MutationObserver" => 2})

      state =
        Investigation.seed(
          VibeGuru.Investigation.State.new(finding(:route_heap_growth, "/charts")),
          evidence
        )

      assert Enum.all?(state.hypotheses, &(&1.status == :open))
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
             unreleased_subscription:
               {:eliminated, "independent ownership experiment excluded subscriptions"},
             retained_dom_subtree:
               {:eliminated, "independent retaining-path experiment excluded DOM retention"}
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
      assert cause_record.cause.verified == false
      assert cause_record.cause.fix =~ "trace retaining references"
    end

    test "same-route findings and duplicate signatures remain independent" do
      console = finding(:console_error, "/charts")

      findings = [
        finding(:route_heap_growth, "/charts"),
        finding(:listener_leak, "/charts"),
        finding(:retained_instances, "/charts"),
        console,
        %{console | id: "separate.console.error"}
      ]

      runner = fn _id, _focus ->
        {:ok,
         %{
           cost_ms: 2900,
           summary: "4 retained Chart instances",
           updates: %{
             retained_library_object: {:supported, "4 Chart instances"},
             unbounded_cache: :eliminated,
             unreleased_subscription: :eliminated,
             retained_dom_subtree: :eliminated
           }
         }}
      end

      result =
        Investigation.run(findings, charts_evidence(),
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      assert length(result.causes) == 2
      assert length(result.unresolved) == 3
      assert Enum.all?(result.causes, &(&1.cause.explains == [&1.finding_id]))

      assert Enum.sort(Enum.map(result.causes ++ result.unresolved, & &1.finding_id)) ==
               Enum.sort(Enum.map(findings, & &1.id))

      assert Enum.count(result.unresolved, &(&1.symptom.signature == :console_error)) == 2
    end

    test "the decision trail travels with the result" do
      runner = fn _id, _focus ->
        {:ok,
         %{
           cost_ms: 2900,
           updates: %{
             retained_library_object: {:supported, "found"},
             unbounded_cache: :eliminated,
             unreleased_subscription: :eliminated,
             retained_dom_subtree: :eliminated
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

      assert hd(result.causes).history
             |> List.last()
             |> Map.get(:updates)
             |> Map.has_key?(:retained_library_object)
    end

    test "a no-op survey seed permits the focused probe and its observations stay unresolved" do
      captured = [
        %{
          "kind" => "heap_census",
          "context" => %{"route" => "/charts"},
          "data" => %{
            "growth" => %{"Chart" => %{"retained" => 3, "perVisit" => 1, "bytes" => 300}},
            "visits" => 3,
            "visitsCompleted" => 3,
            "gcOk" => true,
            "navigationOk" => true
          }
        }
      ]

      completion = %{
        "ok" => true,
        "route" => "/charts",
        "visits" => 3,
        "visitsCompleted" => 3,
        "gcOk" => true,
        "navigationOk" => true
      }

      runner = fn "heap.snapshot", focus ->
        {:ok, VibeGuru.Probes.Heap.Snapshot.interpret(captured, completion, focus)}
      end

      flat = [
        sample("/charts", 1, %{"nodes" => 100}),
        sample("/charts", 2, %{"nodes" => 100}),
        census("/charts", 1, %{"Chart" => nil}),
        census("/charts", 2, %{"Chart" => nil})
      ]

      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], flat,
          facts: @facts,
          probes: @probes,
          run_probe: runner
        )

      assert result.causes == []
      assert [record] = result.unresolved
      assert record.reason == :exhausted
      assert {:probe, "heap.snapshot", _} = hd(record.decisions)

      assert Enum.find(record.hypotheses, &(&1.id == :retained_library_object)).status ==
               :supported

      assert List.last(record.history).measurement.evidence == captured
      assert List.last(record.history).measurement.completion == completion
    end

    test "explicitly invalid measurements cannot inject supported or eliminated flags" do
      runner = fn _, _ ->
        {:ok,
         %{
           measurement_validity: %{status: :partial},
           updates: %{
             retained_library_object: :supported,
             retained_dom_subtree: :eliminated,
             unreleased_subscription: :eliminated,
             unbounded_cache: :eliminated
           }
         }}
      end

      result =
        Investigation.run([finding(:route_heap_growth, "/charts")], [],
          probes: @probes,
          run_probe: runner
        )

      assert result.causes == []
      assert [record] = result.unresolved
      assert Enum.all?(record.hypotheses, &(&1.status == :open))
      assert List.last(record.history).measurement.measurement_validity.status == :partial
      assert List.last(record.history).updates == %{}
    end
  end

  # --- when it cannot finish ----------------------------------------------

  describe "stopping" do
    test "with no probe runner it still reports what the free evidence showed" do
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
      assert List.last(unresolved.history).measurement.error == :browser_gone
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

      assert [selected, deferred] = result.unresolved
      assert selected.symptom.route == "/critical"
      assert deferred.symptom.route == "/low"
      assert deferred.reason == :symptom_limit
      assert deferred.probes_run == []
    end

    test "only the top N symptoms are investigated" do
      findings = for n <- 1..10, do: finding(:route_heap_growth, "/r#{n}")

      result = Investigation.run(findings, [], facts: @facts, probes: @probes, max_symptoms: 3)

      assert length(result.causes) + length(result.unresolved) == 10
      assert Enum.count(result.unresolved, &(&1.reason == :symptom_limit)) == 7
    end
  end
end
