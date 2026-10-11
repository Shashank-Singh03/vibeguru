"use strict";

// This static preview has no backend. Generate a local brief, never a fake submission.
const form = document.getElementById("enquiry-form");
const status = document.getElementById("form-status");
let lastDownloadUrl = null;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  for (const name of ["name", "email", "journeys"]) {
    const field = form.elements.namedItem(name);
    field.setCustomValidity(field.value.trim() ? "" : "Please fill in this field.");
  }
  if (!form.reportValidity()) return;

  const fields = new FormData(form);
  const value = (name) => String(fields.get(name) || "").trim();
  const brief = [
    "VIBE GURU — FOUNDING PILOT ENQUIRY BRIEF",
    "",
    "This file was created locally. No enquiry has been submitted or sent.",
    "Share it with the founder through your agreed contact channel.",
    "",
    `Name: ${value("name")}`,
    `Email: ${value("email")}`,
    `Agency or team: ${value("company") || "Not provided"}`,
    `App or staging URL: ${value("app_url") || "Not provided"}`,
    `Target timing: ${value("timeline") || "To agree"}`,
    "",
    "Two proposed journeys and main concern:",
    value("journeys"),
    "",
    "PROPOSED PILOT SCOPE — SUBJECT TO FIT AND AGREEMENT",
    "$300 USD founding-pilot price experiment, per project.",
    "One React web application, up to 10 agreed routes, two agreed journeys.",
    "Up to six hours of delivery effort, including one confirmation rerun.",
    "Human-reviewed runtime/retention findings and coverage report.",
    "Journey assertions are agreed explicitly and checked separately.",
    "Fix implementation or additional investigation requires separate scope.",
    "Scheduling, app access, safe test accounts and scope are agreed before payment.",
    "",
    "No security audit, backend load test, full product certification,",
    "accessibility audit, full cross-browser test, or continuous monitoring.",
    "",
    "Do not include passwords, cookies, session tokens, or private customer data",
    "in this enquiry. Agree a safe access process separately.",
    "",
  ].join("\n");

  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = URL.createObjectURL(new Blob([brief], { type: "text/plain;charset=utf-8" }));
  const download = document.createElement("a");
  download.href = lastDownloadUrl;
  download.download = "vibe-guru-enquiry.txt";
  download.textContent = "Download it again";

  status.replaceChildren(
    document.createTextNode("Your brief is ready. Nothing has been sent. Share the downloaded file through your existing contact channel. "),
    download
  );
  download.click();
});

form.addEventListener("input", (event) => {
  if (typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
});

window.addEventListener("pagehide", () => {
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
});
