import { useEffect, useState } from "react";

// CONTROL — does everything correctly. Adds a listener and a timer, both cleaned up
// on unmount. No module-global accumulation. Vibecheck must NOT flag this route.
export default function Clean() {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const onResize = () => {};
    window.addEventListener("resize", onResize);
    const id = setInterval(() => setTicks((t) => t + 1), 1000);

    return () => {
      window.removeEventListener("resize", onResize); // proper cleanup
      clearInterval(id); // proper cleanup
    };
  }, []);

  return (
    <section>
      <h2>Clean (control)</h2>
      <p>Listener and interval are both removed on unmount. ticks: {ticks}</p>
    </section>
  );
}
