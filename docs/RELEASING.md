# Releasing Vibe Guru

The founder authorized version **1.0.0** source preparation and Git synchronization
on 12 October 2026. Source versioning, tag-triggered native builds and public
distribution are separate steps. See [release notes](../CHANGELOG.md) and the
[1.0.0 context record](context/RELEASE_1_0_0.md) for the current boundaries.

## Source and dependencies

- Keep `mix.exs`, `package.json` and the root lockfile version aligned.
- Pin the same Playwright version in the root and driver manifests/lockfiles.
- Resolve public artifact hosting and customer support links before the final
  release commit and tag. A versioned source-preparation commit can be pushed first.
- Commit the reviewed source, tests, commercial/context artifacts and LICENSE.
- Run formatting, warning-free compilation, Elixir tests, Node tests and the isolated package smoke test.

The npm wrapper accepts `VIBEGURU_BINARY` for source and staged-native testing. Development escripts launch through `escript`/`escript.exe`; published native assets launch directly. The `auth` command participates in lazy Chromium setup.

## Build and validate

1. Run the release workflow manually against the reviewed commit. A manual run builds and checks native assets without publishing them.
2. The Linux build cross-compiles all four configured targets and creates `SHA256SUMS`.
3. Separate Windows, Linux, macOS Intel and macOS ARM runners install the actual tarball and exercise each native asset. They test CLI/browser/MCP behavior, clean and defective fixtures, and exits 0/1/2/3/64.
4. Retain those results. The workflow collects the version, commit, platform, binary hash and passed checks in `smoke-results.json`.
5. After reviewing passing results, tag the same commit `v1.0.0`. The tag workflow repeats the gates; only passing native checks permit the GitHub release publication job. With the current hosting configuration this creates a private release, not anonymous customer downloads.
6. Once public artifact hosting is configured, run a fresh packaged installation with no `VIBEGURU_BINARY` override and no populated vendor cache. Verify actual checksum/binary downloads and CLI/browser/MCP operation. Existing staged native smoke deliberately bypasses downloading and cannot prove this.
7. Run `npm run release:check` from the clean tagged checkout, then `npm publish`. `prepublishOnly` blocks publication unless the matching public release contains all assets, checksums and native smoke results for the exact commit. Verify the exact published npm version from a fresh environment.

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
