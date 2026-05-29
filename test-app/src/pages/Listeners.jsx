import { useEffect } from "react";

// LEAK: window event listeners that are never removed.
// Each mount registers resize + scroll handlers (whose closures retain a chunk of
// state) and returns NO cleanup. Memory.getDOMCounters.jsEventListeners climbs
// monotonically across cycles → signature: listener_leak.
export default function Listeners() {
  useEffect(() => {
    const captured = new Array(1000).fill("retained-by-closure");
    const onResize = () => void captured.length;
    const onScroll = () => void captured.length;
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll);
    // BUG: no return () => { removeEventListener(...) }
  }, []);

  return (
    <section>
      <h2>Listeners</h2>
      <p>Adds resize + scroll listeners on every visit and never removes them.</p>
    </section>
  );
}
