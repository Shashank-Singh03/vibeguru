defmodule VibeGuru.Analyzers.JourneyTest do
  use ExUnit.Case, async: true
  alias VibeGuru.{Evidence, Analyzers.Journey}

  test "failed explicit assertions retain their evidence and independent checks" do
    records =
      for {id, cycle} <- [{"latest", 1}, {"latest", 2}, {"visible", 2}] do
        Evidence.new(:"memory.client", :journey_assertion,
          id: "#{id}_#{cycle}",
          cycle: cycle,
          context: %{"route" => "/reports"},
          data: %{"assertionId" => id, "status" => "fail", "message" => id}
        )
      end

    {:ok, findings} = Journey.analyze(records, %{})
    assert length(findings) == 2
    latest = Enum.find(findings, &(&1.metrics.assertion_id == "latest"))
    assert latest.evidence_refs == ["latest_1", "latest_2"]
    assert latest.severity == :high
    assert latest.ai_prompt =~ "Keep this assertion enabled"
    assert latest.fix.summary == "Reproduce the failed journey outcome"
  end

  test "successful assertions and uncompleted interactions do not become app failures" do
    records = [
      Evidence.new(:"memory.client", :journey_assertion, data: %{"status" => "pass"}),
      Evidence.new(:"memory.client", :journey_result,
        data: %{"completed" => false, "message" => "timeout"}
      )
    ]

    assert {:ok, []} = Journey.analyze(records, %{})
  end

  test "failed assertions retain same-cycle and route observations without inventing a cause" do
    assertion =
      Evidence.new(:"memory.client", :journey_assertion,
        id: "failed",
        cycle: 2,
        context: %{"route" => "/logs"},
        data: %{"assertionId" => "latest", "status" => "fail"}
      )

    observation = fn id, cycle, route ->
      Evidence.new(:"memory.client", :experiment_observation,
        id: id,
        cycle: cycle,
        context: %{"route" => route},
        data: %{"payload" => %{}}
      )
    end

    evidence = [
      assertion,
      observation.("order", 2, "/logs"),
      observation.("other-cycle", 1, "/logs"),
      observation.("other-route", 2, "/elsewhere")
    ]

    assert {:ok, [finding]} = Journey.analyze(evidence, %{})
    assert finding.evidence_refs == ["failed", "order"]
    assert finding.ai_prompt =~ "does not identify a cause"
  end
end
