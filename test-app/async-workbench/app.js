// Deliberately vulnerable and corrected source paths in an isolated benchmark.
const fixed = new URLSearchParams(location.search).get("mode") === "fixed";
let generation = 0;
const status = document.querySelector("#view-status");
const heading = document.querySelector("#heading");
document.querySelector("#home").onclick = () => {
  generation++; heading.textContent = "Home"; status.textContent = "Home ready";
};
document.querySelector("#detail").onclick = async () => {
  const owner = ++generation;
  heading.textContent = "Details"; status.textContent = "Loading details";
  const response = await fetch("/api/detail"); const data = await response.json();
  if (!fixed || generation === owner) status.textContent = `Details: ${data.value}`;
};
const button = document.querySelector("#recover");
const recovery = document.querySelector("#recovery-status");
button.onclick = async () => {
  button.disabled = true; recovery.textContent = "Loading";
  try {
    const response = await fetch("/api/recover");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    recovery.textContent = `Ready: ${data.value}`; button.disabled = false;
  } catch {
    // Broken mode traps the user in loading, although the failure was caught.
    if (fixed) { recovery.textContent = "Temporary failure; retry available"; button.disabled = false; }
  }
};
