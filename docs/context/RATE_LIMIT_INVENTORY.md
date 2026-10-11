# Source-only rate-control inventory and readiness

Reviewed **10 October 2026, Asia/Calcutta**. This review follows the instruction to
skip load/rate-limit exercises and record what source implements. No requests were
sent to test enforcement, no authentication bypass was attempted, and no credentials
or environment files were read. Original Desktop applications were only read.

## What the labels mean

- **Enforcement code found:** a request/message path invokes an implemented control.
  This does not establish that a deployed instance enables or correctly applies it.
- **UI/configuration only:** a screen, type, dependency or setting advertises a control;
  its presence alone does not verify enforcement.
- **Not found in reviewed source:** a bounded source search and relevant entry-point
  inspection found no request-frequency control. External proxies/CDNs may differ.
- **Runtime unverified:** no dynamic rate-limit or capacity test ran for this
  inventory. Legitimate authenticated functional tests, when available, are
  recorded separately and do not establish rate-limit enforcement.

## Inventory

| Project and inspected scope | Source-only conclusion | Runtime status |
|---|---|---|
| HTAD gateway: original `Desktop/proj/HTAD/gateway/app/` and `infra/nginx/nginx.conf`; original/copied React UI | **Enforcement code found** for registered gateway routes, using a Redis-backed token bucket. UI manages policies. Admin paths and error conditions have explicit exemptions described below. | Unverified. Earlier browser campaigns used HTTP fixtures rather than this backend. |
| Swap-station: original `backend/` Python source and requirements, supplied `nginx.conf`; copied React frontend | **Request limiter not found in reviewed source**, including the login route. Flask-Login and payload/database limits exist; these are different controls. | Unverified. Earlier browser campaigns used HTTP fixtures and a synthetic frontend role. |
| Multiplayer sync: original and copied `server/src/`, server package manifest and supplied deployment configuration | **Request/message-frequency limiter not found in reviewed source**. Frame-size validation, heartbeat, sequence checks and outbound cursor batching exist. | The real local server has previously been exercised for delivery/reconnect, without capacity or abuse-resistance testing. |
| Vibe Guru: normal CLI/MCP, driver and analyzers, vector registry | **Rate-limit assessment is not an implemented vector.** Existing browser runtime collection may record HTTP failures, but does not establish configured budgets or reliable enforcement. | This document is a manual source inventory, separate from campaign pass/fail results. |
| Robot frontend: public-only isolated Next.js evaluation | **Backend rate controls not assessed.** Frontend behavior cannot establish backend admission enforcement. | No API/backend connection, load or authentication test. |
| Robot-programming-main: backend authentication, job/provider controls, WebSocket entry point, main middleware and supplied Caddy configuration | **Enforcement code found** for failed sign-ins, keyed by email in process memory. Outgoing inference and active-job concurrency controls also exist. General HTTP/IP request-frequency protection was not found in the reviewed middleware/proxy. | Source-only assessment added 10 October. No rate-limit enforcement, capacity or abuse-resistance test ran; separate local functional testing does not verify these properties. |

### HTAD: implemented control and its boundaries

Paths below are relative to `C:/Users/Shashank/Desktop/proj/HTAD/`:

- `gateway/app/main.py:122`: HTTP middleware resolves a registered route, API and
  policy, calls `RateLimiter.check`, and returns HTTP 429 when the decision denies
  the request (`:169–201`). Allowed responses receive remaining/limit headers
  (`:207–210`). This is enforcement source rather than merely a configuration UI.
- `gateway/app/rate_limit/limiter.py:41–57` invokes the Redis Lua implementation.
  `lua_scripts.py:8–40` reads bucket state, refills tokens and consumes or rejects
  the request in one script. Actual atomic execution and Redis availability were
  not tested in this review.
- `gateway/app/routing/store.py:29–36` creates an enabled default IP policy with
  capacity 100, refill 10 tokens/second and request cost 1. Demo startup creates a
  separate enabled policy with capacity 50 and refill 5 (`main.py:61–68`). These
  are source defaults, not a claim about the running configuration.
- `/admin` paths explicitly skip the middleware (`main.py:124–126`). Unknown
  routes, missing APIs and missing policies pass through (`:141–156`). Disabled
  policies allow requests (`limiter.py:34–39`). Redis errors fail open
  (`limiter.py:58–69`), and middleware exceptions also fail open (`main.py:214–217`).
  Therefore, “rate limiting exists” must not imply universal endpoint protection.
- Policy keys are selected from API key, tenant header or IP (`main.py:158–167`).
  The model allows a `global` key type (`rate_limit/models.py:17`), while the shown
  middleware falls back to IP for that type. Global-budget semantics are not
  demonstrated by this path.
- `gateway/app/deps.py:7–17` accepts the first `X-Forwarded-For` value when present.
  Whether that is safe for identity-based limits depends on the actual trusted
  proxy boundary; this source review does not establish deployment isolation.
