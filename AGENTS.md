# Local reliability lab workflow

- Preserve the user's local-only constraint: do not stage, commit, push or publish
  unless the user later explicitly changes that instruction. Keep original Desktop
  projects unchanged; use ignored copies under `reports/` for app experiments.
- Start with `PROJECT_CONTEXT.md`. The local dashboard runs with `npm run dashboard`
  at `http://127.0.0.1:4545`; use `-- --port <port>` if needed.
- After behavior changes, run the relevant tests. Before declaring a completed
  implementation, use `npm run check` for formatting, compilation, ExUnit and Node
  tests. `npm test` and `mix test` automatically save suite records in ignored
  `reports/test-history/`; campaign results from `scripts/lab.mjs` are discovered
  automatically. Do not replace a failure with a hard-coded passing dashboard value.
- Keep `dashboard/vectors.json` current when adding or planning a vector. Planned
  and implemented are different; campaign case outcomes are not vector-specific
  accuracy. New adapters should emit explicit assertions and retained observations.
- Append a concise logical-change note to `dashboard/activity.json`, linking actual
  evidence and relevant files. Live Git changes update automatically; semantic
  implementation notes require an intentional update.
- Update the relevant context document and run `python scripts/context-map.py`
  after the final edits. Dashboard freshness does not mean tests reran after a save:
  stale source-revision indicators must remain visible until an appropriate rerun.
