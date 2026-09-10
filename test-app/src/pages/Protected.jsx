import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// FIXTURE: the auth wall. Without a session this bounces to /login, which is what
// makes a crawler report the route as unreachable rather than healthy — and what a
// saved session is supposed to get past.
//
// It also leaks, deliberately: a listener added on mount and never removed. That
// leak is invisible to any run that cannot get in, which is the whole point of
// measuring coverage and of `vibeguru auth`.
export default function Protected() {
  const navigate = useNavigate();
  const authed = typeof localStorage !== "undefined" && localStorage.getItem("vg_session") === "ok";

  useEffect(() => {
    if (!authed) {
      navigate("/login", { replace: true });
      return;
    }

    // BUG: three listeners added on mount, none removed. Three rather than one so
    // the leak clears the analyzer's per-visit floor — a fixture that sits under the
    // threshold proves nothing except that the threshold works.
    const noop = () => {};
    window.addEventListener("scroll", noop);
    window.addEventListener("resize", noop);
    document.addEventListener("visibilitychange", noop);
  }, [authed, navigate]);

  if (!authed) return null;

  return (
    <section>
      <h2>Protected</h2>
      <p>Only visible with a session. Leaks a scroll listener on every visit.</p>
    </section>
  );
}