- `get_api_key` uses a FastAPI `Header` default (`deps.py:22–27`), but the middleware
  calls it directly with only `request` (`main.py:133`). FastAPI dependency
  resolution is not evident in that direct call. API-key partitioning needs a
  focused correctness review before being advertised as working.
- The supplied `infra/nginx/nginx.conf` proxies API/admin paths (`:61–71`); no
  `limit_req` or `limit_conn` directive was found in that file.
- The copied UI's `src/api/client.ts:35–43` defines the policy fields and `:84–89`
  calls admin policy endpoints. `src/pages/RatePolicyListPage.tsx:31–43` submits
  policy data. Those frontend files cannot prove backend enforcement.

These are review findings, not confirmed exploits, and no original app was patched.

### Swap-station: authentication and other limits are not rate limiting

Paths relative to `C:/Users/Shashank/Desktop/proj/work/swapp_station/`:

- `backend/routes/auth.py:12–22` implements login and creates a Flask-Login session.
  No request limiter decorator or admission counter was found in that route.
- `backend/app.py:36–44` configures Flask-Login and JSON unauthorized responses.
  `:88` caps HTTP body size at 100 MB; database pool controls and this payload cap
  are not per-client request-frequency controls. No Flask-Limiter/SlowAPI limiter
  integration was found in the reviewed Python files or requirements.
- Supplied `nginx.conf:22` proxies API traffic and `:41` proxies Socket.IO. No
  `limit_req` or `limit_conn` directive was found in that supplied configuration.
- Frontend `src/hooks/useAuth.js:8–13` reads a locally stored user; protected-route
  rendering is not server authorization. Earlier lab role injection made a mocked
  frontend journey reachable and did not verify server authentication or permissions.

Production ingress, separate infrastructure and runtime settings remain unknown.

### Multiplayer: useful bounds without an incoming message budget

Paths relative to `C:/Users/Shashank/Desktop/proj/flam-multiplayer-sync/`:

- `server/src/server.ts:117–129` accepts protocol-valid WebSocket upgrades on `/ws`.
  `:142–191` parses and dispatches each incoming application message. No per-IP,
  per-connection message-frequency counter or admission budget was found there.
- `server/src/ws/frame.ts:39,103–110` enforces a 1 MiB frame payload bound. It is
  a size limit, not a message-rate guarantee.
- `server/src/protocol.ts:21–22` sets a 20 Hz outbound state tick. `room.ts:194–211`
  keeps the latest cursor state and rejects stale sequence numbers. Cursor batching
  reduces outbound work; it does not rate-limit incoming parsing/dispatch.
- Renames and reactions broadcast immediately (`room.ts:215–220,237–245`).
  Heartbeat/liveness in `ws/socket.ts:74` is also distinct from a rate limiter.

No capacity, crash-resistance, distributed-control or production-edge conclusion
follows from these static observations.

### Robot-programming-main: sign-in lock and workload controls

This expands the earlier public-frontend-only scope above. Paths below are relative
to `C:/Users/Shashank/Desktop/robot-programming-main/`, reviewed through its unchanged
isolated source copy under
`reports/robot-main-evaluation-1791611919310/apps/robot-main/`. No existing account
credentials, environment files or provider keys were inspected. The inventory is
source evidence; no requests were sent to exercise the controls.

- `backend/backend/core/login_throttle.py:32–39` declares five failed attempts per
  lock step, a 10-second step, a 60-second maximum, a 900-second idle reset and at
  most 5,000 tracked keys. Keys are trimmed/lowercased (`:42`); access is protected
  with a thread lock (`:61–80`). Lock checks (`:83`), failure accounting (`:93`),
  success resets (`:120`) and idle/oldest entry eviction (`:144`) are implemented.
- `backend/backend/api/v1/endpoints/auth.py:390` wires the control into sign-in.
  It checks an existing lock before password verification (`:403`), records failures
  for unknown accounts and incorrect passwords (`:410`), and resets the key after
  a correct password (`:426`). The exception helper (`:376`) returns HTTP 429 with
  `Retry-After`. Every fifth consecutive failure starts a 10/20/…60-second lock.
  This is per-email failed-sign-in protection, rather than a general successful
  request budget. No equivalent limiter invocation was found in sign-up (`:320`)
  or token refresh (`:464`).
- The table is **process-local and nonpersistent**. The supplied
  `backend/docker-entrypoint.sh:37` starts one Uvicorn process, but multiple
  processes/replicas would not share counters;
  restarts and key eviction also change retained state. No shared/distributed
  admission mechanism or per-IP/global HTTP budget was established by this path.
- `backend/backend/core/llm_runtime.py:39–50` creates an outgoing provider semaphore
  with a default concurrency of six. Request-start spacing and cooldown use an
  asyncio lock (`:55–76`), with a default 1.25-second spacing configured in
  `backend/backend/core/config.py:162`. These controls protect outgoing inference
  work; they do not limit incoming API traffic. No provider was called to verify
  their timing, retries or quota behavior.
