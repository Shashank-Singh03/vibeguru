defmodule VibeGuru.Probes.Heap.SnapshotTest do
  use ExUnit.Case, async: true

  alias VibeGuru.Investigation.Probes
  alias VibeGuru.Probes.Heap.Snapshot

  defp events(growth) do
    [
      %{
        "kind" => "heap_census",
        "context" => %{"route" => "/charts"},
        "data" => %{
          "growth" => growth,
          "visits" => 3,
          "visitsCompleted" => 3,
          "gcOk" => true,
          "navigationOk" => true
        }
      }
    ]
  end

  defp completion do
    %{
      "ok" => true,
      "route" => "/charts",
      "visits" => 3,
      "visitsCompleted" => 3,
      "gcOk" => true,
      "navigationOk" => true,
      "durationMs" => 2900
    }
  end

  defp grew(retained, per_visit \\ nil),
    do: %{
      "retained" => retained,
      "perVisit" => per_visit || retained / 3,
      "bytes" => retained * 400
    }

  describe "interpreting a snapshot" do
    test "measured growth supports a qualified lead and preserves observations" do
      captured = events(%{"Chart" => grew(4)})
      result = Snapshot.interpret(captured, completion(), %{route: "/charts"})

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "Chart"
      assert because =~ "ownership are unverified"
      refute because =~ "destroy"
      assert result.cost_ms == 2900
      assert result.summary =~ "Chart +4"
      assert result.evidence == captured
      assert result.completion == completion()
      assert result.measurement_validity.status == :complete
    end

    test "no growth in a ranked summary does not eliminate retention hypotheses" do
      result = Snapshot.interpret(events(%{}), completion())

      assert result.updates == %{}
      assert result.measurement_validity.status == :complete
      assert result.summary =~ "remains unresolved"
    end

    test "container growth is a lead and does not rule out unrelated object retention" do
      result = Snapshot.interpret(events(%{"Map" => grew(3)}), completion())

      assert {:supported, because} = result.updates.unbounded_cache
      assert because =~ "Map"
      assert because =~ "bounds are unverified"
      refute Map.has_key?(result.updates, :retained_library_object)
    end

    test "objects and containers are reported separately when nothing was suspected" do
      result = Snapshot.interpret(events(%{"Chart" => grew(4), "Set" => grew(2)}), completion())

      assert {:supported, _} = result.updates.retained_library_object
      assert {:supported, _} = result.updates.unbounded_cache
    end

    test "a constructor hint cannot attribute co-growing containers to that object" do
      result =
        Snapshot.interpret(
          events(%{
            "Chart" => grew(3),
            "PointElement" => grew(600),
            "Map" => grew(54),
            "Set" => grew(135)
          }),
          completion(),
          %{constructor_hint: "Chart"}
        )

      assert {:supported, _} = result.updates.retained_library_object
      assert {:supported, because} = result.updates.unbounded_cache
      assert because =~ "Map, Set"
      refute because =~ "internals"
      refute Enum.any?(result.updates, fn {_, {status, _}} -> status == :eliminated end)
    end

    test "a constructor hint cannot hide growth of another measured class" do
      result =
        Snapshot.interpret(
          events(%{"Chart" => grew(2), "Sprite" => grew(50)}),
          completion(),
          %{constructor_hint: "Chart"}
        )

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "Chart"
      assert because =~ "Sprite"
    end

    test "all measured growth contributes to the hypothesis" do
      result = Snapshot.interpret(events(%{"Small" => grew(1), "Big" => grew(9)}), completion())

      assert {:supported, because} = result.updates.retained_library_object
      assert because =~ "Big"
      assert because =~ "Small"
    end

    test "a run that produced no snapshot evidence does not crash" do
      result = Snapshot.interpret([], nil)

      assert result.updates == %{}
      assert result.measurement_validity.status == :unavailable
      assert "missing_or_duplicate_heap_census" in result.measurement_validity.reasons
      assert result.cost_ms == 0
    end

    test "failed or unconfirmed GC, navigation and visit completion cannot update hypotheses" do
      for {field, value, reason} <- [
            {"gcOk", false, "snapshot_gc_unconfirmed"},
            {"navigationOk", false, "snapshot_navigation_unconfirmed"},
            {"visitsCompleted", 2, "incomplete_snapshot_visits"}
          ] do
        [event] = events(%{"Chart" => grew(4)})
        invalid = put_in(event, ["data", field], value)
        result = Snapshot.interpret([invalid], completion())
        assert result.updates == %{}
        assert reason in result.measurement_validity.reasons
        assert result.evidence == [invalid]

        result = Snapshot.interpret([event], Map.delete(completion(), field))
        assert result.updates == %{}
        assert reason in result.measurement_validity.reasons
      end
    end

    test "wrong route, malformed context, duplicate and malformed growth stay unavailable" do
      [event] = events(%{"Chart" => grew(4)})

      for captured <- [
            [put_in(event, ["context", "route"], "/other")],
            [%{event | "context" => "invalid"}],
            [event, event],
            [put_in(event, ["data", "growth"], %{"Chart" => %{"retained" => "4"}})],
            [put_in(event, ["data", "growth"], nil)]
          ] do
        result = Snapshot.interpret(captured, completion(), %{route: "/charts"})
        assert result.updates == %{}
        assert result.measurement_validity.status == :unavailable
      end

      result = Snapshot.interpret([event], %{completion() | "ok" => false})
      assert "driver_completion_unconfirmed" in result.measurement_validity.reasons
      assert result.updates == %{}
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
