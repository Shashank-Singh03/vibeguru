# Regenerate the public example from actual evidence, never invented client results.
input = List.first(System.argv()) || "reports/product-implementation/vibeguru-findings.json"
report = input |> File.read!() |> Jason.decode!()
unless String.contains?(get_in(report, ["profile", "root"]) || "", "test-app"), do: raise("Only the bundled fixture may be published as this example")

defmodule SampleReport do
  def fields(map, names), do: Map.new(names, &{&1, map[Atom.to_string(&1)]})
  def sanitize(value) when is_map(value), do: Map.new(value, fn {k, v} -> {k, sanitize(v)} end)
  def sanitize(value) when is_list(value), do: Enum.map(value, &sanitize/1)
  def sanitize(value) when is_binary(value), do: String.replace(value, File.cwd!(), "bundled")
  def sanitize(value), do: value
  def html(report) do
    top = fields(report, ~w(tool vector schema_version verdict generated_at evidence_count run validity_reasons summary)a)
    profile = fields(report["profile"], ~w(root url stack bundler)a)
    coverage = fields(report["coverage"], ~w(visited unreachable declared discovered routes_known ratio low mode flow_completed flow_planned flow_failures)a)
    evidence = Enum.map(report["evidence"], fn item ->
      e = fields(item, ~w(id kind phase cycle context data)a)
      %{e | kind: if(e.kind == "sample", do: :sample, else: e.kind)}
    end)
    findings = Enum.map(report["findings"], fn item ->
      f = fields(item, ~w(id vector signature title summary severity confidence metrics evidence_refs ai_prompt)a)
      Map.merge(f, %{fix: fields(item["fix"], ~w(summary hint root_cause)a), location: fields(item["location"], ~w(route file line)a)})
    end)
    validity = Map.new(report["measurement_validity"], fn {key, value} -> {key, fields(value, ~w(status reasons unavailable_targets)a)} end)
    VibeGuru.Reporter.Html.document(Map.merge(top, %{profile: profile, coverage: coverage, findings: findings, evidence: evidence, measurement_validity: validity}))
  end
end

report = SampleReport.sanitize(report)
File.mkdir_p!("examples")
File.write!("examples/sample-report.json", Jason.encode!(report, pretty: true))
File.write!("examples/sample-report.html", SampleReport.html(report))
IO.puts("Generated fixture example in examples/ (workspace path redacted).")
