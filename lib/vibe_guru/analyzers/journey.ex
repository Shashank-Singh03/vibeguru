defmodule VibeGuru.Analyzers.Journey do
  @moduledoc "Explicit user-authored journey assertions, separate from execution failures."
  @behaviour VibeGuru.Analyzer
  alias VibeGuru.Finding

  @impl true
  def id, do: :journey

  @impl true
  def analyze(evidence, _config) do
    findings =
      evidence
      |> Enum.filter(&(&1.kind == :journey_assertion and &1.data["status"] == "fail"))
      |> Enum.group_by(&{&1.data["assertionId"], &1.context["route"]})
      |> Enum.map(fn {{id, route}, records} ->
        digest =
          :crypto.hash(:sha256, :erlang.term_to_binary({id, route}))
          |> Base.encode16(case: :lower)

        message = hd(records).data["message"] || id
        failed_cycles = MapSet.new(records, & &1.cycle)

        observations =
          Enum.filter(evidence, fn observation ->
            observation.kind == :experiment_observation and
              observation.context["route"] == route and
              MapSet.member?(failed_cycles, observation.cycle)
          end)

        %Finding{
          id: "journey_#{digest}",
          vector: :"journey.client",
          signature: :journey_assertion_failed,
          severity: :high,
          confidence: :high,
          title: "Journey assertion failed: #{id}",
          summary:
            "#{message}. Explicit assertion failed in #{length(records)} cycle(s); other outcomes may be incomplete.",
          evidence_refs: Enum.map(records ++ observations, & &1.id),
          location: %{route: route},
          metrics: %{assertion_id: id, failed_cycles: Enum.map(records, & &1.cycle)},
          fix: %{
            summary: "Reproduce the failed journey outcome",
            hint:
              "Inspect the supplied assertion and preserve required behavior when checking a fix."
          },
          ai_prompt:
            "Reproduce journey assertion #{inspect(id)} on #{route}: #{message}. " <>
              "Inspect the flow and its evidence before choosing a code change. " <>
              "Keep this assertion enabled and rerun it with neighboring outcomes after the change. " <>
              "A failed assertion establishes the supplied expectation failed; it does not identify a cause."
        }
      end)

    {:ok, Finding.sort(findings)}
  end
end
