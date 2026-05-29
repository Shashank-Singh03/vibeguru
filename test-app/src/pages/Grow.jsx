import { useEffect } from "react";

// LEAK: JS heap retained by a module-global that grows on every mount.
// ~1MB pushed per visit, never released → heapUsed climbs across cycles and does not
// recover after GC → signature: route_heap_growth.
const retained = [];

export default function Grow() {
  useEffect(() => {
    // ~1MB of strings.
    const big = new Array(50000).fill("x".repeat(20));
    retained.push(big); // BUG: never released
  }, []);

  return (
    <section>
      <h2>Grow</h2>
      <p>Pushes ~1MB into a module-global array on every visit and never frees it.</p>
    </section>
  );
}
