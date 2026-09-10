"use strict";

// server.js — Vibe Guru as an MCP server.
//
// The bet this file makes: a coding agent can read source all day and still not know
// whether the app runs. It can drive a browser itself through a generic automation
// server, but then it pays to look at the page and reason about what it sees — on the
// order of a hundred thousand tokens for one verification. Here the looking and the
// reasoning happen in Elixir, deterministically, and the agent gets a verdict back.
//
// So the tool surface is deliberately small. Every tool definition is schema the
// client loads into context before the agent has done anything at all, and a server
// that ships twenty of them has already spent the advantage it was selling.

const { analyze, readFindings } = require("./engine");
const { renderReport, filterFindings } = require("./render");

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
        "exceptions, runaway re-renders, failed requests, console errors, and memory leaks. " +
        "Starts the dev server if it is not already running, exercises every route it can " +
        "reach, and returns measured findings with a fix for each. The analysis is " +
        "deterministic — no model is involved, so the same defect reports identically every " +
        "time. Call this after making changes, before reporting work as done. Takes roughly " +
        "one to three minutes.",
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
              "Off by default so a verification leaves no trace in the repo."
          ),
      },
    },
    async ({ root, url, cycles, routes, write_report }) => {
      const runCycles = cycles ?? DEFAULT_CYCLES;

      try {
        log(`analyzing ${url || root || process.cwd()} (${runCycles} cycles)`);

        const { report, outDir, wroteReport } = await analyze({
          root,
          url,
          cycles: runCycles,
          routes: routes ?? DEFAULT_ROUTES,
          writeReport: write_report,
          onLog: log,
        });

        lastRun = { report, root: root || process.cwd(), outDir, cycles: runCycles };
        log(`done — ${report.findings?.length ?? 0} finding(s)`);

        return text(renderReport(report, { cycles: runCycles, wroteReport, outDir }));
      } catch (err) {
        log(`failed — ${err.message}`);
        return failure(
          `Could not complete the run: ${err.message}\n\n` +
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
        report = readFindings(root);
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
        return text(`No findings matching ${scope}. The last run reported ${report.findings.length} in total.`);
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
