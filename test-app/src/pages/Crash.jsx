import { useEffect } from "react";

// FIXTURE: an uncaught exception, the white-screen class of failure.
//
// The throw is deliberately deferred into a timer rather than raised during render
// or directly in the effect body. A synchronous throw would unwind React and unmount
// the whole tree, which would break every later route in the run; a deferred throw
// still reaches window.onerror as a genuine uncaught exception — which is what the
// observer listens for — while leaving the app navigable.
export default function Crash() {
  useEffect(() => {
    const id = setTimeout(() => {
      const config = undefined;
      // BUG: reads a property off a value that was never assigned.
      console.log(config.apiKey);
    }, 50);

    return () => clearTimeout(id);
  }, []);

  return (
    <section>
      <h2>Crash</h2>
      <p>Throws an uncaught TypeError shortly after mount → uncaught_exception.</p>
    </section>
  );
}
