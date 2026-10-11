# Two-client conflict fixture

Run `node server.mjs` (loopback port 65327, or `PORT`). No dependencies or build.
Use `/?mode=vulnerable` or `/?mode=versioned`. Seed a namespace through the API,
then open the same namespace in two browser contexts with `client=A` and `client=B`.

The vulnerable mode accepts complete stale snapshots, silently overwriting another
client's field. The versioned mode atomically compares `base_version`, returns HTTP
409 without committing a stale document, and exposes a retained draft plus explicit
Reconcile action. Reconcile reloads the latest document and merges only local dirty
fields. Same-field edits deliberately use the local value; no general merge claim.

Protocol (all replies include `fixture: vibeguru-conflict-workbench`):

- `GET /api/health` identifies modes/fields.
- `POST /api/:mode/seed`: `{namespace,document:{title,note}}` initializes version 1.
- `PUT /api/:mode/document`: `{namespace,client_id,attempt_id,base_version,document:{title,note},changed_fields:["title"|"note"]}`.
  Returns 200 plus receipt/document on commit, or 409 plus unchanged latest document
  and rejected-attempt receipt on a version conflict. Accepted versions increase by 1.
- `GET /api/:mode/state?namespace=...`: authoritative document, committed history,
  physical attempt ledger and in-flight count. Empty namespaces have `document:null`.
- `DELETE /api/:mode/state?namespace=...`: refuses active responses, then removes the
  document, history and attempts. Independent GET proves cleanup.

The adapter uses two isolated contexts, sequential acknowledged saves and unique
per-cycle namespaces. The measured primary page uses a native Open document control,
so its main document and route remain stable; no per-cycle main-page navigation.
Both clients and server state are cleared before a successful retention sample.
Cleanup includes two animation frames plus a 100ms renderer idle window and proof
that the primary page has only its main frame; this remains a bounded observation.
`conflict-serial` reloads B after A commits; `conflict-stale`
submits A then stale B; `conflict-reversed` submits B then stale A. All declare seven
checks, with `both-edits-preserved` last. Only vulnerable stale/reversed modes should
fail that invariant. Corrected stale cases issue a real 409, which may remain a raw
runtime finding under the engine's current HTTP-error policy even when behavior
checks pass. The engine measures the primary page only; secondary errors are retained
by the adapter as experiment observations and treated as infrastructure failures.

This is authored synthetic behavior in one in-memory process, without authentication,
durable persistence, cross-process CAS, real simultaneous editing or autonomous repair.
