defmodule VibeGuru.Reporter.Html do
  @moduledoc "Standalone evidence report. No accounts, remote scripts or data uploads."
  @behaviour VibeGuru.Reporter
  alias VibeGuru.Reporter.Json
  @validator_path Path.expand("../../../mcp/report.js", __DIR__)
  @external_resource @validator_path
  @report_validator File.read!(@validator_path)

  def id, do: :html

  def render(findings, config) do
    path = Path.join(config.out_dir, "vibeguru-report.html")

    case File.write(path, document(Json.payload(findings, config))) do
      :ok -> {:ok, path}
      {:error, reason} -> {:error, reason}
    end
  end

  def document(report) do
    encoded =
      Jason.encode!(report)
      |> String.replace("<", "\\u003c")
      |> String.replace(">", "\\u003e")
      |> String.replace("&", "\\u0026")

    findings = report.findings
    evidence = report.evidence
    samples = Enum.filter(evidence, &(&1.kind == :sample))
    profile = report.profile || %{}
    fixture = String.contains?(profile[:root] || "", "test-app")

    """
    <!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Vibe Guru · Scoped runtime report</title>
    <style>
    :root{color-scheme:light;--ink:#193c32;--muted:#596b60;--paper:#f7f6ef;--line:#d9dfd4;--green:#235943}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,sans-serif}
    main{max-width:1100px;margin:auto;padding:40px 24px}header{border-bottom:1px solid var(--line);padding-bottom:28px}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:var(--muted)}h1{font-size:clamp(30px,6vw,56px);line-height:1.12;font-weight:600;letter-spacing:-.04em;margin:16px 0}
    h2{font-size:26px;margin:0 0 16px}h3{font-size:18px;line-height:1.4}section{margin-top:36px}.muted,small{color:var(--muted)}
    .badge{display:inline-block;padding:5px 13px;border:1px solid var(--green);border-radius:30px;font-weight:700}.FAIL,.ERROR{color:#9b3027;border-color:#9b3027}.INCONCLUSIVE{color:#81561d;border-color:#81561d}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card,article{background:#fffef9;border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}article{margin:16px 0}
    .number{font-size:28px;font-weight:650}code,pre{font-family:ui-monospace,monospace;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4ec;padding:16px;border-radius:8px}p,li,dd,summary{overflow-wrap:anywhere}
    a{color:var(--green)}a:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #b86d2b;outline-offset:3px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}
    svg{display:block;width:100%;height:auto}.plots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.plot{border:1px solid var(--line);border-radius:12px;background:#fffef9;padding:16px}
    table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.table-scroll{overflow-x:auto}
    input{font:inherit;max-width:100%;padding:8px 0}.notice{border-left:4px solid #b98c45;padding:12px 18px;background:#f5eedf}dl{margin:0}dt{font-weight:650}dd{margin:0 0 10px}
    @media(max-width:700px){main{padding:24px 16px}.grid,.plots{grid-template-columns:1fr}.card,article{padding:18px}}@media print{body{background:white}main{padding:0}article,.plot{break-inside:avoid}input{display:none}}
    </style></head><body><main>
    <header><div class="eyebrow">Vibe Guru / #{e(report.generated_at)}</div>
    <h1>Runtime &amp; repeated-use health</h1>
    <span class="badge #{e(report.verdict)}">#{e(report.verdict)}</span>
    <p>#{e(VibeGuru.Result.message(report.verdict))}</p>
    <p class="muted">#{e(profile[:url])} · #{e(profile[:stack])}/#{e(profile[:bundler])}</p>
    #{if fixture, do: "<p class=\"notice\">Fixture demonstration: this bundled application is deliberately broken. This is not a customer case study.</p>", else: ""}
    </header>
    <section class="grid" aria-label="Run overview">
    <div class="card"><div class="eyebrow">Findings</div><div class="number">#{length(findings)}</div><small>High and critical findings block a pass.</small></div>
    <div class="card"><div class="eyebrow">Evidence records</div><div class="number">#{length(evidence)}</div><small>Measurements retained in the JSON report.</small></div>
    <div class="card"><div class="eyebrow">Known-route coverage</div><div class="number">#{coverage_number(report.coverage)}</div><small>Navigation coverage does not establish business correctness.</small></div></section>
    <section><h2>Scope &amp; measurement limits</h2>
    <p>This report covers the recorded browser exercise and configured thresholds. Suspected causes require reproduction and developer review. Console and exception routes describe where an event was observed; delayed events may originate in an earlier view.</p>
    #{validity_table(report.measurement_validity)}
    <details><summary>Run conditions and skipped checks</summary><pre>#{e(Jason.encode!(%{run: report.run, coverage: report.coverage}, pretty: true))}</pre></details>
    <p class="muted">For reproduction, use the same URL, build, test account, routes, cycles and settle time. Business journeys need separately agreed assertions and human verification.</p></section>
    <section><h2>Retained-state trends</h2><p class="muted">Samples are shown in collection order, including baseline, cycles and cooldown. A rising line is a diagnostic lead; measurement validity and thresholds determine its interpretation.</p>
    <div class="plots">#{plot(samples, "heapUsed", "Heap used", 1_000_000, "MB")}#{plot(samples, "nodes", "DOM nodes", 1, "nodes")}#{plot(samples, "listeners", "Event listeners", 1, "listeners")}</div></section>
    <section><h2>Findings &amp; next actions</h2>#{if findings == [], do: "<p>No findings crossed the thresholds. Read the verdict and limits above.</p>", else: Enum.map_join(findings, "", &finding(&1, report.run))}</section>
    <section><h2>Before / after comparison</h2><p>Choose an earlier <code>vibeguru-findings.json</code>. Comparison happens in this browser; nothing is uploaded. A changed measurement alone does not prove a fix.</p>
    <label for="baseline">Earlier findings JSON</label><br><input id="baseline" type="file" accept=".json,application/json">
    <p id="compare-status" role="status">No baseline loaded. Fix confirmation has not been established.</p><div id="comparison"></div></section>
    <section><h2>Retained evidence</h2><p class="muted">Finding references link to supporting records. Memory deltas depend on the complete consecutive sample chain.</p>
    #{Enum.map_join(evidence, "", fn item -> "<details id=\"#{e(item.id)}\"><summary>#{e(item.kind)} · #{e(item.phase)} · cycle #{e(item.cycle)} · #{e(item.context["route"])} · #{e(item.id)}</summary><pre>#{e(Jason.encode!(item, pretty: true))}</pre></details>" end)}</section>
    <footer><p class="muted">Vibe Guru · schema #{report.schema_version} · local scoped verification</p></footer>
    </main><script id="report-data" type="application/json">#{encoded}</script><script>
    #{@report_validator}
    const current=JSON.parse(document.getElementById('report-data').textContent);
    document.getElementById('baseline').addEventListener('change',async event=>{
      const output=document.getElementById('comparison'),status=document.getElementById('compare-status');output.replaceChildren();
      const file=event.target.files[0];if(!file)return;
      try{
        if(file.size>25000000)throw new Error('Baseline is too large (maximum 25 MB).');
        const before=JSON.parse(await file.text());
        if(before.tool!=='vibeguru'||before.schema_version!==current.schema_version||!Array.isArray(before.findings)||!Array.isArray(before.evidence)||!before.run||!before.measurement_validity||!['PASS','FAIL','INCONCLUSIVE','ERROR'].includes(before.verdict))throw new Error('Choose a Vibe Guru report with the same schema version.');
        const beforeCheck=VibeGuruReport.assessReport(before),currentCheck=VibeGuruReport.assessReport(current);
        if(beforeCheck.verdict==='ERROR'||currentCheck.verdict==='ERROR')throw new Error('Report validity failed: '+[...beforeCheck.reasons,...currentCheck.reasons].join('; '));
        const same=before.profile?.url===current.profile?.url&&['mode','cycles','settleMs','routesLimit'].every(k=>before.run[k]===current.run[k])&&JSON.stringify(before.coverage?.visited||[])===JSON.stringify(current.coverage?.visited||[])&&JSON.stringify(before.run.censusTargets||[])===JSON.stringify(current.run.censusTargets||[]);
        const complete=[beforeCheck,currentCheck].every(r=>r.reasons.length===0)&&[before,current].every(r=>Object.values(r.measurement_validity).every(v=>v.status==='complete'));
        status.textContent=same&&complete?'Run conditions and validity match. Review build, account and test data before confirming a fix.':'Comparison is exploratory: scope, conditions or measurement validity differ. Disappearance of a finding cannot confirm a fix.';
        const table=document.createElement('table'),head=document.createElement('tr');
        ['Metric at cooldown','Before','After','Change'].forEach(s=>{const th=document.createElement('th');th.textContent=s;head.append(th)});table.append(head);
        const cool=r=>r.evidence.findLast(e=>e.kind==='sample'&&e.phase==='cooldown')?.data||{};
        const a=cool(before),b=cool(current);
        ['heapUsed','nodes','listeners'].forEach(k=>{const row=document.createElement('tr');[k,a[k],b[k],typeof a[k]==='number'&&typeof b[k]==='number'?b[k]-a[k]:'unavailable'].forEach(v=>{const td=document.createElement('td');td.textContent=v??'unavailable';row.append(td)});table.append(row)});output.append(table);
        const p=document.createElement('p');p.textContent='Findings: '+before.findings.length+' before / '+current.findings.length+' after. Review reproductions and evidence; this is not an automatic causal conclusion.';output.append(p);
      }catch(error){status.textContent='Could not compare: '+error.message}
    });
    </script></body></html>
    """
  end

  defp finding(f, run) do
    refs = Enum.map_join(f.evidence_refs, " ", &"<a href=\"##{e(&1)}\">#{e(&1)}</a>")

    reproduction =
      if run["mode"] == "flow",
        do:
          "Replay the agreed flow for #{run["cycles"]} cycles and inspect this sample label. The operator must supply the flow and its explicit outcome assertions.",
        else:
          "Rerun the recorded full route sequence for #{run["cycles"]} cycles, matching the settle time and run conditions. Inspect the events and post-GC samples associated with this route."

    """
    <article><div class="eyebrow">#{e(f.severity)} · #{e(f.signature)} · #{e(f.confidence)} confidence</div>
    <h3>#{e(f.title)}</h3><p>#{e(f.summary)}</p><dl><dt>#{if run["mode"] == "flow", do: "Observed sample label", else: "Observed route"}</dt><dd>#{e(f.location[:route])}</dd>
    <dt>Reproduction</dt><dd>#{e(reproduction)}</dd>
    <dt>Suspected cause and investigation</dt><dd>#{e(f.fix[:summary])} #{e(f.fix[:hint])}</dd></dl>
    <details><summary>Metrics and evidence</summary><pre>#{e(Jason.encode!(f.metrics, pretty: true))}</pre><p>#{refs}</p></details></article>
    """
  end

  defp validity_table(validity) do
    rows =
      Enum.map_join(Enum.sort(validity), "", fn {vector, entry} ->
        "<tr><td>#{e(vector)}</td><td>#{e(entry.status)}</td><td>#{e(Enum.join(entry.reasons, ", "))}#{if entry[:unavailable_targets] not in [nil, []], do: "; targets: " <> e(Enum.join(entry.unavailable_targets, ", ")), else: ""}</td></tr>"
      end)

    "<div class=\"table-scroll\"><table><thead><tr><th>Check</th><th>Validity</th><th>Limits</th></tr></thead><tbody>#{rows}</tbody></table></div>"
  end

  defp plot(samples, key, title, scale, unit) do
    values = Enum.with_index(samples) |> Enum.filter(fn {s, _} -> is_number(s.data[key]) end)

    if values == [] do
      "<div class=\"plot\"><h3>#{title}</h3><p>Measurement unavailable.</p></div>"
    else
      nums = Enum.map(values, fn {s, _} -> s.data[key] / scale end)
      low = Enum.min(nums)
      high = Enum.max(nums)
      span = max(high - low, 1)

      points =
        Enum.map_join(values, " ", fn {s, i} ->
          x = 15 + i * 270 / max(length(samples) - 1, 1)
          y = 100 - (s.data[key] / scale - low) * 80 / span
          "#{Float.round(x * 1.0, 2)},#{Float.round(y * 1.0, 2)}"
        end)

      "<div class=\"plot\"><h3>#{title}</h3><svg viewBox=\"0 0 300 120\" role=\"img\" aria-label=\"#{title} from #{Float.round(hd(nums) * 1.0, 2)} to #{Float.round(List.last(nums) * 1.0, 2)} #{unit}\"><path d=\"M15 10 V105 H290\" fill=\"none\" stroke=\"#d9dfd4\"/><polyline points=\"#{points}\" fill=\"none\" stroke=\"#235943\" stroke-width=\"2.5\"/></svg><small>#{Float.round(hd(nums) * 1.0, 2)} → #{Float.round(List.last(nums) * 1.0, 2)} #{unit} · #{length(values)} samples</small></div>"
    end
  end

  defp coverage_number(nil), do: "Unavailable"

  defp coverage_number(%{mode: "flow"} = c),
    do: "#{c.flow_completed}/#{c.flow_planned} flow cycles"

  defp coverage_number(c), do: "#{length(c.visited)}/#{c.routes_known}"

  defp e(nil), do: "—"

  defp e(value) do
    value
    |> to_string()
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
    |> String.replace("\"", "&quot;")
    |> String.replace("'", "&#39;")
  end
end
