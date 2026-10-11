"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const list = value => Array.isArray(value) ? value : [];
  const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const count = value => number(value) === null ? "—" : value.toLocaleString();
  const dateValue = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const newest = (items, field = "created_at") => [...items].sort((a, b) => dateValue(b[field]) - dateValue(a[field]));
  const campaignHistory = () => {
    const campaigns = newest(list(state.data?.campaigns));
    const experiments = campaigns.filter(item => !String(item.id).startsWith("standalone:"));
    return experiments.length ? experiments : campaigns;
  };
  const latestCampaign = () => campaignHistory()[0];
  const formatDate = value => dateValue(value) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not recorded";
  const shortDate = value => dateValue(value) ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Undated";
  const duration = value => number(value) === null ? "Not recorded" : value < 1000 ? `${Math.round(value)} ms` : value < 60000 ? `${(value / 1000).toFixed(1)} s` : `${(value / 60000).toFixed(1)} min`;
  const artifactUrl = path => `/artifact?${new URLSearchParams({ path: String(path) })}`;
  const artifactLink = (path, label, className = "artifact-link") => typeof path === "string" && path ? `<a class="${className}" href="${escape(artifactUrl(path))}" target="_blank" rel="noopener">${escape(label)} <span aria-hidden="true">↗</span></a>` : "";
  const verdicts = ["PASS", "FAIL", "INCONCLUSIVE", "ERROR"];
  const safeVerdict = value => verdicts.includes(value) ? value : "UNKNOWN";
  const verdictBadge = (value, suite = false) => `<span class="verdict verdict-${safeVerdict(value)}">${escape(value === "PASS" ? (suite ? "Suite PASS" : "Scoped PASS") : value === "FAIL" ? (suite ? "Suite FAIL" : "App FAIL") : value || "UNKNOWN")}</span>`;
  const originNames = { "existing-behavior": "Existing app behavior", synthetic: "Injected / synthetic", control: "Control run", interrupted: "Interrupted experiment", observed: "Observed run" };
  const expectationBadge = value => value == null ? '<span class="expectation neutral">No expectation</span>' : value.met === true ? '<span class="expectation met"><span aria-hidden="true">◇</span> Matched</span>' : '<span class="expectation missed"><span aria-hidden="true">!</span> Mismatch</span>';
  const empty = (title, message, compact = true) => `<div class="empty-state${compact ? " compact" : ""}"><span class="empty-symbol" aria-hidden="true">∅</span><h3>${escape(title)}</h3><p>${escape(message)}</p></div>`;
  const state = { data: null, view: "overview", fetching: false, queued: false, eventSource: null, live: false, lastFetched: 0, selectedCase: null, caseToken: 0, caseController: null, caseDetails: null };
  const pages = {
    overview: ["Evidence, in view", "Recorded runs, explicit failures, and the boundaries of what has been tested.", "01"],
    runs: ["Follow the evidence", "Inspect application verdicts and experiment outcomes without conflating the two.", "02"],
    vectors: ["Map the coverage", "What the engine can check, what has been exercised, and what is still planned.", "03"],
    changes: ["See what changed", "Working-tree changes, recorded test executions, and implementation context.", "04"],
  };

  function switchView() {
    const key = location.hash.slice(1);
    state.view = Object.hasOwn(pages, key) ? key : "overview";
    for (const view of Object.keys(pages)) {
      $(`view-${view}`).hidden = view !== state.view;
      const link = document.querySelector(`[data-view="${view}"]`);
      if (view === state.view) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    const [title, description, index] = pages[state.view];
    $("page-title").innerHTML = `${escape(title)}<span>.</span>`;
    $("page-description").textContent = description;
    $("page-eyebrow").textContent = `LOCAL OBSERVABILITY / ${index}`;
    $("breadcrumb-view").textContent = state.view[0].toUpperCase() + state.view.slice(1);
    document.title = `Vibe Guru · ${$("breadcrumb-view").textContent}`;
  }

  function setConnection(label, mode = "") {
    $("connection-label").textContent = label;
    $("connection-dot").className = `connection-dot ${mode}`;
  }

  async function fetchDashboard(manual = false) {
    if (state.fetching) { state.queued = true; return; }
    state.fetching = true;
    $("refresh-button").disabled = true;
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}`);
      const data = await response.json();
      if (!data || data.schema_version !== 1 || !Array.isArray(data.cases) || !Array.isArray(data.campaigns)) throw new Error("Dashboard returned an unsupported or incomplete data shape");
      if (state.data?.ui_revision && data.ui_revision && state.data.ui_revision !== data.ui_revision) {
        location.reload();
        return;
      }
      const changed = !state.data || data.revision == null || data.revision !== state.data.revision;
      state.data = data;
      state.lastFetched = Date.now();
      $("fetch-error").hidden = true;
      $("loading-state").hidden = true;
      $("content").hidden = false;
      $("last-updated").textContent = `Checked ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
      $("last-updated").title = `Snapshot generated ${formatDate(data.generated_at)}`;
      setConnection(state.live ? "Live · watching files" : "Connected · polling", "live");
      if (changed || manual) {
        renderDashboard();
        $("refresh-announcement").textContent = `Evidence updated. ${count(data.summary?.cases)} recorded cases.`;
        if (state.selectedCase && $("case-dialog").open) await loadCase(state.selectedCase, true);
      }
    } catch (error) {
      $("loading-state").hidden = true;
      $("fetch-error").hidden = false;
      $("fetch-error").textContent = `${state.data ? "Showing the last loaded snapshot. " : "Could not load local evidence. "}${error.message}. Keep the local dashboard server running; automatic refresh will retry.`;
      setConnection("Connection unavailable", "error");
    } finally {
      state.fetching = false;
      $("refresh-button").disabled = false;
      if (state.queued) { state.queued = false; void fetchDashboard(); }
    }
  }

  function renderDashboard() {
    const data = state.data;
    const source = data.source || {};
    const warnings = list(data.warnings);
    $("collector-warnings").hidden = !warnings.length;
    $("collector-warnings").innerHTML = warnings.length ? `<details><summary>${warnings.length} collector ${warnings.length === 1 ? "warning" : "warnings"} · some evidence may be unavailable</summary><ul>${warnings.map(warning => `<li>${escape(typeof warning === "string" ? warning : JSON.stringify(warning))}</li>`).join("")}</ul></details>` : "";
    $("workspace-name").textContent = source.branch || "Local repository";
    $("workspace-name").title = `Branch: ${source.branch || "unavailable"}\nCommit: ${source.commit || "unavailable"}`;
    $("nav-run-count").textContent = count(data.cases.length);
    $("nav-change-count").textContent = count(list(source.changes).length);
    const latest = latestCampaign();
    $("data-range").textContent = latest ? `Latest campaign · ${formatDate(latest.created_at)}` : "No recorded campaigns";
    $("footer-source").textContent = `${source.branch || "Branch unavailable"} · ${typeof source.commit === "string" ? source.commit.slice(0, 8) : "no commit"} · ${source.dirty === true ? "working tree changed" : source.dirty === false ? "working tree clean" : "tree state unavailable"}`;
    renderSummary();
    renderTrend();
    renderVectorOverview();
    renderRecentCases();
    renderTests();
    renderCampaignOptions();
    renderCases();
    renderVectors();
    renderTargetChecks();
    renderChanges();
  }

  function renderSummary() {
    const s = state.data.summary || {};
    const incomplete = number(s.inconclusive) !== null && number(s.error) !== null ? s.inconclusive + s.error : null;
    const cards = [
      ["Recorded cases", count(s.cases), "", `${count(s.campaigns)} campaigns in history`],
      ["App FAIL", count(s.fail), "fail", "Includes expected negative failures"],
      ["Scoped PASS", count(s.pass), "pass", "Within recorded checks only"],
      ["Incomplete / error", count(incomplete), "incomplete", `${count(s.inconclusive)} inconclusive · ${count(s.error)} error`],
      ["Expectations matched", `${count(s.expected_matched)} <small>/ ${count(s.expected_total)}</small>`, "expectation", "Declared experiments, not accuracy"],
    ];
    $("summary-cards").innerHTML = cards.map(([label, value, color, note]) => `<article class="summary-card"><p class="card-label"><span class="history-label">HISTORY</span> ${escape(label)}</p><p class="metric ${color}">${value}</p><p class="metric-note">${escape(note)}</p></article>`).join("");
  }

  function renderTrend() {
    const campaigns = campaignHistory().slice(0, 8).reverse();
    if (!campaigns.length) {
      $("trend-count").textContent = "No campaigns";
      $("verdict-chart").innerHTML = empty("No campaign evidence yet", "Campaigns will appear here when local reports are saved.");
      return;
    }
    const groups = campaigns.map(campaign => {
      const cases = state.data.cases.filter(item => item.campaign_id === campaign.id);
      return { campaign, cases, counts: Object.fromEntries(verdicts.map(verdict => [verdict, cases.filter(item => item.verdict === verdict).length])) };
    });
    const latest = groups.at(-1);
    $("trend-count").textContent = `${campaigns.length} most recent`;
    const w = 650, h = 213, left = 35, right = 15, top = 16, bottom = 42;
    const plotH = h - top - bottom;
    const max = Math.max(1, ...groups.map(group => group.cases.length));
    const step = (w - left - right) / groups.length;
    const barW = Math.min(42, step * 0.4);
    const colors = { PASS: "#c4dd85", FAIL: "#e79588", INCONCLUSIVE: "#e7b773", ERROR: "#8eafbb" };
    let svg = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Recorded application verdict counts across ${groups.length} campaigns. Latest campaign has ${latest.counts.PASS} scoped pass, ${latest.counts.FAIL} app fail, ${latest.counts.INCONCLUSIVE} inconclusive and ${latest.counts.ERROR} error cases.">`;
    const tickCount = Math.min(3, max);
    for (let index = 0; index <= tickCount; index++) {
      const value = Math.ceil(max / tickCount) * index;
      const axisMax = Math.ceil(max / tickCount) * tickCount;
      const y = top + plotH - value / axisMax * plotH;
      svg += `<line class="chart-grid" x1="${left}" y1="${y}" x2="${w - right}" y2="${y}"/><text x="${left - 9}" y="${y + 3}" text-anchor="end">${Math.round(value)}</text>`;
    }
    groups.forEach(({ campaign, counts, cases }, index) => {
      const x = left + step * (index + 0.5) - barW / 2;
      let base = top + plotH;
      const description = `${campaign.label || campaign.id}: ${cases.length} cases; ${counts.PASS} scoped PASS, ${counts.FAIL} app FAIL, ${counts.INCONCLUSIVE} inconclusive, ${counts.ERROR} error`;
      svg += `<g><title>${escape(description)}</title>`;
      for (const verdict of verdicts) {
        const axisMax = Math.ceil(max / tickCount) * tickCount;
        const size = counts[verdict] / axisMax * plotH;
        base -= size;
        if (size) svg += `<rect x="${x}" y="${base}" width="${barW}" height="${size}" fill="${colors[verdict]}" opacity="${index === groups.length - 1 ? 1 : 0.65}" rx="1"/>`;
      }
      svg += `<text x="${x + barW / 2}" y="${Math.max(10, base - 7)}" text-anchor="middle" class="chart-label">${cases.length}</text><text x="${x + barW / 2}" y="${h - 22}" text-anchor="middle">${escape(shortDate(campaign.created_at))}</text><text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${index === groups.length - 1 ? "LATEST" : `#${index + 1}`}</text></g>`;
    });
    svg += "</svg>";
    const matched = number(latest.campaign.met_expectations);
    const total = number(latest.campaign.declared_expectation_cases);
    const syntheticTotal = number(latest.campaign.expected_injected_signals);
    $("verdict-chart").innerHTML = `${svg}<div class="latest-campaign-note"><span class="eyebrow">LATEST CAMPAIGN</span><strong>${escape(latest.campaign.label || latest.campaign.id)}</strong><span>${count(latest.cases.length)} cases · ${matched === null || total === null ? "No expectation tally" : `${count(matched)}/${count(total)} declared expectations matched`}${syntheticTotal > 0 ? ` · ${count(latest.campaign.detected_injected_signals)}/${count(syntheticTotal)} injected signals detected` : ""}</span></div>`;
  }

  function renderVectorOverview() {
    const latest = latestCampaign();
    const cases = latest ? state.data.cases.filter(item => item.campaign_id === latest.id) : [];
    const vectors = list(state.data.vectors).filter(vector => vector.stage === "implemented");
    const exercised = vectors.filter(vector => cases.some(item => list(item.vector_ids).includes(vector.id)));
    const priority = { "response-order": 0, "reconnect-convergence": 1 };
    const show = [...(exercised.length ? exercised : vectors.slice(0, 5))].sort((a, b) => (priority[a.id] ?? 2) - (priority[b.id] ?? 2));
    if (!show.length) { $("vector-overview").innerHTML = empty("No vectors recorded", "Vector definitions and exercised runs will appear as they become available."); return; }
    const colors = { PASS: "#c4dd85", FAIL: "#e79588", INCONCLUSIVE: "#e7b773", ERROR: "#8eafbb" };
    $("vector-overview").innerHTML = show.map(vector => {
      const associated = cases.filter(item => list(item.vector_ids).includes(vector.id));
      const counts = Object.fromEntries(verdicts.map(verdict => [verdict, associated.filter(item => item.verdict === verdict).length]));
      const description = `${vector.name}, associated case outcomes: ${counts.PASS} scoped PASS, ${counts.FAIL} app FAIL, ${counts.INCONCLUSIVE} inconclusive, ${counts.ERROR} error`;
      return `<div class="vector-overview-row"><span class="vector-name">${escape(vector.name)}</span><span class="coverage-count">${associated.length ? `${associated.length} cases` : "Not exercised"}</span><div class="mini-bar verdict-mini-bar" role="img" aria-label="${escape(description)}" title="${escape(description)}">${verdicts.map(verdict => counts[verdict] ? `<span style="width:${counts[verdict] / associated.length * 100}%;background:${colors[verdict]}"></span>` : "").join("")}</div></div>`;
    }).join("") + `<p class="vector-overview-foot">Latest campaign · ${count(exercised.length)} exercised vectors. Bars show associated case verdicts.</p>`;
  }

  function renderRecentCases() {
    const latest = latestCampaign();
    const priority = { FAIL: 0, ERROR: 1, INCONCLUSIVE: 2, PASS: 3 };
    const cases = newest(state.data.cases.filter(item => item.campaign_id === latest?.id)).sort((a, b) => (priority[a.verdict] ?? 4) - (priority[b.verdict] ?? 4)).slice(0, 6);
    $("recent-cases").innerHTML = cases.length ? cases.map(item => `<button type="button" class="recent-case" data-case-id="${escape(item.id)}"><span><span class="case-name">${escape(item.app || "Unnamed app")} <span class="case-variant">/ ${escape(item.variant || "Recorded run")}</span></span><span class="case-subtitle">${escape(originNames[item.source_kind] || "Observed run")} · ${count(item.cycles)} cycles</span></span><span class="recent-case-right">${verdictBadge(item.verdict)}<span class="case-arrow" aria-hidden="true">↗</span></span></button>`).join("") : empty("No cases in the latest campaign", "Saved runs will appear here without a manual page reload.");
  }

  function testStatus(item) {
    const styles = { PASS: "passed", FAIL: "failed", ERROR: "failed", RUNNING: "running" };
    return `<span class="test-status ${styles[item.status] || ""}">${escape(item.status || "UNKNOWN")}</span>`;
  }

  function renderTests() {
    renderTiming();
    const suites = newest(list(state.data.suites), "started_at");
    $("test-count").textContent = `${count(suites.length)} recorded`;
    $("recent-tests").innerHTML = suites.length ? suites.slice(0, 3).map(item => `<div class="test-preview"><div class="test-preview-top"><span class="test-preview-name">${escape(item.suite || "Test suite")}</span>${testStatus(item)}</div>${item.stale === true ? '<span class="suite-stale">Earlier source revision</span>' : ""}<div class="test-preview-meta"><span>${count(item.passed)} passed · ${count(item.failed)} failed</span><span>${escape(formatDate(item.started_at))}</span></div></div>`).join("") : empty("No test executions recorded", "Only recorded suite results are shown; the dashboard does not execute tests.");
    $("test-list").innerHTML = suites.length ? suites.slice(0, 30).map(item => `<article class="test-card"><div class="test-card-head"><div><h3>${escape(item.suite || "Test suite")}</h3><p class="test-time">${escape(formatDate(item.started_at))}</p></div>${testStatus(item)}</div>${item.stale === true ? '<p class="suite-stale">Stale &middot; source changed since this execution</p>' : ""}<code class="test-command">${escape(item.command || "Command not recorded")}</code><div class="test-card-stats"><span><strong>${count(item.passed)}</strong> passed</span><span><strong>${count(item.failed)}</strong> failed</span><span><strong>${count(item.skipped)}</strong> skipped</span><span>${escape(duration(item.duration_ms))}</span></div>${list(item.failures).length ? `<ul class="suite-failures">${item.failures.map(failure => `<li><strong>${escape(failure.name || "Failure")}</strong><span>${escape(failure.message)}</span></li>`).join("")}</ul>` : ""}<div class="test-card-links">${artifactLink(item.log_path, "Execution log", "text-button")}<span class="test-source">Source revision: ${escape(typeof item.source_revision === "string" ? item.source_revision.slice(0, 12) : "not recorded")}</span></div></article>`).join("") : empty("No suite history", "Run results appear when the local test recorder saves them. A missing record does not mean a test passed.");
  }

  function renderTiming() {
    const host = $("timing-analytics");
    if (!host) return;
    const timing = state.data.timing || {};
    const groups = list(timing.suite_groups);
    const main = groups.find(item => item.suite === "Full repository check");
    const maximum = Math.max(1, ...groups.map(item => item.median_ms || 0));
    const latest = main?.latest;
    host.innerHTML = `<div class="timing-headline"><div><p class="eyebrow">LATEST FULL CHECK</p><strong>${escape(duration(latest?.duration_ms))}</strong>${latest ? `<span>${testStatus(latest)} ${latest.stale === true ? '<span class="suite-stale">Earlier source revision</span>' : latest.stale === false ? '<span>Current source revision</span>' : '<span>Revision not recorded</span>'}</span>` : '<span>Run npm run check to record total wall time.</span>'}</div><p>Wall time includes formatting, compilation, Elixir and Node tests. Nested records are shown separately and are never added to the total.</p></div>${groups.length ? `<div class="timing-bars" role="img" aria-label="Median recorded duration by test command">${groups.map(group => `<div class="timing-row"><span>${escape(group.suite)}</span><div class="timing-track"><i style="width:${Math.max(1, group.median_ms / maximum * 100).toFixed(1)}%"></i></div><strong>${escape(duration(group.median_ms))}</strong><small>median · p95 ${escape(duration(group.p95_ms))} · n=${count(group.samples)} · ${count(group.failed)} failed</small></div>`).join("")}</div>` : empty("No measured suites", "Running, missing and interrupted timing records are excluded.")}${latest && list(latest.stages).length ? `<details class="timing-details"><summary>Latest full-check stages</summary>${latest.stages.map(stage => `<p>${escape(stage.suite)} · ${escape(duration(stage.duration_ms))} · ${escape(stage.status)} ${artifactLink(stage.log_path, "Log", "text-button")}</p>`).join("")}</details>` : ""}<details class="timing-details"><summary>Browser case timings (${count(list(timing.browser_groups).length)} comparable groups)</summary><p>Grouped by app, scenario and cycle count. Samples require complete assessed measurements and journeys. A FAIL with incomplete checks is excluded.</p>${list(timing.browser_groups).slice(0, 40).map(group => `<p><strong>${escape(group.app)} / ${escape(group.variant)}</strong> · ${count(group.cycles)} cycles · median ${escape(duration(group.median_ms))} · p95 ${escape(duration(group.p95_ms))} · n=${count(group.samples)}</p>`).join("")}</details><p class="timing-note">${count(timing.unmeasured_suites)} suite records without completed timing; ${count(timing.incomplete_browser_cases)} browser cases with incomplete or unknown scope. Historical local samples vary by source, load and cache state. p95 is nearest rank and often equals the maximum for small samples.</p>`;
  }

  function renderCampaignOptions() {
    const selected = $("campaign-filter").value;
    $("campaign-filter").innerHTML = '<option value="all">All campaigns</option>' + newest(state.data.campaigns).map(item => `<option value="${escape(item.id)}">${escape(item.label || item.id)} · ${escape(formatDate(item.created_at))} · ${escape(String(item.id).slice(-8))}</option>`).join("");
    if ([...$("campaign-filter").options].some(option => option.value === selected)) $("campaign-filter").value = selected;
  }

  function renderCases() {
    if (!state.data) return;
    const query = $("case-search").value.trim().toLowerCase();
    const verdict = $("verdict-filter").value;
    const expectation = $("expectation-filter").value;
    const campaign = $("campaign-filter").value;
    const cases = newest(state.data.cases).filter(item => {
      const text = [item.app, item.variant, item.id, item.campaign_id, originNames[item.source_kind], ...list(item.vector_ids), ...list(item.findings).flatMap(finding => [finding.signature, finding.summary])].join(" ").toLowerCase();
      return (!query || text.includes(query)) && (verdict === "all" || item.verdict === verdict) && (campaign === "all" || item.campaign_id === campaign) &&
        (expectation === "all" || expectation === "none" && item.expectation == null || expectation === "met" && item.expectation?.met === true || expectation === "missed" && item.expectation != null && item.expectation.met !== true);
    });
    $("filtered-count").textContent = `${count(cases.length)} / ${count(state.data.cases.length)}`;
    $("case-table-body").innerHTML = cases.map(item => `<tr><td><button type="button" class="table-case-button" data-case-id="${escape(item.id)}">${escape(item.app || "Unnamed app")} <span class="case-variant">/ ${escape(item.variant || "Recorded run")}</span></button><span class="case-subtitle">${escape(originNames[item.source_kind] || "Observed run")} · ${escape(item.campaign_id)}</span></td><td>${verdictBadge(item.verdict)}</td><td>${expectationBadge(item.expectation)}</td><td><span class="assertion-count">${count(item.passed_assertions)} ok <span class="${item.failed_assertions > 0 ? "bad" : ""}">/ ${count(item.failed_assertions)} fail</span></span></td><td><time class="recorded-time" datetime="${escape(item.created_at || "")}">${escape(formatDate(item.created_at))}</time></td><td><button type="button" class="row-open" data-case-id="${escape(item.id)}" aria-label="Inspect ${escape(`${item.app || "app"} ${item.variant || "case"}`)}">↗</button></td></tr>`).join("");
    $("runs-empty").hidden = cases.length !== 0;
    $("run-limit-note").textContent = "PASS covers the saved scope only. Matched experiments can include app FAIL. Interrupted or incomplete runs do not establish correctness.";
  }

  function renderVectors() {
    const vectors = list(state.data.vectors);
    const exercised = vectors.filter(vector => number(vector.case_count) > 0).length;
    const planned = vectors.filter(vector => vector.stage === "planned").length;
    const implemented = vectors.filter(vector => vector.stage === "implemented").length;
    $("vector-summary").innerHTML = `<div class="vector-summary-card"><strong>${count(exercised)}</strong><div><span>Exercised vectors</span><small>Have saved case evidence</small></div></div><div class="vector-summary-card scope"><strong>${count(implemented)}</strong><div><span>Implemented vectors</span><small>Availability is not coverage</small></div></div><div class="vector-summary-card planned"><strong>${count(planned)}</strong><div><span>Planned vectors</span><small>Not a shipped guarantee</small></div></div>`;
    const campaigns = campaignHistory().slice(0, 5);
    $("vector-matrix").innerHTML = vectors.length ? `<table class="matrix-table"><thead><tr><th scope="col">Vector / stage</th>${campaigns.map(item => `<th scope="col" title="${escape(item.id)}">${escape(item.label || item.id)}<span class="case-subtitle">${escape(formatDate(item.created_at))} &middot; ${escape(String(item.id).slice(-8))}</span></th>`).join("")}</tr></thead><tbody>${vectors.map(vector => `<tr><th scope="row"><span class="vector-cell-name">${escape(vector.name || vector.id)}</span><span class="vector-cell-note">${escape(vector.family || "")} · ${escape(vector.stage || "unknown")}</span></th>${campaigns.map(campaign => {
      const matches = state.data.cases.filter(item => item.campaign_id === campaign.id && list(item.vector_ids).includes(vector.id));
      const details = verdicts.map(verdict => `${matches.filter(item => item.verdict === verdict).length} ${verdict}`).join(", ");
      return `<td>${matches.length ? `<button type="button" class="matrix-cell-button" data-vector-id="${escape(vector.id)}" data-campaign-id="${escape(campaign.id)}" title="${escape(details)}"><span class="matrix-state"><i class="matrix-dot exercised"></i>${matches.length} cases</span></button>` : `<span class="matrix-state"><i class="matrix-dot ${vector.stage === "planned" ? "planned" : "absent"}"></i>${vector.stage === "planned" ? "Planned" : "—"}</span>`}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table>` : empty("No vector catalog", "Implemented and planned vectors will appear when the local catalog is available.");
    $("vector-details").innerHTML = vectors.map(vector => `<article class="panel vector-detail"><div class="detail-head"><h3>${escape(vector.name || vector.id)}</h3><span class="subtle-tag">${escape(vector.stage || "unknown")}</span></div><p>${escape(vector.description || "No description recorded.")}</p><p class="vector-limits"><strong>Scope:</strong> ${escape(vector.scope || "Not recorded")}</p><div class="vector-detail-counts"><span>${count(vector.case_count)} recorded cases</span><span>${count(vector.assertions_passed)} assertions passed · ${count(vector.assertions_failed)} failed</span></div>${number(vector.case_count) > 0 ? `<div class="vector-verdicts">${verdicts.map(verdict => `<span>${count(vector[{ PASS: "passed", FAIL: "failed", INCONCLUSIVE: "inconclusive", ERROR: "error" }[verdict]])} ${verdict === "PASS" ? "scoped PASS" : verdict === "FAIL" ? "app FAIL" : verdict.toLowerCase()}</span>`).join("")}</div><p class="vector-verdict-boundary">Associated case verdicts; not vector-specific findings or accuracy.</p>` : '<p class="vector-limits">No saved execution evidence. Detection quality has not been established here.</p>'}</article>`).join("");
  }

  function renderTargetChecks() {
    const cards = [...$("vector-details").children];
    for (const [index, vector] of list(state.data.vectors).entries()) {
      const checks = vector.target_checks, card = cards[index];
      if (!card || !checks || !number(checks.expected)) continue;
      const description = `${vector.name}: ${checks.passed} passed, ${checks.failed} failed, ${checks.unverified} unverified target checks`;
      const box = document.createElement("div"); box.className = "target-checks";
      box.innerHTML = `<p>Target assertions · ${count(checks.passed)} passed · ${count(checks.failed)} failed · ${count(checks.unverified)} unverified</p><div class="target-check-bar" role="img" aria-label="${escape(description)}">${[["passed", "#c4dd85"], ["failed", "#e79588"], ["unverified", "#e7b773"]].map(([key, color]) => checks[key] ? `<span style="width:${checks[key] / checks.expected * 100}%;background:${color}"></span>` : "").join("")}</div><small>${escape(list(checks.ids).join(" · "))}. Counts cover these supplied checks only.</small>`;
      card.querySelector(".vector-detail-counts").after(box);
    }
  }

  function renderChanges() {
    const source = state.data.source || {};
    const changes = list(source.changes);
    const openAreas = new Set([...document.querySelectorAll(".change-group[open]")].map(group => group.dataset.changeArea));
    $("change-count").textContent = `${count(changes.length)} files`;
    const grouped = new Map();
    for (const change of changes) { const area = change.area || "Other"; if (!grouped.has(area)) grouped.set(area, []); grouped.get(area).push(change); }
    const areas = [...grouped].sort(([, a], [, b]) => b.length - a.length);
    const maxFiles = Math.max(1, ...areas.map(([, files]) => files.length));
    $("change-area-chart").innerHTML = areas.length ? `<div class="change-area-chart"><p class="eyebrow">CURRENT WORKING TREE · CHANGED FILES BY AREA</p>${areas.map(([area, files]) => `<div class="change-area-row"><span>${escape(area)}</span><span class="change-area-bar" role="img" aria-label="${escape(`${area}: ${files.length} changed files`)}"><i style="width:${files.length / maxFiles * 100}%"></i></span><strong>${count(files.length)}</strong></div>`).join("")}</div>` : "";
    const statusNames = { "??": "UNTRACKED", M: "MODIFIED", A: "ADDED", D: "DELETED", R: "RENAMED", C: "COPIED" };
    $("change-list").innerHTML = changes.length ? [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([area, files]) => `<details class="change-group" data-change-area="${escape(area)}"${openAreas.has(area) ? " open" : ""}><summary><span>${escape(area)}</span><small>${files.length} files</small></summary>${files.map(file => {
      const status = String(file.status || "changed").trim();
      const deleted = status.includes("D");
      const stats = number(file.additions) !== null && number(file.deletions) !== null ? ` <span class="diff-add">+${count(file.additions)}</span> <span class="diff-delete">−${count(file.deletions)}</span>` : "";
      return `<div class="change-file"><span class="change-file-path">${deleted ? escape(file.path) : artifactLink(file.path, file.path, "file-link")}${stats}</span><span class="file-status${deleted ? " deleted" : ""}" title="${escape(status)}">${escape(statusNames[status] || status)}</span></div>`;
    }).join("")}</details>`).join("") : empty(source.dirty === false ? "Working tree is clean" : "No file changes available", source.dirty === false ? "There are no local changes in this snapshot." : "The collector has not reported file changes.");
    const activity = newest(list(state.data.activity), "at");
    $("activity-list").innerHTML = activity.length ? activity.slice(0, 30).map(item => `<article class="activity-item"><div class="activity-marker ${escape(["implementation", "validation", "plan"].includes(item.kind) ? item.kind : "")}" aria-hidden="true"></div><div><div class="activity-title"><h3>${escape(item.title || "Project note")}</h3><span class="subtle-tag">${escape(item.kind || "note")}</span></div><p>${escape(item.description)}</p><div class="activity-meta"><time>${escape(formatDate(item.at))}</time>${list(item.vector_ids).length ? `<span>${escape(item.vector_ids.join(" · "))}</span>` : ""}</div>${list(item.files).length ? `<details class="activity-files"><summary>${item.files.length} related files</summary><ul>${item.files.map(file => `<li>${escape(file)}</li>`).join("")}</ul></details>` : ""}<div class="activity-links">${list(item.evidence_paths).map((path, index) => artifactLink(path, `Evidence ${index + 1}`, "text-button")).join("")}</div></div></article>`).join("") : empty("No implementation notes recorded", "Local project notes can connect changes, vectors and validation evidence. They do not imply automatic verification.");
  }

  async function loadCase(id, refreshing = false) {
    const dialog = $("case-dialog");
    state.selectedCase = id;
    const token = ++state.caseToken;
    state.caseController?.abort();
    state.caseController = new AbortController();
    if (!refreshing) {
      const item = state.data?.cases.find(candidate => candidate.id === id);
      $("drawer-title").textContent = item ? `${item.app || "App"} / ${item.variant || "Recorded run"}` : "Recorded case";
      $("drawer-content").innerHTML = '<div class="loading-state" role="status"><span class="loading-ring" aria-hidden="true"></span><span>Reading case evidence…</span></div>';
      if (!dialog.open) dialog.showModal();
    }
    const controller = state.caseController;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/case?${new URLSearchParams({ id })}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Case API returned HTTP ${response.status}`);
      const detail = await response.json();
      if (!detail || detail.id !== id) throw new Error("Case API returned an unexpected case");
      if (token !== state.caseToken || !dialog.open) return;
      state.caseDetails = detail;
      renderCase(detail);
    } catch (error) {
      if (token !== state.caseToken || !dialog.open) return;
      $("drawer-content").innerHTML = `<div class="notice notice-error" role="alert">${escape(error.name === "AbortError" ? "Case detail request timed out." : error.message)} Saved report links may still be available below.</div>${caseArtifactLinks(state.data?.cases.find(item => item.id === id) || {})}<button type="button" class="button retry-case" data-case-id="${escape(id)}">Retry case detail</button>`;
    } finally { clearTimeout(timeout); }
  }

  function caseArtifactLinks(detail) {
    const paths = list(detail.artifact_paths).length ? detail.artifact_paths : [
      { label: "HTML report", path: detail.html_path }, { label: "JSON evidence", path: detail.report_path }, { label: "Incident capsule", path: detail.capsule_path },
    ];
    return `<div class="drawer-links">${paths.map(item => artifactLink(item.path, item.label || "Artifact")).join("") || '<span class="case-subtitle">No artifact paths recorded</span>'}</div>`;
  }

  function matchedFailureWarning(detail) {
    if (detail.verdict !== "FAIL" || detail.expectation?.met !== true) return "";
    const message = detail.failed_assertions > 0
      ? "The intended negative experiment matched. The application still failed its recorded assertions; this is not an app PASS."
      : detail.failed_assertions === 0
        ? "No recorded assertion failed. The declared behavior matched, while blocking findings keep the application verdict at FAIL. Review the findings and controlled conditions below."
        : "The declared expectation matched, while the application verdict remains FAIL. Review the recorded assertions, findings and controlled conditions below.";
    return `<p class="drawer-warning">${message}</p>`;
  }

  function renderCase(detail) {
    $("drawer-title").textContent = `${detail.app || "App"} / ${detail.variant || "Recorded run"}`;
    const failures = list(detail.findings);
    const assertions = list(detail.assertions);
    const grouped = new Map();
    for (const assertion of assertions) { const id = assertion.id || "Unnamed assertion"; if (!grouped.has(id)) grouped.set(id, []); grouped.get(id).push(assertion); }
    const limits = [...list(detail.limitations), ...list(state.data?.limitations)];
    const uniqueLimits = [...new Set(limits.map(value => typeof value === "string" ? value : JSON.stringify(value)))];
    const reasons = list(detail.validity_reasons);
    $("drawer-content").innerHTML = `<div class="drawer-badges">${verdictBadge(detail.verdict)}${expectationBadge(detail.expectation)}<span class="subtle-tag">${escape(originNames[detail.source_kind] || "Observed run")}</span></div>${matchedFailureWarning(detail)}${detail.source_kind === "synthetic" ? '<p class="drawer-warning">This case uses an injected fault. Detection here does not establish accuracy on naturally occurring app defects.</p>' : ""}<dl class="drawer-meta"><div><dt>Campaign</dt><dd>${escape(detail.campaign_id)}</dd></div><div><dt>Recorded</dt><dd>${escape(formatDate(detail.created_at))}</dd></div><div><dt>Cycles / duration</dt><dd>${count(detail.cycles)} cycles · ${escape(duration(detail.duration_ms))}</dd></div><div><dt>Assertions</dt><dd>${count(detail.passed_assertions)} passed · ${count(detail.failed_assertions)} failed</dd></div><div><dt>Vector scope</dt><dd>${escape(list(detail.vector_ids).join(" · ") || "Not recorded")}</dd></div><div><dt>Case identity</dt><dd>${escape(detail.id)}</dd></div></dl>${caseArtifactLinks(detail)}${detail.expectation && list(detail.expectation.mismatches).length ? `<section class="drawer-section"><h3>Expectation mismatches</h3><ul class="drawer-list">${detail.expectation.mismatches.map(message => `<li>${escape(message)}</li>`).join("")}</ul></section>` : ""}<section class="drawer-section"><h3>Evidence relationships</h3>${renderGraph(detail.graph, detail.observations)}<p class="graph-caption">Recorded links connect this run, observations and findings. Edges are evidence references or recorded associations, not proof of causation.</p></section><section class="drawer-section"><h3>Findings <span class="heading-count">${failures.length}</span></h3>${failures.length ? failures.map(finding => `<article class="finding-card"><span class="finding-code">${escape(finding.severity || "unrated")} / ${escape(finding.signature || "Finding")}</span><h4>${escape(finding.summary || "No summary recorded")}</h4>${finding.metrics && Object.keys(finding.metrics).length ? `<details class="drawer-raw"><summary>Recorded metrics</summary><pre>${escape(JSON.stringify(finding.metrics, null, 2))}</pre></details>` : ""}</article>`).join("") : '<p>No findings recorded. This does not extend the saved scope.</p>'}</section><section class="drawer-section"><h3>Assertions <span class="heading-count">${assertions.length}</span></h3>${grouped.size ? [...grouped].map(([id, records]) => `<div class="assertion-row"><div><span class="assertion-id">${escape(id)}</span><p>${escape(records.find(item => item.message)?.message || "No assertion description recorded")}</p><details class="assertion-cycles"><summary>Cycle results</summary><span>${records.map(item => `Cycle ${escape(item.cycle)}: ${escape(item.status)}`).join(" · ")}</span></details></div><div class="assertion-meta"><span>${records.filter(item => item.status === "pass").length} ok</span><span class="${records.some(item => item.status === "fail") ? "assertion-failed" : ""}">${records.filter(item => item.status === "fail").length} fail</span></div></div>`).join("") : '<p>No structured assertions were recorded for this run.</p>'}</section>${reasons.length ? `<section class="drawer-section"><h3>Validity boundaries</h3><ul class="drawer-list">${reasons.map(reason => `<li>${escape(typeof reason === "string" ? reason : JSON.stringify(reason))}</li>`).join("")}</ul></section>` : ""}<section class="drawer-section"><h3>Limits of this result</h3>${uniqueLimits.length ? `<ul class="drawer-list">${uniqueLimits.map(limit => `<li>${escape(limit)}</li>`).join("")}</ul>` : '<p>No case-specific limitations were recorded. The verdict still covers only the exercised scope.</p>'}</section><section class="drawer-section"><h3>Recorded observations <span class="heading-count">${list(detail.observations).length}</span></h3>${list(detail.observations).length ? `<div class="observation-list">${detail.observations.map(observation => `<details class="drawer-raw"><summary>${escape(observation.name || observation.id || "Observation")} <span class="case-subtitle">cycle ${escape(observation.cycle)}</span></summary><pre>${escape(JSON.stringify(observation.payload, null, 2))}</pre></details>`).join("")}</div>` : '<p>No diagnostic observations recorded.</p>'}</section>${detail.run ? `<details class="drawer-raw run-metadata"><summary>Raw run metadata</summary><pre>${escape(JSON.stringify(detail.run, null, 2))}</pre></details>` : ""}`;
  }

  function renderGraph(graph, observations = []) {
    const allNodes = list(graph?.nodes);
    const allEdges = list(graph?.edges);
    if (!allNodes.length) return empty("No relationship graph recorded", "Open the JSON report to inspect its raw evidence references.");
    const contextTypes = ["run", "case", "experiment", "build", "workflow"];
    const context = allNodes.filter(node => contextTypes.includes(node.type)).slice(0, 4);
    const findings = allNodes.filter(node => node.type === "finding" || node.type === "assertion").slice(0, 3);
    const findingIds = new Set(findings.map(node => node.id));
    const linkedIds = new Set(allEdges.filter(edge => findingIds.has(edge.target)).map(edge => edge.source));
    const observationNames = new Map(list(observations).map(item => [item.id, item.name]));
    const remaining = allNodes.filter(node => !contextTypes.includes(node.type) && node.type !== "finding" && node.type !== "assertion");
    const linked = remaining.filter(node => linkedIds.has(node.id));
    const candidates = linked.length ? linked : remaining;
    const nodes = [...context, ...findings, ...candidates.slice(0, 6)];
    if (!nodes.length) nodes.push(...allNodes.slice(0, 6));
    const columns = [[], [], []];
    const category = node => contextTypes.includes(node.type) ? 0 : node.type === "finding" || node.type === "assertion" ? 2 : 1;
    nodes.forEach(node => columns[category(node)].push(node));
    const maxRows = Math.max(1, ...columns.map(column => column.length));
    const h = Math.max(160, maxRows * 40 + 30), w = 640;
    const positions = new Map();
    const x = [12, 239, 466], nodeW = 160;
    columns.forEach((column, col) => column.forEach((node, row) => positions.set(node.id, { x: x[col], y: 20 + row * 40 + (maxRows - column.length) * 20 })));
    let svg = `<div class="evidence-graph"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Recorded evidence relationship graph, showing ${nodes.length} of ${allNodes.length} nodes"><defs><marker id="graph-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#506045"/></marker></defs>`;
    for (const edge of allEdges) {
      const from = positions.get(edge.source), to = positions.get(edge.target);
      if (!from || !to) continue;
      const forward = to.x > from.x;
      const sameColumn = to.x === from.x;
      const startX = from.x + (forward || sameColumn ? nodeW : 0), endX = to.x + (forward ? 0 : nodeW);
      const middle = sameColumn ? startX + 28 : (startX + endX) / 2;
      svg += `<path class="graph-edge" d="M${startX},${from.y + 13} C${middle},${from.y + 13} ${middle},${to.y + 13} ${endX},${to.y + 13}" marker-end="url(#graph-arrow)"><title>${escape(edge.relation || "Recorded association")}</title></path>`;
    }
    for (const node of nodes) {
      const p = positions.get(node.id);
      const cycle = String(node.id).match(/_cycle_(\d+)_/);
      const label = String(observationNames.get(node.id) || `${node.label || node.id}${cycle ? ` · c${cycle[1]}` : ""}`);
      svg += `<g><title>${escape(`${node.type || "evidence"}: ${label}`)}</title><rect class="graph-node${node.type === "finding" ? " failure" : ""}" x="${p.x}" y="${p.y}" width="${nodeW}" height="26" rx="5"/><text x="${p.x + 9}" y="${p.y + 17}">${escape(label.length > 23 ? `${label.slice(0, 22)}…` : label)}</text></g>`;
    }
    svg += "</svg></div>";
    if (allNodes.length > nodes.length) svg += `<p class="graph-caption">Showing ${nodes.length} of ${allNodes.length} recorded nodes. Full relationships remain in the JSON artifact.</p>`;
    const labels = new Map(allNodes.map(node => [node.id, node.label || node.id]));
    if (allEdges.length) svg += `<details class="graph-relationships"><summary>Recorded relationships (${allEdges.length})</summary><ul>${allEdges.slice(0, 40).map(edge => `<li>${escape(labels.get(edge.source) || edge.source)} <span aria-hidden="true">→</span><span class="sr-only">to</span> ${escape(labels.get(edge.target) || edge.target)} <span class="relation-label">(${escape(edge.relation || "recorded association")})</span></li>`).join("")}</ul>${allEdges.length > 40 ? '<p>Additional relationships are available in the JSON artifact.</p>' : ""}</details>`;
    return svg;
  }

  function connectEvents() {
    if (!("EventSource" in window)) { setConnection("Polling every 15s"); return; }
    const events = new EventSource("/api/events");
    state.eventSource = events;
    events.onopen = () => { state.live = true; setConnection("Live · watching files", "live"); };
    events.addEventListener("refresh", () => { void fetchDashboard(); });
    events.onerror = () => { state.live = false; setConnection("Reconnecting · polling fallback"); };
  }

  $("refresh-button").addEventListener("click", () => void fetchDashboard(true));
  $("case-search").addEventListener("input", renderCases);
  for (const id of ["verdict-filter", "expectation-filter", "campaign-filter"]) $(id).addEventListener("change", renderCases);
  $("clear-filters").addEventListener("click", () => { $("case-search").value = ""; for (const id of ["verdict-filter", "expectation-filter", "campaign-filter"]) $(id).value = "all"; renderCases(); });
  document.addEventListener("click", event => {
    const caseButton = event.target.closest("[data-case-id]");
    if (caseButton) { void loadCase(caseButton.dataset.caseId); return; }
    const matrixButton = event.target.closest("[data-vector-id][data-campaign-id]");
    if (matrixButton) { $("case-search").value = matrixButton.dataset.vectorId; $("campaign-filter").value = matrixButton.dataset.campaignId; $("verdict-filter").value = "all"; $("expectation-filter").value = "all"; renderCases(); location.hash = "runs"; }
  });
  $("close-drawer").addEventListener("click", () => $("case-dialog").close());
  $("case-dialog").addEventListener("click", event => { if (event.target === $("case-dialog")) { const box = $("case-dialog").getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $("case-dialog").close(); } });
  $("case-dialog").addEventListener("close", () => { state.selectedCase = null; state.caseDetails = null; state.caseToken++; state.caseController?.abort(); });
  window.addEventListener("hashchange", switchView);
  window.addEventListener("online", () => void fetchDashboard());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void fetchDashboard(); });
  window.addEventListener("pagehide", () => { state.eventSource?.close(); state.caseController?.abort(); });
  switchView();
  void fetchDashboard();
  connectEvents();
  setInterval(() => { if (!document.hidden && (!state.live || Date.now() - state.lastFetched > 60000)) void fetchDashboard(); }, 15000);
})();
