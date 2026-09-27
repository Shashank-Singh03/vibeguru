defmodule VibeGuru.Analyzers.CensusTest do
  use ExUnit.Case, async: true

  alias VibeGuru.{Evidence, Finding}
  alias VibeGuru.Analyzers.Census

  # Build the census chain a run produces: a baseline, then one per (cycle, route)
  # carrying running totals. `per_visit` says what each route leaves behind each time,
  # which is exactly what the consecutive diff is supposed to recover.
  defp chain(per_visit, cycles, opts \\ []) do
    start = Keyword.get(opts, :start, %{})

    baseline =
      Evidence.new(:"memory.client", :census,
        phase: :baseline,
        cycle: 0,
        context: %{"route" => "/"},
        data: %{"counts" => start}
      )

    {samples, _final} =
      Enum.reduce(
        for(cycle <- 1..cycles, {route, delta} <- per_visit, do: {cycle, route, delta}),
        {[], start},
        fn {cycle, route, delta}, {acc, current} ->
          next =
            Enum.reduce(delta, current, fn {class, step}, acc_counts ->
              Map.update(acc_counts, class, step, &(&1 + step))
            end)

          evidence =
            Evidence.new(:"memory.client", :census,
              phase: :cycle,
              cycle: cycle,
              context: %{"route" => route},
              data: %{"counts" => next}
            )

          {[evidence | acc], next}
        end
      )

    [baseline | Enum.reverse(samples)]
  end

  defp analyze(evidences, config \\ %{}) do
    {:ok, findings} = Census.analyze(evidences, config)
    findings
  end

  defp classes(findings), do: Enum.map(findings, & &1.metrics.class)

  # --- nothing to report --------------------------------------------------

  describe "clean runs" do
    test "no census evidence yields no findings" do
      assert analyze([]) == []
    end

    test "a class whose count never moves is not a leak" do
      findings = chain([{"/stable", %{}}], 5, start: %{"Chart" => 3}) |> analyze()

      assert findings == []
    end

    test "a count that rises and falls is a cache, not a leak" do
      # Up one visit, down the next: something is releasing them. Consistency is what
      # separates a pool doing its job from an app that never lets go.
      evidences = chain([{"/cache", %{"WebSocket" => 1}}, {"/cache", %{"WebSocket" => -1}}], 5)

      assert analyze(evidences) == []
    end

    test "a class the page does not have is skipped, not counted as zero" do
      # null means "never asked" — treating it as 0 would invent a drop from the
      # baseline and then a rise on the next cycle, i.e. a leak that is not there.
      evidences =
        chain([{"/x", %{}}], 4, start: %{"Chart" => 2})
        |> Enum.map(fn e -> put_in(e.data["counts"], %{"Chart" => nil}) end)

      assert analyze(evidences) == []
    end
  end

  # --- the signature ------------------------------------------------------

  describe "retained_instances" do
    test "a class retained every visit is flagged, and named" do
      [finding] = chain([{"/charts", %{"Chart" => 1}}], 5) |> analyze()

      assert finding.signature == :retained_instances
      assert finding.severity == :high
      assert finding.vector == :"census.client"
      assert finding.metrics.class == "Chart"
      assert finding.metrics.instances_per_visit == 1
      assert finding.location == %{route: "/charts"}
    end

    test "the finding says what it costs and how to release it" do
      # The point of counting instances is advice that names the actual call, instead
      # of "look for arrays/maps/caches at module scope".
      [finding] = chain([{"/charts", %{"Chart" => 1}}], 5) |> analyze()

      assert finding.summary =~ "canvas"
      assert finding.fix.hint =~ "chart.destroy()"
      assert finding.ai_prompt =~ "[Vibe Guru finding: retained_instances]"
      assert finding.ai_prompt =~ "/charts"
    end

    test "each class on a route is reported separately" do
      findings =
        chain([{"/observers", %{"ResizeObserver" => 1, "WebSocket" => 1}}], 5)
        |> analyze()

      assert Enum.sort(classes(findings)) == ["ResizeObserver", "WebSocket"]
      assert Enum.all?(findings, &(&1.location.route == "/observers"))
    end

    test "only the leaking route is blamed" do
      findings =
        chain([{"/clean", %{}}, {"/leaky", %{"Worker" => 1}}], 5)
        |> analyze()

      assert Enum.map(findings, & &1.location.route) == ["/leaky"]
    end

    test "an unknown class still produces usable advice" do
      [finding] = chain([{"/x", %{"MyCustomThing" => 2}}], 5) |> analyze()

      assert finding.metrics.class == "MyCustomThing"
      assert finding.summary =~ "holds whatever it references"
      assert finding.fix.hint =~ "release it explicitly"
    end
  end

  # --- method -------------------------------------------------------------

  describe "attribution method" do
    test "the warm-up cycle is excluded" do
      # A chart constructed once on first mount is not a leak. Only cycle 1 grows here,
      # so with enough cycles to drop it nothing should fire.
      evidences =
        chain([{"/warmup", %{}}], 5)
        |> Enum.map(fn e ->
          if e.phase == :cycle and e.cycle >= 1 do
            put_in(e.data["counts"], %{"Chart" => 1})
          else
            put_in(e.data["counts"], %{"Chart" => 0})
          end
        end)

      assert analyze(evidences) == []
    end

    test "thresholds are configurable" do
      evidences = chain([{"/busy", %{"Texture" => 2}}], 5)

      assert [_] = analyze(evidences)
      assert [] = analyze(evidences, %{thresholds: %{per_route_min_instances: 5}})
    end

    test "consistent growth reads as high confidence" do
      [finding] = chain([{"/charts", %{"Chart" => 1}}], 5) |> analyze()
      assert finding.confidence == :high
    end

    test "findings carry a stable, unique id per class and route" do
      findings =
        chain([{"/a", %{"Chart" => 1}}, {"/b", %{"Chart" => 1}}], 5)
        |> analyze()

      ids = Enum.map(findings, & &1.id)
      assert ids == Enum.uniq(ids)
      assert Enum.all?(findings, &match?(%Finding{}, &1))
    end
  end
end
