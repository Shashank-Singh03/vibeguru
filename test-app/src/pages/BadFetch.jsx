import { useEffect, useState } from "react";

// FIXTURE: requests that never succeed.
//
// Two failure modes, because they surface differently and both are common in
// AI-generated apps:
//
//   1. A misconfigured API base URL pointing at a backend that is not running.
//      This never reaches HTTP at all — it fails at the transport layer
//      (ERR_CONNECTION_REFUSED) → request_failed.
//   2. A call to an endpoint that was never implemented → http_error, if the dev
//      server 404s it. Vite's SPA fallback answers many unknown paths with
//      index.html and a 200, so this one is best-effort and the fixture does not
//      depend on it.
//
// The component handles both quietly and renders a fallback, so the UI looks fine
// while the feature behind it is dead — which is exactly why a human clicking
// around does not catch this and a runtime observer does.
export default function BadFetch() {
  const [state, setState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    const done = (next) => !cancelled && setState(next);

    // BUG: the API base URL points at a port with nothing behind it. 49999 is in the
    // ephemeral range — nothing listens there, and unlike the low "unsafe" ports
    // Chrome blocks outright, the connection is genuinely attempted and refused.
    fetch("http://127.0.0.1:49999/api/user-settings")
      .then(() => done("ok"))
      .catch(() => done("fallback"));

    // BUG: this endpoint was never implemented.
    fetch("/api/user-settings.json").catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h2>Bad Fetch</h2>
      <p>Calls a dead backend on mount → request_failed. State: {state}</p>
    </section>
  );
}
