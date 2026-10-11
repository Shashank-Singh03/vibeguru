# 1.0.0 source release — 12 October 2026

The founder requested that the reviewed local changes be sent to Git as version
**1.0.0**, in preparation for broader release. This authorizes source review,
version changes, commit and push. Repository visibility stays private. It does
not override distribution checks or establish native support by declaration.

## Included scope

The npm manifest, root lockfile and Elixir engine are aligned at 1.0.0. The MCP
handshake and telemetry obtain the product version from the root manifest.
Report schema stays 2. The private driver and intentional test applications have
independent package versions; historical reports retain their original versions.

This snapshot includes the pending default-off telemetry deadline regression,
ignored key-directory rule, verified PostHog dashboard context, release notes and
current CLI/MCP installation instructions. The customer telemetry guide describes
metadata interpretation without founder account links or unavailable internal
context links. CI and the release build install Chromium explicitly because the
Node suite now includes real-browser fixture tests.

The earlier source snapshot has been merged into `origin/main` through pull
request #3. Base the versioned source on that merged history, preserving branches
and avoiding force pushes. Actual commit/tag identities and remote verification
belong in the ignored release record, rather than a self-referential source hash.

This synchronization prepares and pushes source version 1.0.0. Defer the release
tag until public hosting is aligned and the final native build is reviewed; the
existing tag workflow can publish assets automatically after its native gates.

## Checks and evidence

Use `npm run check` for formatting, warnings-as-errors compilation, ExUnit and
Node tests. Then build the current development escript and run
`npm run test:package` against the actual packed npm files. This checks CLI exits,
defect/clean browser controls and the packaged MCP handshake and verifier.

Test results are recorded under `reports/test-history/`. Keep release-specific
review, version/package-boundary checks, commit identity and remote push evidence
under `reports/release-1.0.0/`. Never substitute a successful source/escript result
for a self-contained native platform result. Re-run repository checks after the
source commit so the dashboard records the committed source revision.

The independent pre-version review found no founder token or credential-pattern
matches in 258 candidate files; the only PostHog-pattern hit was a synthetic test
token. Final candidates must be rescanned before staging. Keys, per-user consent,
browser sessions, raw reports, test logs, build outputs and Desktop originals
remain excluded. The separate website is outside this source push.

## Remaining public-distribution gates

1. The installer, release validator and workflow currently target releases in
   the private source repository. Anonymous customers cannot read those assets.
   Select separate public binary hosting, align all three paths and public support
   links, and keep source private. Never distribute a GitHub credential.
2. Run native tarball/browser/CLI/MCP smoke on Windows x64, Linux x64, macOS Intel
   and macOS Apple silicon. Retain exact-commit smoke proof and binary checksums.
3. Test fresh anonymous installation without `VIBEGURU_BINARY` or a populated
   vendor cache. Current staged smoke bypasses installer downloads by design.
4. Pass `npm run release:check` from the clean matching tag; then publish and
   independently verify the exact npm package. The existing prepublish gate stays
   enabled. The source push does not publish npm or deploy the website.

Pushing `v1.0.0` starts the configured gated native workflow. If it succeeds with
the current destination, the resulting GitHub release is private. Native build
and workflow outcomes must be observed separately; no passing result is claimed
by this document. Public installation buttons must stay gated until delivery is
verified. These boundaries follow [GitHub's release access model](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
and the repository's actual release/installer code, reviewed on 12 October 2026.