- `backend/backend/workers/job_queue.py:413` bounds active job slots using
  `MAX_CONCURRENT_JOBS` (source default three in
  `backend/backend/core/config.py:128`) and supports user-fair ordering. This is
  concurrency control, not evidence of an incoming request budget or a bounded
  total backlog.
- `backend/backend/core/config.py:170,173–174` supplies message-queue and replay
  event/byte limits; `backend/backend/workers/job_queue.py:144–148` reads replay
  limits. These buffer bounds do not establish a limit on inbound frequency. No
  incoming message-rate limiter was found in the reviewed WebSocket receive loop
  at `backend/backend/api/v1/endpoints/websocket.py:393`.
- `backend/main.py:115–126` registers GZip and CORS middleware. The supplied
  `proxy/Caddyfile:7–15` routes API/WebSocket and frontend traffic with
  `reverse_proxy`. No general HTTP request-rate limiter was found in these
  reviewed entry points. Separate ingress, a CDN, deployment overrides and
  production configuration remain unassessed.

The isolated backend can support normal sign-up, approval and sign-in testing;
that functional coverage must remain separate from this source inventory. The
ignored [detailed inventory](../../reports/robot-main-evaluation-1791611919310/RATE_CONTROL_NOTE.md)
retains this review's control-by-control scope. None of these observations adds a
rate-limit vector or a dynamic enforcement PASS.

## Product readiness

Vibe Guru is **ready for supervised local evaluations, not a finished general-purpose
reliability/security product**. It has an operational CLI/MCP, outcome assertions,
retained evidence, four verdicts and a useful dashboard. Thirteen registered vectors
are implemented, but several state/recovery adapters are validated on purpose-built
fixtures. That count is coverage inventory, not independent real-world accuracy.

Earlier copied Desktop tests supply some real-app evidence: the gateway Create API
navigation mismatch and refresh race, and actual multiplayer delivery/reconnect.
Gateway/swap-station backend integration was mocked, so their existing results do
not establish authentication, authorization, database integrity or rate enforcement.
Short gateway memory controls also crossed thresholds inconsistently; longer runs
support cautious warm-up interpretation instead of a confirmed permanent leak.

Normal signed-in testing can use `vibeguru auth`: `lib/vibe_guru/auth.ex` captures a
human-created session for later browser runs. That is session reuse, not auth bypass.
Session expiry remains planned in `dashboard/vectors.json`, alongside sustained
responsiveness. Autonomous planning/repair and the separate investigation pipeline
are not integrated product capabilities.

The three most concrete unfinished-product blockers are:

1. **A new app still needs authored integration and an oracle.**
   `benchmarks/README.md:11–36,80,112–113` describes supplied checks and app-specific
   adapters; gateway/swap-station data and role are mocked. An unscripted app is not
   automatically understood or tested through legitimate backend workflows. Recent
   flow setup/outcome recording is implemented; autonomous discovery and Jev are
   still proposed. Evaluate setup time and real authenticated read/write outcomes
   before calling this a general application verifier.
2. **Breadth exceeds independent calibration.** New storage/conflict checks and
   target-assertion charts are implemented and exercised, but their main evidence
   is authored vulnerable/corrected fixtures. The latest state-resilience document
   explicitly leaves real quota exhaustion, session refresh, durable persistence
   and same-field conflicts unverified. Earlier real-app memory controls also
   varied, and module-scoped chart census remained unavailable. Missing-evidence
   verdict handling and the three recent false-PASS fixes are implemented; they
   should not be described as still-unfixed original audit gaps. The remaining
   blocker is independently confirmed behavior and useful scope across more apps.
3. **Customer installation has narrower proof than advertised platform reach.**
   Local package version alignment, integrity verification and release gates are
   implemented. The retained Windows x64 tarball proof used an Erlang escript;
   native Burrito assets and other platforms were not validated by those local
   runs (`DESKTOP_EVALUATION.md`, installation verification). An engineer-run local
   evaluation is feasible now; a dependable distributed product still needs the
   exact native package/install matrix and reproducible fresh-install evidence.

The next evaluation should use isolated copies and legitimate test identities,
record baseline business outcomes before adding controlled failures, and separate
observed app defects from injected signals and unverified boundaries. Preserve
INCONCLUSIVE when a required backend or measurement is unavailable. Use original
Desktop sources only for read-only comparison; keep writes and test data under
ignored `reports/` workspaces.

References: [Desktop evaluation](DESKTOP_EVALUATION.md), [network evaluation](NETWORK_EVALUATION.md),
[state-resilience iteration](STATE_RESILIENCE.md), and the ignored Desktop/network
manifests used to identify source and disposable copies. This source-only document
does not add an implemented vector or a passing dynamic-test record.
