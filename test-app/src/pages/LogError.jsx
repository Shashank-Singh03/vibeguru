import { useEffect } from "react";

// FIXTURE: an error the app logs and swallows.
//
// The page keeps rendering, so nothing looks wrong to a human clicking around — but
// the app itself is reporting a defect. This is the class of problem that a screenshot
// test passes and a runtime observer catches → console_error.
export default function LogError() {
  useEffect(() => {
    console.error("Failed to parse user preferences, falling back to defaults");
  }, []);

  return (
    <section>
      <h2>Log Error</h2>
      <p>Logs console.error on mount → console_error.</p>
    </section>
  );
}
