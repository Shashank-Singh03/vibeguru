import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

// LEAK: a Chart.js instance created on mount but never destroyed on unmount.
// Chart.js attaches its own window resize listener and retains the (now detached)
// canvas plus its dataset. Manifests as growing heap + listeners; with heap-snapshot
// analysis (Task #5) it also shows as retained detached canvas → canvas_webgl_leak.
export default function Charts() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: Array.from({ length: 200 }, (_, i) => i),
        datasets: [
          {
            label: "data",
            data: Array.from({ length: 200 }, () => Math.random() * 100),
          },
        ],
      },
      options: { responsive: true, animation: false },
    });
    // BUG: missing `return () => chart.destroy()`
    void chart;
  }, []);

  return (
    <section>
      <h2>Charts</h2>
      <p>Creates a Chart.js chart on every visit and never calls chart.destroy().</p>
      <div style={{ maxWidth: 600 }}>
        <canvas ref={canvasRef} />
      </div>
    </section>
  );
}
