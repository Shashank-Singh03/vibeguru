# Isolated write-integrity fixture

Run `node test-app/write-integrity/server.mjs` from the repository root. It binds
only `127.0.0.1` on `PORT` (default 65325), uses Node built-ins, and needs no build
or dependency installation. Importing `createWriteIntegrityServer()` starts no
listener; focused tests can listen on ephemeral ports.

Open `/?mode=vulnerable` or `/?mode=idempotent` on that server. Both are deliberately
authored fixture implementations, not discovered customer bugs or an autonomous
repair. The vulnerable endpoint commits every physical request. The corrected
endpoint atomically looks up an idempotency key and commits once per namespace;
reusing a key with changed product/quantity returns 409. Attempt IDs identify
physical requests; intent IDs and idempotency keys identify logical orders.

The adapter is `benchmarks/lab/write-integrity.mjs`. Its variants are:

| Variant | Real interaction | Vulnerable expectation | Corrected expectation |
| --- | --- | --- | --- |
| `write-single` | One native submit click | All checks pass | All checks pass |
| `write-double` | Native double-click, 10ms between clicks | `single-persisted-order` fails | All checks pass |
| `write-retry` | Retry the same intent after its first successful acknowledgement | `single-persisted-order` fails | All checks pass |

Every run uses an isolated namespace; each cycle starts with verified empty state
and a fresh logical intent. Physical HTTP
responses, the backend attempt ledger, persisted order payloads, visible count,
and cleanup readback are retained through `ctx.observe`. The final order-count
assertion follows all prerequisites. Transport failures, unreadable readback, or
failed cleanup remain execution failures; cleanup preserves an existing failed
application assertion in an `AggregateError` when both fail.

The server retains state **in memory in one process**, with no database, auth,
external payments, server restart, proxy retry, cross-process lock or durable
transaction test. The fixed response delay makes rapid submissions observable;
the adapter records whether requests actually overlapped. Explicit retry happens
after a successful response, so it does not demonstrate lost-response recovery.
Namespaces are deleted only after writes settle and verified empty afterward.
The fixture validates a supplied invariant, not general business correctness.
