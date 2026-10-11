# Vibe Guru release notes

## 1.0.0 — 12 October 2026

This is the versioned source milestone for the release. Public npm installation
and native platform support require the distribution checks described in
[RELEASING.md](docs/RELEASING.md); a Git tag alone does not establish them.

- Deterministic runtime, repeated-use memory and retained-instance checks in one
  browser session, exposed through the CLI and local stdio MCP.
- Schema-2 reports with PASS, FAIL, INCONCLUSIVE and ERROR verdicts, explicit
  measurement limits, unique evidence references and exits 0/1/3/2; usage is 64.
- Authored journey assertions and retained observations, session reuse through
  normal sign-in, standalone HTML reports and local before/after comparisons.
- Local reliability dashboard with vector coverage, experiment evidence,
  implementation activity, source freshness, test history and measured durations.
- Controlled fault scenarios covering navigation, response races, reconnects,
  HTTP recovery, duplicate writes, storage corruption and conflicting updates.
- Installation diagnostics, checksum-verified bounded downloads, explicit MCP
  project-execution trust and hardened scratch/session-file handling.
- Optional, default-off PostHog metadata and voluntary feedback; no application
  source, reports, screenshots, heap snapshots or diagnostic messages are uploaded.
  Analytics delivery has a five-second per-event deadline and remains best effort.
- CI explicitly installs Chromium for Node browser tests before source validation.

Report schema remains **2**. The private browser-driver package has an independent
internal version. Adaptive Jev planning, automatic remediation, backend capacity
testing and general security certification are outside this release.

The source repository is private. Before public distribution, native binaries
must pass all four platform checks and be available anonymously from a reviewed
host. Existing staged-binary smoke tests do not verify public downloading.
