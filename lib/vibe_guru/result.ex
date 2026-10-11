defmodule VibeGuru.Result do
  @moduledoc "Scoped verdicts and measurement validity shared by every output."
  alias VibeGuru.Evidence

  @schema_version 2
  def schema_version, do: @schema_version

  def assess(findings, evidence, coverage, config) do
    samples = Enum.filter(evidence, &(&1.kind == :sample))
    cycles = Enum.filter(samples, &(&1.phase == :cycle))
    run = Enum.find(evidence, &(&1.kind == :run_result))
    data = if run, do: run.data, else: %{}
    mode = Map.get(config, :mode, "auto")

    scope_reasons =
      []
      |> reason(is_nil(run), "missing_driver_result")
      |> reason(data["ok"] != true, "driver_completion_unconfirmed")
      |> reason(data["cycles"] != Map.get(config, :cycles), "cycle_count_mismatch")
      |> reason(not matching_config?(data, config), "inconsistent_run_configuration")
      |> reason(is_nil(coverage), "missing_coverage")
      |> reason(not matching_coverage?(evidence, data), "inconsistent_driver_coverage")
      |> reason(not complete_journey_checks?(evidence, data), "incomplete_journey_assertions")
      |> reason(not complete_journey_results?(evidence, data), "incomplete_journey_results")
      |> reason(
        mode == "auto" and (is_nil(coverage) or coverage.known == 0),
        "no_routes_exercised"
      )
      |> reason(not is_nil(coverage) and coverage.unreachable != [], "unreachable_routes")
      |> reason(data["flowFailures"] != 0, "failed_interactions")
      |> reason(data["navigationFailures"] != 0, "failed_navigation")
      |> reason(data["retentionInvalid"] != false, "retained_state_chain_reset")
      |> reason(Map.get(config, :cycles, 0) < 3, "insufficient_cycles")
      |> reason(
        mode == "flow" and data["flowCompleted"] != Map.get(config, :cycles),
        "incomplete_flow"
      )

    expected =
      Map.get(config, :cycles, 0) *
        if(mode == "flow", do: 1, else: max(length((coverage && coverage.visited) || []), 1))

    memory_reasons =
      scope_reasons
      |> reason(data["gcFailures"] not in [0], "gc_status_missing_or_failed")
      |> reason(not Enum.any?(samples, &(&1.phase == :baseline)), "missing_baseline")
      |> reason(not Enum.any?(samples, &(&1.phase == :cooldown)), "missing_cooldown")
      |> reason(not valid_sample_order?(samples, config), "inconsistent_sample_order")
      |> reason(length(cycles) < expected, "incomplete_samples")
      |> reason(not complete_cycles?(cycles, coverage, config), "incomplete_cycle_scope")
      |> reason(Enum.any?(samples, &(&1.data["gcOk"] != true)), "sample_gc_unconfirmed")
      |> reason(
        Enum.any?(samples, fn s ->
          Enum.any?(~w(heapUsed nodes listeners documents), &(not numeric?(s.data[&1])))
        end),
        "missing_memory_metrics"
      )

    runtime_reasons =
      scope_reasons
      |> reason(data["runtimeObserved"] != true, "runtime_observation_unconfirmed")
      |> reason(
        Enum.any?(cycles, fn s ->
          not numeric?(s.data["mutations"]) or not numeric?(s.data["mutationWindowMs"]) or
            s.data["mutationWindowMs"] == 0
        end),
        "missing_mutation_metrics"
      )

    censuses = Enum.filter(evidence, &(&1.kind == :census))
    targets = Map.get(config, :census_targets, [])

    unavailable =
      Enum.filter(targets, fn target ->
        censuses == [] or
          Enum.any?(censuses, fn c ->
            count = get_in(c.data, ["counts", target])
            not is_integer(count) or count < 0
          end)
      end)

    census_reasons =
      memory_reasons
      |> reason(targets == [], "no_census_targets")
      |> reason(length(censuses) < expected + 1, "incomplete_census")
      |> reason(not paired_censuses?(samples, censuses, evidence), "incomplete_census")
      |> reason(unavailable != [], "unavailable_census_targets")

    validity = %{
      scope: validity(scope_reasons),
      "memory.client": validity(memory_reasons),
      "runtime.client": validity(runtime_reasons),
      "census.client": Map.put(validity(census_reasons), :unavailable_targets, unavailable)
    }

    reasons = Enum.flat_map(Map.values(validity), & &1.reasons) |> Enum.uniq()

    verdict =
      cond do
        Enum.any?(findings, &(&1.severity in [:high, :critical])) -> "FAIL"
        reasons != [] -> "INCONCLUSIVE"
        true -> "PASS"
      end

    %{
      schema_version: @schema_version,
      verdict: verdict,
      measurement_validity: validity,
      validity_reasons: reasons,
      run: Map.drop(data, ["type", "coverage"])
    }
  end

  def exit_code("PASS"), do: 0
  def exit_code("FAIL"), do: 1
  def exit_code("INCONCLUSIVE"), do: 3
  def exit_code(_), do: 2

  defp complete_journey_checks?(evidence, data) do
    checks = Map.get(data, "journeyChecks", [])
    assertions = Enum.filter(evidence, &(&1.kind == :journey_assertion))

    is_list(checks) and Enum.all?(checks, &(is_binary(&1) and String.trim(&1) != "")) and
      length(Enum.uniq(checks)) == length(checks) and
      Enum.all?(assertions, fn assertion ->
        assertion.phase == :cycle and assertion.data["assertionId"] in checks and
          is_integer(assertion.cycle) and assertion.cycle >= 1 and
          assertion.cycle <= data["cycles"] and assertion.data["status"] in ["pass", "fail"]
      end) and
      (checks == [] or
         (is_integer(data["cycles"]) and data["cycles"] > 0 and
            Enum.all?(checks, fn id ->
              matches = Enum.filter(assertions, &(&1.data["assertionId"] == id))

              length(matches) == data["cycles"] and
                length(Enum.uniq_by(matches, & &1.cycle)) == data["cycles"] and
                Enum.all?(matches, fn assertion ->
                  is_integer(assertion.cycle) and assertion.cycle >= 1 and
                    assertion.cycle <= data["cycles"] and
                    assertion.data["status"] in ["pass", "fail"]
                end)
            end)))
  end

  defp complete_journey_results?(evidence, data) do
    outcomes = Enum.filter(evidence, &(&1.kind == :journey_result))

    if outcomes == [] and data["mode"] != "flow" and data["journeyProtocolVersion"] != 1 do
      true
    else
      (data["mode"] != "flow" or data["journeyProtocolVersion"] == 1) and
        is_integer(data["cycles"]) and data["cycles"] > 0 and
        length(outcomes) == data["cycles"] and
        length(Enum.uniq_by(outcomes, & &1.cycle)) == data["cycles"] and
        Enum.all?(outcomes, fn outcome ->
          outcome.phase == :cycle and is_integer(outcome.cycle) and outcome.cycle >= 1 and
            outcome.cycle <= data["cycles"] and is_boolean(outcome.data["completed"]) and
            if outcome.data["completed"] do
              is_nil(outcome.data["errorType"]) and is_nil(outcome.data["message"])
            else
              is_binary(outcome.data["errorType"]) and
                String.trim(outcome.data["errorType"]) != ""
            end
        end) and
        Enum.count(outcomes, &(&1.data["completed"] == true)) == data["flowCompleted"] and
        Enum.count(outcomes, &(&1.data["completed"] == false)) == data["flowFailures"]
    end
  end

  def message("PASS"), do: "No blocking issues detected within the tested scope."

  def message("FAIL"),
    do: "Blocking findings detected; reproduce and triage before applying a fix."

  def message("INCONCLUSIVE"),
    do: "Required checks were incomplete. The tested scope is unverified."

  def message(_), do: "Execution or report generation failed."

  defp validity([]), do: %{status: "complete", reasons: []}
  defp validity(reasons), do: %{status: "partial", reasons: Enum.uniq(reasons)}
  defp reason(reasons, true, value), do: reasons ++ [value]
  defp reason(reasons, _, _), do: reasons
  defp numeric?(value), do: is_number(value) and value >= 0

  defp matching_config?(data, config) do
    data["mode"] == Map.get(config, :mode, "auto") and
      data["settleMs"] == config[:settle_ms] and data["routesLimit"] == config[:routes_limit] and
      data["censusTargets"] == config[:census_targets] and
      is_binary(data["url"]) and data["url"] != "" and
      (is_nil(config[:profile]) or data["url"] == config.profile.url)
  end

  defp matching_coverage?(evidence, data) do
    case Enum.filter(evidence, &(&1.kind == :coverage)) do
      [record] ->
        raw = record.data

        raw == data["coverage"] and is_list(raw["planned"]) and
          length(raw["planned"]) == data["routeCount"] and
          is_list(raw["visited"]) and Enum.uniq(raw["visited"]) == raw["visited"] and
          raw["mode"] == data["mode"] and
          if(data["mode"] == "flow",
            do:
              raw["flow_planned"] == data["cycles"] and
                raw["flow_completed"] == data["flowCompleted"] and
                raw["flow_failures"] == data["flowFailures"],
            else:
              raw["flow_planned"] == 0 and raw["flow_completed"] == 0 and
                raw["flow_failures"] == 0 and data["flowCompleted"] == 0
          )

      _ ->
        false
    end
  end

  defp valid_sample_order?(samples, config) do
    phases = Enum.map(samples, & &1.phase)
    cycle_numbers = samples |> Enum.filter(&(&1.phase == :cycle)) |> Enum.map(& &1.cycle)

    length(Enum.filter(phases, &(&1 == :baseline))) == 1 and
      length(Enum.filter(phases, &(&1 == :cooldown))) == 1 and
      List.first(phases) == :baseline and List.last(phases) == :cooldown and
      Enum.all?(phases, &(&1 in [:baseline, :cycle, :cooldown])) and
      hd(samples).cycle == 0 and List.last(samples).cycle == Map.get(config, :cycles, 0) + 1 and
      cycle_numbers == Enum.sort(cycle_numbers) and
      Enum.all?(
        cycle_numbers,
        &(is_integer(&1) and &1 >= 1 and &1 <= Map.get(config, :cycles, 0))
      )
  end

  defp paired_censuses?(samples, censuses, evidence) do
    required = Enum.filter(samples, &(&1.phase in [:baseline, :cycle]))
    key = fn e -> {e.phase, e.cycle, e.context["route"]} end
    sample_keys = Enum.map(required, key)
    census_keys = Enum.map(censuses, key)
    positions = Map.new(Enum.with_index(evidence), fn {e, index} -> {e.id, index} end)

    sample_keys != [] and Enum.sort(sample_keys) == Enum.sort(census_keys) and
      Enum.all?(required, fn sample ->
        census = Enum.find(censuses, &(key.(&1) == key.(sample)))
        index = positions[sample.id]
        next_sample = Enum.find(samples, &(positions[&1.id] > index))

        positions[census.id] > index and
          (is_nil(next_sample) or positions[census.id] < positions[next_sample.id])
      end)
  end

  defp complete_cycles?(samples, coverage, config) do
    cycles = Map.get(config, :cycles, 0)

    if cycles < 1 do
      false
    else
      groups = Enum.group_by(samples, & &1.cycle)

      expected_routes =
        if Map.get(config, :mode) == "flow",
          do: samples |> Enum.map(& &1.context["route"]) |> Enum.uniq(),
          else: (coverage && coverage.visited) || []

      Enum.all?(samples, &(is_binary(&1.context["route"]) and &1.context["route"] != "")) and
        Enum.all?(1..cycles, fn cycle ->
          observed = Enum.map(groups[cycle] || [], & &1.context["route"])

          observed != [] and
            Enum.all?(expected_routes, fn route ->
              Enum.count(observed, &(&1 == route)) == 1
            end)
        end)
    end
  end

  # Memory/census conclusions require collections and a continuous retained-state chain.
  # Runtime observations remain useful when those measurements fail.
  def retention_valid?(evidence) do
    result = Enum.find(evidence, &(&1.kind == :run_result))

    is_nil(result) or
      (result.data["gcFailures"] == 0 and result.data["retentionInvalid"] != true and
         result.data["flowFailures"] in [nil, 0] and
         Enum.all?(Enum.filter(evidence, &(&1.kind == :sample)), fn sample ->
           sample.data["gcOk"] == true and
             Enum.all?(~w(heapUsed nodes listeners documents), &numeric?(sample.data[&1]))
         end))
  end

  def attach_evidence(findings, evidence) do
    Enum.map(findings, fn f ->
      refs =
        case f.vector do
          :"journey.client" ->
            Enum.filter(evidence, fn e ->
              e.kind == :journey_assertion and e.data["status"] == "fail" and
                e.data["assertionId"] == f.metrics[:assertion_id] and
                e.context["route"] == f.location[:route]
            end)

          :"runtime.client" ->
            Enum.filter(evidence, fn e ->
              if f.signature == :render_loop do
                e.kind == :sample and e.context["route"] == f.location[:route]
              else
                e.kind == :runtime_event and e.data["message"] == f.metrics[:message]
              end
            end)

          :"census.client" ->
            Enum.filter(evidence, &(&1.kind == :census))

          _ ->
            Enum.filter(evidence, &(&1.kind == :sample))
        end

      digest =
        :crypto.hash(
          :sha256,
          :erlang.term_to_binary({f.vector, f.signature, f.location, f.metrics})
        )
        |> Base.encode16(case: :lower)
        |> binary_part(0, 12)

      %{
        f
        | id: f.id <> "." <> digest,
          evidence_refs: Enum.uniq(f.evidence_refs ++ Enum.map(refs, & &1.id))
      }
    end)
  end

  def evidence_maps(evidence), do: Enum.map(evidence, &Evidence.to_map/1)
end
