import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

// Independent clean control: all resources are cleaned up on unmount.
function Clean() {
  useEffect(() => {
    const resize = () => {};
    window.addEventListener("resize", resize);
    const timer = setInterval(() => {}, 1000);
    return () => { window.removeEventListener("resize", resize); clearInterval(timer); };
  }, []);
  return <h2>Clean (control)</h2>;
}
function App() {
  return <BrowserRouter><nav><Link to="/">Home</Link> <Link to="/clean">Clean</Link></nav>
    <Routes><Route path="/" element={<h2>Home</h2>} /><Route path="/clean" element={<Clean />} /></Routes>
  </BrowserRouter>;
}
createRoot(document.getElementById("root")).render(<App />);
