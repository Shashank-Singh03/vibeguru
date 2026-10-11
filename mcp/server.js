"use strict";

// server.js — Vibe Guru as an MCP server.
//
// A browser measurement run returns a scoped verdict and retained evidence for
// a coding agent to investigate. It does not establish all business outcomes or
// prove that a suspicious retention trend is an application memory leak.
//
// So the tool surface is deliberately small. Every tool definition is schema the
// client loads into context before the agent has done anything at all, and a server
// that ships twenty of them has already spent the advantage it was selling.

const { analyze, readFindings } = require("./engine");
const { renderReport, filterFindings } = require("./render");
const { createTelemetry, summarizeReport } = require("../scripts/lib/telemetry");
const telemetry = createTelemetry();

const NAME = "vibeguru";

// Four cycles is the useful default for an agent loop: enough repetition for the
// per-visit memory deltas to separate from noise, few enough that a verification
// comes back in about a minute. The CLI defaults higher because a person running it
// once is buying signal, not turnaround.
const DEFAULT_CYCLES = 4;
const DEFAULT_ROUTES = 12;

// Remembered so an agent can re-read what it already paid for. A run costs minutes;
// re-running it because the findings scrolled out of context would be the expensive
// mistake this server exists to avoid.
let lastRun = null;

function log(message) {
  process.stderr.write(`[vibeguru] ${message}\n`);
}

function text(body) {
  return { content: [{ type: "text", text: body }] };
}

function failure(body) {
  return { content: [{ type: "text", text: body }], isError: true };
}

async function main() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");

  const { version } = require("../package.json");
  const server = new McpServer({ name: NAME, version });

  server.registerTool(
    "verify_runtime",
    {
      title: "Verify the app actually runs",
      description:
        "Run the web app in a real browser and report what breaks at runtime: uncaught " +
        "exceptions, excessive DOM mutation, failed requests, console errors, and resource-retention signals. " +
        "Exercises reachable routes within configured limits and returns findings with " +
        "evidence and suggested investigations. Supply url for an already-running app; " +
        "starting project scripts or configured flows requires allow_project_execution. The analysis is " +
        "deterministic — no model is involved; browser measurements may vary. Verdicts are " +
        "PASS, FAIL, INCONCLUSIVE or ERROR within the tested scope. Call this after making changes, before reporting work as done. Takes roughly " +
        "a variable amount of time depending on the app and requested cycles; repeated runs can take minutes.",
      inputSchema: {
        root: z
          .string()
          .optional()
          .describe("Project directory to analyze. Defaults to the server's working directory."),
        url: z
          .string()
          .optional()
          .describe(
            "Analyze an already-running server at this URL instead of starting one. " +
              "Use when the app is served by something this tool cannot start itself."
          ),
        cycles: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe(
            `Mount/unmount cycles per route (default ${DEFAULT_CYCLES}). Raise for a stronger ` +
              "memory-leak signal at the cost of a longer run."
          ),
        routes: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(`Maximum routes to exercise (default ${DEFAULT_ROUTES}).`),
        write_report: z
          .boolean()
          .optional()
          .describe(
            "Also write CLAUDE.md and the report files into the project directory. " +
              "Off by default. Config-driven first runs may still create vibeguru.json."
          ),
        allow_project_execution: z
          .boolean()
          .optional()
          .describe(
            "Required for config-driven runs without url: explicitly authorize executing " +
              "this trusted local project's dev command and configured JavaScript flow. " +
              "Prefer url for an already-running app when project execution is unnecessary."
          ),
      },
    },
    async ({ root, url, cycles, routes, write_report, allow_project_execution }) => {
      const runCycles = cycles ?? DEFAULT_CYCLES;
      const runId = telemetry.runId();
      const analytics = telemetry.enabled();
      const metadata = { run_id: runId, channel: "mcp", command: "verify_runtime" };
      await telemetry.capture("vibeguru_run_started", metadata);
      const started = performance.now();

      try {
        log(`analyzing ${url || root || process.cwd()} (${runCycles} cycles)`);

        const { report, outDir, wroteReport } = await analyze({
          root,
          url,
          cycles: runCycles,
          routes: routes ?? DEFAULT_ROUTES,
          writeReport: write_report,
          allowProjectExecution: allow_project_execution === true,
          onLog: log,
        });

        lastRun = { report, root: root || process.cwd(), outDir, cycles: runCycles };
        log(`done — ${report.findings?.length ?? 0} finding(s)`);
        const summary = summarizeReport(report);
        await telemetry.capture(summary ? "vibeguru_run_completed" : "vibeguru_run_error", {
          ...metadata, ...(summary || { verdict: "ERROR", error_category: "report_invalid" }),
          duration_ms: performance.now() - started,
        });
        await telemetry.flush();
        const feedback = analytics ? `\n\nOptional usage-feedback run ID: ${runId}. Share feedback with ` +
          `vibeguru telemetry feedback --run ${runId} --kind helpful|not_helpful|confirmed|dismissed.` : "";
        return text(renderReport(report, { cycles: runCycles, wroteReport, outDir }) + feedback);
      } catch (err) {
        await telemetry.capture("vibeguru_run_error", { ...metadata, verdict: "ERROR",
          error_category: "execution", duration_ms: performance.now() - started });
        await telemetry.flush();
        log(`failed — ${err.message}`);
        return failure(
          `ERROR — Could not complete the run: ${err.message}\n\n` +
            "Common causes: the dev server failed to start, the project has no package.json, " +
            "or nothing is listening at the URL given."
        );
      }
    }
  );

  server.registerTool(
    "read_findings",
    {
      title: "Re-read the last findings",
      description:
        "Return the findings from the most recent verify_runtime without running it again. " +
        "Use this instead of re-verifying when the earlier results are no longer in context, " +
        "or to narrow to one severity or route — a fresh run costs minutes, this costs nothing.",
      inputSchema: {
        severity: z
          .enum(["critical", "high", "medium", "low", "info"])
          .optional()
          .describe("Only findings at least this severe."),
        route: z.string().optional().describe("Only findings on this route, e.g. \"/checkout\"."),
        root: z
          .string()
          .optional()
          .describe(
            "Read a report previously written to this project directory (needs write_report). " +
              "Defaults to the last run held in memory."
          ),
      },
    },
    async ({ severity, route, root }) => {
      let report = lastRun?.report;

      if (root) {
        try { report = readFindings(root); }
        catch (err) { return failure(`ERROR — ${err.message}`); }
        if (!report) {
          return failure(
            `No findings file in ${root}. Run verify_runtime with write_report enabled to leave one there.`
          );
        }
      }

      if (!report) {
        return failure("No run yet in this session. Call verify_runtime first.");
      }

      const filtered = filterFindings(report, { severity, route });

      if (filtered.findings.length === 0 && (severity || route)) {
        const scope = [severity && `severity ${severity} or worse`, route && `route ${route}`]
          .filter(Boolean)
          .join(" and ");
        return text(`No findings matching ${scope}. The last run reported ${report.findings.length} in total.\n\n` + renderReport(filtered, { cycles: lastRun?.cycles }));
      }

      return text(renderReport(filtered, { cycles: lastRun?.cycles }));
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready (v${version}) — verify_runtime, read_findings`);
}

main().catch((err) => {
  process.stderr.write(`[vibeguru] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
