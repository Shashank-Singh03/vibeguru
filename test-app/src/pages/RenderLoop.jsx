import { useEffect, useState } from "react";

// FIXTURE: a runaway re-render — the single most common defect in AI-written React.
//
// The effect has NO dependency array, so it runs after every render; it then sets
// state, which triggers another render, which runs the effect again. React never
// settles. The visible symptom is DOM mutations that never stop, which is exactly
// what the mutation-rate detector measures → render_loop.
//
// It is self-limiting in one important way: the loop only runs while this component
// is mounted, so unmounting (which the crawler does every cycle) returns the app to
// normal and leaves no retained memory behind.
export default function RenderLoop() {
  const [renders, setRenders] = useState(0);

  useEffect(() => {
    // BUG: missing dependency array — runs on every render, sets state every time.
    setRenders((n) => n + 1);
  });

  return (
    <section>
      <h2>Render Loop</h2>
      <p>Re-renders continuously while mounted. renders: {renders}</p>
    </section>
  );
}
