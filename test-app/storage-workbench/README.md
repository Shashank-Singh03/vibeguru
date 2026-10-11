# Storage resilience fixture

`node server.mjs` binds to loopback. `PORT` defaults to 65326. The host is inert;
the adapter opens a new same-origin iframe editor for each cold start and reload
while retaining the main measurement document.

The vulnerable editor trusts stored JSON and lets storage exceptions escape.
The defensive mode validates schema, offers a usable empty draft on read failure,
leaves the original stored bytes until an explicit save, and retains unsaved input
with a visible warning after a failed write. An explicit retry after lifting the
controlled fault must persist and survive a cold document load.

Malformed JSON and wrong schemas use real localStorage bytes. SecurityError and
QuotaExceededError are deterministic, key-scoped injected DOMExceptions, not a
claim that the browser's real origin quota was exhausted. Every cycle removes
only its namespaced draft/canary keys and iframe and verifies cleanup.
