import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Clean from "./pages/Clean.jsx";
import Detached from "./pages/Detached.jsx";
import Grow from "./pages/Grow.jsx";
import Listeners from "./pages/Listeners.jsx";
import Charts from "./pages/Charts.jsx";
import Crash from "./pages/Crash.jsx";
import LogError from "./pages/LogError.jsx";
import BadFetch from "./pages/BadFetch.jsx";
import RenderLoop from "./pages/RenderLoop.jsx";

// The nav renders real <a href> elements (react-router <Link>), which is exactly what
// Vibe Guru's auto-crawler discovers and clicks client-side.
//
// Routes fall into two groups: the memory fixtures (/detached, /grow, /listeners,
// /charts) each isolate one retention signature, and the runtime fixtures (/crash,
// /log-error, /bad-fetch, /render-loop) each isolate one runtime signature. /clean is
// the control for both — it must never produce a finding of any kind.
export default function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Vibe Guru Test App</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <Link to="/">Home</Link>
        <Link to="/clean">Clean</Link>
        <Link to="/detached">Detached</Link>
        <Link to="/grow">Grow</Link>
        <Link to="/listeners">Listeners</Link>
        <Link to="/charts">Charts</Link>
        <Link to="/crash">Crash</Link>
        <Link to="/log-error">Log Error</Link>
        <Link to="/bad-fetch">Bad Fetch</Link>
        <Link to="/render-loop">Render Loop</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/clean" element={<Clean />} />
        <Route path="/detached" element={<Detached />} />
        <Route path="/grow" element={<Grow />} />
        <Route path="/listeners" element={<Listeners />} />
        <Route path="/charts" element={<Charts />} />
        <Route path="/crash" element={<Crash />} />
        <Route path="/log-error" element={<LogError />} />
        <Route path="/bad-fetch" element={<BadFetch />} />
        <Route path="/render-loop" element={<RenderLoop />} />
      </Routes>
    </div>
  );
}
