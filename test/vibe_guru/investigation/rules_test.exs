defmodule VibeGuru.Investigation.Policy.RulesTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Finding
  alias VibeGuru.Investigation.State
  alias VibeGuru.Investigation.Policy.Rules

  # The probe catalog as it would be offered for a browser run. census.client and
  # memory.client exist today; the rest are planned, and the policy is written against
  # the catalog it is handed rather than a hardcoded list.
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
    },
    %{
      id: "allocation.sample",
      cost: :medium,
      typical_ms: 4000,
      discriminates: [:unbounded_cache, :retained_library_object]
    }
  ]

  defp finding(signature, route, summary \\ "measured") do
    %Finding{
      id: "#{signature}.#{route}",
      vector: :"memory.client",
      signature: signature,
      severity: :high,
      title: "#{signature} on #{route}",
      summary: summary,
      location: %{route: route}
    }
  end

  # The real /charts case: heap growth is the symptom, and the listener leak and the
  # retained MutationObservers are siblings that the same cause should account for.
  defp charts_state(opts \\ []) do
    State.new(
      finding(:route_heap_growth, "/charts", "178.8KB retained per visit, 4 of 4 visits"),
      siblings: [
        finding(:listener_leak, "/charts"),
        finding(:retained_instances, "/charts")
      ],
      facts: Keyword.get(opts, :facts, %{chart_libs: [:chartjs], module_scoped_imports: true}),
      probes: Keyword.get(opts, :probes, @probes),
      budget:
        Keyword.get(opts, :budget, %{ms_left: 120_000, probes_left: 8, depth: 0, max_depth: 3})
    )
  end

  # --- the worked case ----------------------------------------------------

  describe "/charts, end to end" do
    test "starts with the cheapest probe that can settle anything" do
      # heap.snapshot would also inform the question, but costs 25x more. Nothing is
      # known yet, so there is no reason to start with the expensive one.
      assert {:probe, "census.client", focus} = Rules.next_step(charts_state())
      assert focus.route == "/charts"
    end

    test "after the census, it reaches for the probe that sees module-scoped classes" do
      # The census found growing observers but could not see Chart itself — an ESM import
      # is not on the page's global scope. heap.snapshot is the only probe that can.
      state =
        charts_state()
        |> State.record(
          "census.client",
          %{
            cost_ms: 118,
            summary: "MutationObserver +2/visit; Chart not visible (module-scoped)"
          },
          %{unreleased_subscription: {:supported, "MutationObserver grows 2/visit"}}
        )

      assert {:probe, "heap.snapshot", focus} = Rules.next_step(state)
      assert focus.route == "/charts"
    end

    test "it passes the constructor it already suspects to the expensive probe" do
      # The detector knows chart.js is present. Telling the snapshot what to look for
      # beats making it scan blind.
      state =
        State.record(charts_state(), "census.client", %{cost_ms: 118}, %{
          unreleased_subscription: {:supported, "MutationObserver grows 2/visit"}
        })

      assert {:probe, "heap.snapshot", %{constructor_hint: "Chart"}} = Rules.next_step(state)
    end

    test "with one explanation left standing, it concludes" do
      state =
        charts_state()
        |> State.record("census.client", %{cost_ms: 118}, %{
          retained_global_instance: {:eliminated, "no growth in global instances"},
          unreleased_subscription: {:eliminated, "listeners traced to the chart"}
        })
        |> State.record(
          "heap.snapshot",
          %{cost_ms: 2900, summary: "4 retained Chart instances"},
          %{
            retained_library_object: {:supported, "4 Chart instances retained after GC"},
            unbounded_cache: {:eliminated, "no growing arrays or maps"},
            retained_dom_subtree: {:eliminated, "node count flat"}
          }
        )

      assert {:conclude, cause} = Rules.next_step(state)
      assert cause.id == :retained_library_object
      assert cause.what =~ "Chart instance"
      assert cause.fix == "call chart.destroy() in the effect cleanup"
      assert cause.where == "/charts"
      assert cause.because =~ "4 Chart instances"
    end

    test "the conclusion accounts for all three findings, not just the symptom" do
      # This is the payoff. Three findings, one cause, one fix.
      state =
        charts_state()
        |> State.record("census.client", %{cost_ms: 118}, %{
          retained_global_instance: :eliminated,
          unreleased_subscription: :eliminated
        })
        |> State.record("heap.snapshot", %{cost_ms: 2900}, %{
          retained_library_object: {:supported, "4 Chart instances retained"},
          unbounded_cache: :eliminated,
          retained_dom_subtree: :eliminated
        })

      assert {:conclude, cause} = Rules.next_step(state)

      assert Enum.sort(cause.explains) == [
               "listener_leak@/charts",
               "retained_instances@/charts",
               "route_heap_growth@/charts"
             ]
    end
  end

  # --- stopping -----------------------------------------------------------

  describe "stopping" do
    test "two supported hypotheses is not a conclusion" do
      # Narrowing to two is progress, not an answer. Concluding here would name a cause
      # the evidence does not single out.
      state =
        charts_state()
        |> State.record("census.client", %{cost_ms: 118}, %{
          retained_library_object: {:supported, "observers grow"},
          unreleased_subscription: {:supported, "listeners grow"},
          retained_dom_subtree: :eliminated
        })

      refute match?({:conclude, _}, Rules.next_step(state))
    end

    test "a probe that changed nothing stops the loop" do
      # The failure that is easy to miss: without this the loop spends its whole budget
      # re-measuring and learning nothing.
      state = State.record(charts_state(), "census.client", %{cost_ms: 118}, %{})

      assert {:abandon, :stalled} = Rules.next_step(state)
    end

    test "it stops when no untried probe can inform what is left" do
      state =
        charts_state(probes: [Enum.find(@probes, &(&1.id == "census.client"))])
        |> State.record("census.client", %{cost_ms: 118}, %{
          unreleased_subscription: {:eliminated, "no subscriptions grow"}
        })

      assert {:abandon, :exhausted} = Rules.next_step(state)
    end

    test "a probe that cannot change any live hypothesis is never chosen" do
      only_irrelevant = [
        %{
          id: "docker.stats",
          cost: :cheap,
          typical_ms: 50,
          discriminates: [:container_resource_leak]
        }
      ]

      assert {:abandon, :exhausted} = Rules.next_step(charts_state(probes: only_irrelevant))
    end

    test "depth, time and probe count each end the investigation" do
      for budget <- [
            %{ms_left: 0, probes_left: 8, depth: 1, max_depth: 3},
            %{ms_left: 120_000, probes_left: 0, depth: 1, max_depth: 3},
            %{ms_left: 120_000, probes_left: 8, depth: 3, max_depth: 3}
          ] do
        assert {:abandon, :budget} = Rules.next_step(charts_state(budget: budget))
      end
    end

    test "concluding beats every stop condition" do
      # An answer already in hand is not discarded because the budget ran out.
      state =
        charts_state(budget: %{ms_left: 0, probes_left: 0, depth: 3, max_depth: 3})
        |> State.record("heap.snapshot", %{cost_ms: 2900}, %{
          retained_library_object: {:supported, "4 Chart instances"},
          unbounded_cache: :eliminated,
          retained_dom_subtree: :eliminated,
          unreleased_subscription: :eliminated
        })

      assert {:conclude, _} = Rules.next_step(state)
    end
  end

  # --- determinism --------------------------------------------------------

  describe "determinism" do
    test "the same state always yields the same decision" do
      # Not incidental: a CI gate replays a recorded path, and that only works if the
      # policy is a pure function of the state.
      state = charts_state()
      decisions = Enum.map(1..20, fn _ -> Rules.next_step(state) end)

      assert Enum.uniq(decisions) |> length() == 1
    end

    test "equal-cost probes break their tie the same way every time" do
      # heap.snapshot and allocation.sample are both :medium and both inform the same
      # hypotheses. Duration decides, then id — so the order is total.
      progressed = %{unreleased_subscription: {:supported, "observers grow"}}

      forward = State.record(charts_state(), "census.client", %{cost_ms: 118}, progressed)

      reversed =
        charts_state(probes: Enum.reverse(@probes))
        |> State.record("census.client", %{cost_ms: 118}, progressed)

      assert Rules.next_step(forward) == Rules.next_step(reversed)
      assert {:probe, "heap.snapshot", _} = Rules.next_step(forward)
    end

    test "a probe is never run twice for the same symptom" do
      state =
        charts_state()
        |> State.record("census.client", %{cost_ms: 118}, %{unreleased_subscription: :eliminated})

      assert {:probe, chosen, _} = Rules.next_step(state)
      refute chosen == "census.client"
    end
  end

  describe "probe ordering" do
    test "cost decides before duration" do
      # In the real catalog the cheapest probe is also the fastest, so those two rules
      # are indistinguishable. Here they disagree: a cheap-but-slow probe must still beat
      # a medium-but-fast one, because cost is about what a probe does to the run
      # (a heap snapshot pauses the world) not merely how long it takes.
      probes = [
        %{id: "fast.medium", cost: :medium, typical_ms: 10, discriminates: [:unbounded_cache]},
        %{id: "slow.cheap", cost: :cheap, typical_ms: 9000, discriminates: [:unbounded_cache]}
      ]

      assert {:probe, "slow.cheap", _} = Rules.next_step(charts_state(probes: probes))
    end

    test "duration decides only within the same cost band" do
      probes = [
        %{id: "slower", cost: :medium, typical_ms: 5000, discriminates: [:unbounded_cache]},
        %{id: "quicker", cost: :medium, typical_ms: 900, discriminates: [:unbounded_cache]}
      ]

      assert {:probe, "quicker", _} = Rules.next_step(charts_state(probes: probes))
    end
  end

  describe "hypothesis vocabulary" do
    test "an update for a hypothesis this symptom never had is a no-op" do
      # Candidates are scoped to the signature: route_heap_growth has no
      # retained_global_instance, so reporting one changes nothing and the loop reads
      # that as a probe having learned nothing. Worth pinning, because the failure mode
      # is a confusing :stalled rather than an error.
      state =
        charts_state()
        |> State.record("census.client", %{cost_ms: 118}, %{retained_global_instance: :supported})

      assert Enum.all?(state.hypotheses, &(&1.status == :open))
      assert {:abandon, :stalled} = Rules.next_step(state)
    end
  end

  # --- other symptoms -----------------------------------------------------

  describe "other symptoms" do
    test "a render loop has a single candidate and needs no probing" do
      state =
        State.new(finding(:render_loop, "/render-loop"), probes: @probes)
        |> State.record("noop", %{cost_ms: 0}, %{
          runaway_render: {:supported, "29305 mutations/sec"}
        })

      assert {:conclude, cause} = Rules.next_step(state)
      assert cause.id == :runaway_render
      assert cause.fix =~ "state-update cycle"
    end

    test "an unknown signature has nothing to investigate" do
      state = State.new(finding(:some_future_signature, "/x"), probes: @probes)

      assert {:abandon, :exhausted} = Rules.next_step(state)
    end

    test "without a known library the cause stays generic rather than guessing" do
      state =
        charts_state(facts: %{module_scoped_imports: true})
        |> State.record("heap.snapshot", %{cost_ms: 2900}, %{
          retained_library_object: {:supported, "retained objects"},
          unbounded_cache: :eliminated,
          retained_dom_subtree: :eliminated,
          unreleased_subscription: :eliminated
        })

      assert {:conclude, cause} = Rules.next_step(state)
      assert cause.what == "a library object is retained on every visit"
      assert cause.fix == "dispose it in the unmount path"
    end
  end
end
