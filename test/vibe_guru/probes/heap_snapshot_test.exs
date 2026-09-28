defmodule VibeGuru.Probes.Heap.SnapshotTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Investigation.Probes
  alias VibeGuru.Probes.Heap.Snapshot

  defp events(growth) do
    [%{"kind" => "heap_census", "data" => %{"growth" => growth, "visits" => 3}}]
  end

  defp grew(retained, per_visit \\ nil),
    do: %{
      "retained" => retained,
      "perVisit" => per_visit || retained / 3,
      "bytes" => retained * 400
    }

  describe "interpreting a snapshot" do
    test "a retained class supports the library-object hypothesis and names it" do
      result = Snapshot.interpret(events(%{"Chart" => grew(4)}), %{"durationMs" => 2900})

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "4 Chart instance"
      assert result.cost_ms == 2900
      assert result.summary =~ "Chart +4"
    end

    test "nothing growing rules out both object hypotheses" do
      # The snapshot saw the whole heap, so "nothing grew" is an answer rather than an
      # absence of one — which is what lets the loop conclude instead of stalling.
      result = Snapshot.interpret(events(%{}), %{"durationMs" => 2700})

      assert {:eliminated, _} = result.updates.retained_library_object
      assert {:eliminated, _} = result.updates.unbounded_cache
      assert result.summary == "nothing retained across visits"
    end

    test "a growing container is a cache, not an unreleased object" do
      result = Snapshot.interpret(events(%{"Map" => grew(3)}), nil)

      assert {:supported, because} = result.updates.unbounded_cache
      assert because =~ "Map"
      assert {:eliminated, _} = result.updates.retained_library_object
    end

    test "objects and containers are reported separately when nothing was suspected" do
      result = Snapshot.interpret(events(%{"Chart" => grew(4), "Set" => grew(2)}), nil)

      assert {:supported, _} = result.updates.retained_library_object
      assert {:supported, _} = result.updates.unbounded_cache
    end

    test "containers inside a confirmed object are not a second bug" do
      # Real /charts data: chart.js keeps Maps and Sets inside every chart, so a retained
      # chart drags them along. Reporting an unbounded cache as well would send someone
      # hunting for something that does not exist — and would leave two hypotheses
      # supported, which stops the loop from concluding at all.
      result =
        Snapshot.interpret(
          events(%{
            "Chart" => grew(3),
            "PointElement" => grew(600),
            "Map" => grew(54),
            "Set" => grew(135)
          }),
          nil,
          %{constructor_hint: "Chart"}
        )

      assert {:supported, _} = result.updates.retained_library_object
      assert {:eliminated, because} = result.updates.unbounded_cache
      assert because =~ "internals"
      assert because =~ "Chart"
    end

    test "the suspected class wins over a bigger number elsewhere" do
      # A larger count somewhere else is not a better answer to the question that was
      # asked. The investigation came here to settle Chart.
      result =
        Snapshot.interpret(
          events(%{"Chart" => grew(2), "Sprite" => grew(50)}),
          nil,
          %{constructor_hint: "Chart"}
        )

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "Chart"
      refute because =~ "Sprite"
    end

    test "with no hint, the largest growth is reported" do
      result = Snapshot.interpret(events(%{"Small" => grew(1), "Big" => grew(9)}), nil)

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "Big"
    end

    test "a run that produced no snapshot evidence does not crash" do
      result = Snapshot.interpret([], nil)

      assert {:eliminated, _} = result.updates.retained_library_object
      assert result.cost_ms == 0
    end
  end

  describe "the probe catalog" do
    test "only implemented probes are offered to the policy" do
      # A catalog entry for something that cannot run would have the policy confidently
      # choose it and then fail.
      ids = Probes.available() |> Enum.map(& &1.id)

      assert "heap.snapshot" in ids
      refute "allocation.sample" in ids, "planned probes must not be offered"
    end

    test "every offered probe declares what it can settle" do
      for probe <- Probes.available() do
        assert is_list(probe.discriminates) and probe.discriminates != []
        assert probe.cost in [:cheap, :medium, :expensive]
      end
    end

    test "the catalog still documents what is planned" do
      planned = Probes.catalog() |> Enum.reject(& &1.available) |> Enum.map(& &1.id)

      assert "allocation.sample" in planned
    end

    test "the snapshot covers exactly what the census cannot" do
      census = Enum.find(Probes.catalog(), &(&1.id == "census.client"))
      snapshot = Enum.find(Probes.catalog(), &(&1.id == "heap.snapshot"))

      # The whole reason this probe exists: the census cannot reach module-scoped classes.
      assert :retained_library_object in snapshot.discriminates
      refute :retained_library_object in census.discriminates
    end
  end

  describe "the runner" do
    test "an unimplemented probe errors rather than raising" do
      run = Probes.runner(%VibeGuru.StackProfile{url: "http://localhost:5173"})

      assert {:error, {:not_implemented, "allocation.sample"}} =
               run.("allocation.sample", %{route: "/x"})
    end

    test "census.client says why it has no focused mode" do
      # It runs during the survey; the loop reads that evidence for free instead.
      run = Probes.runner(%VibeGuru.StackProfile{url: "http://localhost:5173"})

      assert {:error, {:survey_only, message}} = run.("census.client", %{route: "/x"})
      assert message =~ "survey"
    end
  end
end
