# Installing and using Vibe Guru

Updated 12 October 2026. Source version **1.0.0 is not a verified public native
release**. The local website at `http://127.0.0.1:4546` keeps installation buttons
disabled until matching downloads pass the release gates. Do not send prospects
to an older npm version as if it contained this checkout's fixes.

## Use the current local checkout

Prerequisites: Node.js 20+, Elixir 1.18 and Erlang/OTP. From this repository:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix driver-node
npx playwright install chromium
mix deps.get --check-locked
mix escript.build
```

In PowerShell, select the built engine and check the installation:

```powershell
$env:VIBEGURU_BINARY = (Resolve-Path .\vibeguru).Path
node bin/vibeguru.js doctor
```

On macOS/Linux:

```sh
export VIBEGURU_BINARY="$PWD/vibeguru"
node bin/vibeguru.js doctor
```

`doctor` checks prerequisites without downloading or changing configuration. A
successful result establishes file/header/cache and launcher presence, not a
successful browser run or native operating-system certification. An explicit
engine override is trusted local code; its presence does not prove provenance.

For a first check, start your local application yourself, then run:

```sh
node bin/vibeguru.js memory:client http://127.0.0.1:3000 --cycles 4 --routes 12 --out ./reports/first-check
```

Open `reports/first-check/vibeguru-report.html`. Use your app's actual port.
This URL survey checks reachable views and resource/runtime signals. It does not
invent business assertions or log in. For normal sign-in/session reuse and authored
journeys, configure a trusted project:

```sh
node bin/vibeguru.js init --root /absolute/path/to/app
node bin/vibeguru.js auth --root /absolute/path/to/app
node bin/vibeguru.js run --root /absolute/path/to/app --cycles 4 --out ./reports/signed-in-check
```

`auth` opens a headed browser for the person to sign in. Session files contain
credentials. Review the generated `vibeguru.json` and any flow before running:
config-driven execution can start shell commands and import full-privilege Node
code. Use a local/staging test account and isolated test data. See the README for
declared flow assertions and report limitations.

## MCP from the current checkout

For clients using an `mcpServers` JSON configuration, use absolute paths. This
Windows example assumes this exact checkout; adapt the paths on other machines:

```json
{
  "mcpServers": {
    "vibeguru": {
      "command": "node",
      "args": ["C:\\Users\\Shashank\\vibecheck\\bin\\vibeguru.js", "mcp"],
      "env": {
        "VIBEGURU_BINARY": "C:\\Users\\Shashank\\vibecheck\\vibeguru"
      }
    }
  }
}
```

Reload the MCP client and confirm `verify_runtime` and `read_findings` appear.
The config file's location depends on the client. Clients must support local
stdio MCP servers; this is not an HTTP endpoint.

For an already-running app, call `verify_runtime` with:

```json
{"root":"C:\\path\\to\\app","url":"http://127.0.0.1:3000","cycles":4,"routes":12}
```

This mode skips project config execution. To use a reviewed project's server
command, saved session or flow, omit `url` and explicitly authorize execution:

```json
{"root":"C:\\path\\to\\trusted-app","allow_project_execution":true,"cycles":4,"routes":12}
```

Do not grant that flag solely because an agent found a repository. Reports are
temporary by default; `write_report:true` writes reports into the project. Re-read
cached findings with `read_findings`; a filter retains the whole-run verdict.

## Customer installation after a verified release

These are **future release instructions**, not working 1.0.0 distribution claims.
Once the exact npm package and anonymously accessible native assets are verified,
customers need Node.js 20+ and internet access for the first browser download;
validated native assets bundle Erlang.

```sh
npm install -g vibeguru@1.0.0
vibeguru doctor
vibeguru memory:client http://127.0.0.1:3000 --cycles 4 --out ./vibeguru-results
```

For MCP, the future common configuration uses `"command":"npx"` and
`"args":["-y","vibeguru@1.0.0","mcp"]`; on Windows use `npx.cmd` if your
client requires the executable extension. Prefer installing once and checking
`vibeguru doctor` before configuring MCP, so first-run downloads are visible.
A bare engine executable is insufficient: it also needs the bundled Node driver,
dependencies and Chromium setup provided by the npm wrapper.

The current installer fetches assets from the main GitHub repository. Making it
private prevents unauthenticated customers from fetching those releases. Before
enabling the website, choose a stable public artifact host, update the installer's
explicit trusted-host policy and release check, then test cold CLI and MCP installs
on each advertised platform. Never place a GitHub access token in the website or
installer. See [RELEASING.md](RELEASING.md) and the separate website README.

## Optional product analytics

Users do not need a PostHog account. They can opt in to the founder's project
using its public ingestion token, then optionally state audience/use case/team
size. Installation does not opt them in. See [TELEMETRY.md](TELEMETRY.md) for
enable/disable commands, exact fields, feedback and collection limits.

## Exit codes and troubleshooting

| Exit | Meaning / action |
| --- | --- |
| 0 | PASS within the exercised scope; read coverage and limitations |
| 1 | FAIL: blocking application findings; inspect evidence and reproduce |
| 2 | ERROR: execution/setup/reporting failed; inspect stderr and run doctor |
| 3 | INCONCLUSIVE: required measurements/interactions incomplete |
| 64 | Usage error: correct command arguments |

If a first install fails, check the matching release is actually available, proxy
and network access, disk space and Chromium installation. Security policy rejects
unapproved release redirects and oversized/slow downloads. Do not work around it
by disabling HTTPS verification. `VIBEGURU_BINARY` selects a separately reviewed
local engine for development; it is not a public release fallback.
