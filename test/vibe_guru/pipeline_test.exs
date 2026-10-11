defmodule VibeGuru.PipelineTest do
  use ExUnit.Case, async: false
  alias VibeGuru.{Config, Driver, Pipeline, Result}

  setup do
    root = Path.join(System.tmp_dir!(), "vibeguru_contract_#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    previous = System.get_env("VIBEGURU_TEST_RESULT")
    System.delete_env("VIBEGURU_TEST_RESULT")

    on_exit(fn ->
      File.rm_rf!(root)

      if previous,
        do: System.put_env("VIBEGURU_TEST_RESULT", previous),
        else: System.delete_env("VIBEGURU_TEST_RESULT")
    end)

    %{root: root}
  end

  defp run(root, overrides \\ %{}, options \\ []) do
    System.put_env("VIBEGURU_TEST_RESULT", Jason.encode!(overrides))

    Pipeline.memory_client(
      "http://localhost:9999",
      [
        root: root,
        out_dir: root,
        cycles: 3,
        driver_path: Path.expand("test/fixtures/valid-driver.cjs")
      ] ++ options
    )
  end

  test "complete clean scope has matching JSON, Markdown, HTML and exit verdict", %{root: root} do
    assert {:ok, result} = run(root)
    assert result.verdict == "PASS"
    assert Result.exit_code(result.verdict) == 0
    report = root |> Path.join("vibeguru-findings.json") |> File.read!() |> Jason.decode!()
    assert report["schema_version"] == 2
    assert report["verdict"] == result.verdict
    assert report["evidence_count"] == length(report["evidence"])
    validator = Path.expand("mcp/report.js")
    report_path = Path.join(root, "vibeguru-findings.json")

    assert {"PASS", 0} =
             System.cmd("node", [
               "-e",
               "const fs=require('fs');const {assessReport}=require(process.argv[1]);process.stdout.write(assessReport(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))).verdict)",
               validator,
               report_path
             ])

    for file <- ["vibeguru-report.md", "CLAUDE.md", "vibeguru-report.html"] do
      body = File.read!(Path.join(root, file))
      assert body =~ "PASS"
      refute body =~ "Every route returned"
    end
  end

  test "invalid measurements, missing evidence and failed steps cannot pass", %{root: root} do
    cases = [
      %{result: %{gcFailures: 1}},
      %{metrics: %{heapUsed: nil}},
      %{metrics: %{nodes: -1}},
      %{metrics: %{gcOk: false}},
      %{metrics: %{mutationWindowMs: 0}},
      %{noEvidence: true},
      %{missingCycle: 2},
      %{missingCensus: 2},
      %{counts: %{WebSocket: nil}},
      %{result: %{runtimeObserved: false}},
      %{result: %{flowFailures: 1}},
      %{result: %{retentionInvalid: true}},
      %{coverage: %{unreachable: [%{path: "/private", reason: "auth_required"}]}}
    ]

    for changes <- cases do
      assert {:ok, result} = run(root, changes)
      assert result.verdict == "INCONCLUSIVE", inspect(changes)
      assert Result.exit_code(result.verdict) == 3
      assert result.validity_reasons != []
    end
  end

  test "blocking runtime evidence stays FAIL with invalid GC and unique references", %{root: root} do
    assert {:ok, result} =
             run(root, %{result: %{gcFailures: 1}, errors: ["first error", "second error"]})

    assert result.verdict == "FAIL"
    assert Result.exit_code(result.verdict) == 1
    assert length(result.findings) == 2
    assert length(Enum.uniq_by(result.findings, & &1.id)) == 2
    assert length(Enum.uniq_by(result.evidence, & &1.id)) == length(result.evidence)
    ids = MapSet.new(result.evidence, & &1.id)

    for f <- result.findings do
      assert f.evidence_refs != []
      assert Enum.all?(f.evidence_refs, &MapSet.member?(ids, &1))
      assert f.summary =~ "originating route is unverified"
    end
  end

  test "inconsistent or missing flow marks cannot pass", %{root: root} do
    for routes <- [
          %{"1" => "/clean", "2" => "/late-only", "3" => "/clean"},
          %{"1" => "", "2" => "", "3" => ""}
        ] do
      assert {:ok, result} = run(root, %{routeByCycle: routes}, flow: "controlled-flow.mjs")
      assert result.verdict == "INCONCLUSIVE"
      assert "incomplete_cycle_scope" in result.validity_reasons
    end
  end

  test "missing completion is a protocol error", %{root: root} do
    assert {:error, :missing_driver_result} = run(root, %{noResult: true})
  end

  test "current journey protocol requires observed execution outcomes", %{root: root} do
    assert {:ok, result} =
             run(root, %{result: %{journeyProtocolVersion: 1}, outcomes: []},
               flow: "controlled-flow.mjs"
             )

    assert result.verdict == "INCONCLUSIVE"
    assert "incomplete_journey_results" in result.validity_reasons
  end

  test "removing both flow completion and its protocol flag cannot preserve PASS", %{root: root} do
    assert {:ok, result} =
             run(root, %{result: %{journeyProtocolVersion: nil}, outcomes: []},
               flow: "controlled-flow.mjs"
             )

    assert result.verdict == "INCONCLUSIVE"
    assert "incomplete_journey_results" in result.validity_reasons
  end

  test "declared journey outcomes require exactly one valid assertion per cycle", %{root: root} do
    assertions =
      for cycle <- 1..3,
          do: %{cycle: cycle, data: %{assertionId: "content-visible", status: "pass"}}

    changes = %{result: %{journeyChecks: ["content-visible"]}, assertions: assertions}
    assert {:ok, complete} = run(root, changes, flow: "controlled-flow.mjs")
    assert complete.verdict == "PASS"

    for partial <- [
          [],
          Enum.take(assertions, 2),
          [hd(assertions), hd(assertions), List.last(assertions)],
          List.update_at(assertions, 1, &put_in(&1, [:data, :status], "unknown"))
        ] do
      assert {:ok, incomplete} =
               run(root, %{changes | assertions: partial}, flow: "controlled-flow.mjs")

      assert incomplete.verdict == "INCONCLUSIVE"
      assert "incomplete_journey_assertions" in incomplete.validity_reasons
    end
  end

  test "journey completions must belong to cycles and cannot also report execution errors", %{
    root: root
  } do
    outcomes = for cycle <- 1..3, do: %{cycle: cycle, data: %{completed: true}}
    changes = %{result: %{journeyProtocolVersion: 1}, outcomes: outcomes}
    assert {:ok, complete} = run(root, changes, flow: "controlled-flow.mjs")
    assert complete.verdict == "PASS"

    for malformed <- [
          List.update_at(outcomes, 0, &Map.put(&1, :phase, "baseline")),
          List.update_at(outcomes, 0, &put_in(&1, [:data, :errorType], "Error"))
        ] do
      assert {:ok, incomplete} =
               run(root, %{changes | outcomes: malformed}, flow: "controlled-flow.mjs")

      assert incomplete.verdict == "INCONCLUSIVE"
      assert "incomplete_journey_results" in incomplete.validity_reasons
    end
  end

  test "explicit failed outcomes remain blocking when the rest of a journey is incomplete", %{
    root: root
  } do
    assert {:ok, result} =
             run(
               root,
               %{
                 result: %{journeyChecks: ["content-visible"], flowFailures: 1},
                 assertions: [
                   %{
                     cycle: 1,
                     data: %{
                       assertionId: "content-visible",
                       status: "fail",
                       message: "Content is hidden"
                     }
                   }
                 ]
               },
               flow: "controlled-flow.mjs"
             )

    assert result.verdict == "FAIL"
    assert "incomplete_journey_assertions" in result.validity_reasons
    assert [%{signature: :journey_assertion_failed, evidence_refs: [_]}] = result.findings
    report = File.read!(Path.join(root, "vibeguru-report.md"))
    assert report =~ "failed_cycles=[1]"
    assert File.read!(Path.join(root, "CLAUDE.md")) =~ "Keep this assertion enabled"
  end

  test "undeclared or malformed journey assertions cannot preserve a clean verdict", %{root: root} do
    for data <- [
          %{assertionId: "unannounced", status: "pass"},
          %{assertionId: "unannounced", status: "unknown"},
          %{status: "pass"}
        ] do
      assert {:ok, result} =
               run(root, %{assertions: [%{cycle: 1, data: data}]}, flow: "controlled-flow.mjs")

      assert result.verdict == "INCONCLUSIVE"
      assert "incomplete_journey_assertions" in result.validity_reasons
    end
  end

  defmodule FailingReporter do
    def id, do: :broken
    def render(_, _), do: {:error, :eacces}
  end

  test "reporter and output directory failures abort the run", %{root: root} do
    assert {:error, {:report_write_failed, {:broken, :eacces}}} =
             run(root, %{}, reporters: [FailingReporter])

    file = Path.join(root, "not-a-directory")
    File.write!(file, "existing file")
    System.put_env("VIBEGURU_TEST_RESULT", "{}")

    assert {:error, {:report_write_failed, _}} =
             Pipeline.memory_client("http://localhost:9999",
               root: root,
               out_dir: file,
               cycles: 3,
               driver_path: Path.expand("test/fixtures/valid-driver.cjs")
             )
  end

  test "a late reporter failure preserves previously completed reports", %{root: root} do
    assert {:ok, _} = run(root)
    previous = File.read!(Path.join(root, "vibeguru-findings.json"))

    assert {:error, {:report_write_failed, {:broken, :eacces}}} =
             run(root, %{}, reporters: [VibeGuru.Reporter.Json, FailingReporter])

    assert File.read!(Path.join(root, "vibeguru-findings.json")) == previous
    refute Enum.any?(File.ls!(root), &String.starts_with?(&1, ".vibeguru-report-"))
  end

  test "blocked report destinations do not publish a fresh clean JSON", %{root: root} do
    File.mkdir!(Path.join(root, "CLAUDE.md"))

    assert {:error, {:report_write_failed, {:invalid_report_destination, "CLAUDE.md"}}} =
             run(root)

    refute File.exists?(Path.join(root, "vibeguru-findings.json"))
    refute File.exists?(Path.join(root, "vibeguru-report.html"))
  end

  test "saved route params, selectors, targets and thresholds round-trip", %{root: root} do
    File.write!(
      Config.path(root),
      Jason.encode!(%{
        url: "http://localhost:9999",
        routeParams: %{id: "42"},
        routeExpectations: %{"/users/42" => "h1"},
        censusTargets: ["CustomClass"],
        thresholds: %{per_route_min_nodes: 77}
      })
    )

    assert {:ok, config} = Config.load(root)
    opts = Config.to_run_opts(config)
    assert opts[:route_params] == %{"id" => "42"}
    assert opts[:route_expectations] == %{"/users/42" => "h1"}
    assert opts[:census_targets] == ["CustomClass"]
    assert opts[:thresholds] == %{per_route_min_nodes: 77}
    Config.save(config, root)
    assert {:ok, ^config} = Config.load(root)
  end

  test "driver deadline is total, even with continuous logs", %{root: root} do
    script = Path.join(root, "heartbeat.cjs")

    File.write!(
      script,
      "process.stdout.on('error',()=>process.exit(0));setInterval(() => process.stdout.write(JSON.stringify({type:'log'})+'\\n'), 10)"
    )

    started = System.monotonic_time(:millisecond)
    assert {:error, :driver_timeout} = Driver.run(%{}, driver_path: script, timeout_ms: 200)
    assert System.monotonic_time(:millisecond) - started < 2000
  end
end
