import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

// NOTE: intentionally NOT wrapped in <React.StrictMode>. StrictMode double-invokes
// effects in dev, which would make leak/listener counts non-deterministic for the
// measurement harness. We want each route mount to leak exactly once.
ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
