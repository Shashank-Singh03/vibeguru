import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Clean from "./pages/Clean.jsx";
import Detached from "./pages/Detached.jsx";
import Grow from "./pages/Grow.jsx";
import Listeners from "./pages/Listeners.jsx";
import Charts from "./pages/Charts.jsx";

// The nav renders real <a href> elements (react-router <Link>), which is exactly what
// Vibecheck's auto-crawler discovers and clicks client-side.
export default function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Vibecheck Test App</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <Link to="/">Home</Link>
        <Link to="/clean">Clean</Link>
        <Link to="/detached">Detached</Link>
        <Link to="/grow">Grow</Link>
        <Link to="/listeners">Listeners</Link>
        <Link to="/charts">Charts</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/clean" element={<Clean />} />
        <Route path="/detached" element={<Detached />} />
        <Route path="/grow" element={<Grow />} />
        <Route path="/listeners" element={<Listeners />} />
        <Route path="/charts" element={<Charts />} />
      </Routes>
    </div>
  );
}
