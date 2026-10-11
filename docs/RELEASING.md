# Releasing Vibe Guru

This change prepares **0.2.0**; it does not publish an npm package or GitHub release.

## Source and dependencies

- Keep `mix.exs`, `package.json` and the root lockfile version aligned.
- Pin the same Playwright version in the root and driver manifests/lockfiles.
- Commit the reviewed source, tests, commercial/context artifacts and LICENSE.
- Run formatting, warning-free compilation, Elixir tests, Node tests and the isolated package smoke test.

The npm wrapper accepts `VIBEGURU_BINARY` for source and staged-native testing. Development escripts launch through `escript`/`escript.exe`; published native assets launch directly. The `auth` command participates in lazy Chromium setup.

## Build and validate

1. Run the release workflow manually against the reviewed commit. A manual run builds and checks native assets without publishing them.
2. The Linux build cross-compiles all four configured targets and creates `SHA256SUMS`.
3. Separate Windows, Linux, macOS Intel and macOS ARM runners install the actual tarball and exercise each native asset. They test CLI/browser/MCP behavior, clean and defective fixtures, and exits 0/1/2/3/64.
4. Retain those results. The workflow collects the version, commit, platform, binary hash and passed checks in `smoke-results.json`.
5. After reviewing passing results, tag the same commit `v0.2.0`. The tag workflow repeats the gates; only passing native checks permit the GitHub release publication job.
6. Run `npm run release:check` from the clean tagged checkout, then `npm publish`. `prepublishOnly` blocks publication unless the matching public release contains all assets, checksums and native smoke results for the exact commit.

The versioned native assets must exist before npm publication. The installer verifies the matching asset against its release checksum and stores version/checksum metadata beside its cache. A missing checksum or mismatch is a failed installation, rather than a partially cached executable.

## Support claims

All four architectures are build targets. Advertise packaged support only after the corresponding native smoke passes. Local Windows escript/tarball verification requires Erlang and is not a native Windows release check. Browser compatibility and framework detection are separate from packaged operating-system support.

Hosted customer execution, dashboards, billing and automated remediation are outside this release.

## Private source and public artifacts

The founder handles repository privacy and publication. The current installer and
publication gate use unauthenticated main-repository GitHub release URLs. Making
that repository private breaks public installation. Before advertising downloads,
move release artifacts to a reviewed public host, update the installer trusted-host
policy and release validator together, and rerun native cold-install CLI/MCP tests.
Never distribute a GitHub PAT with a package or website. The separate local portal
keeps installation controls disabled until versioned npm/native evidence is ready.
