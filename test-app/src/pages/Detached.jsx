import { useEffect } from "react";

// LEAK: detached DOM nodes retained by a module-global.
// Each mount creates thousands of DOM nodes, never attaches them to the document,
// and pushes them into a global array that is never cleared. They stay "alive" in
// the renderer (so Memory.getDOMCounters.nodes climbs) and survive GC (so the
// recovery ratio stays low) → signature: detached_dom_leak.
const detachedStore = [];

export default function Detached() {
  useEffect(() => {
    const batch = [];
    for (let i = 0; i < 3000; i++) {
      const el = document.createElement("div");
      el.textContent = "leak-" + i;
      const child = document.createElement("span");
      el.appendChild(child);
      batch.push(el);
    }
    detachedStore.push(batch); // BUG: never released
  }, []);

  return (
    <section>
      <h2>Detached</h2>
      <p>Creates 3000 detached nodes per visit and retains them in a global.</p>
    </section>
  );
}
