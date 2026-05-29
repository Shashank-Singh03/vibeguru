// Example recorded flow for the Vibe Guru test app.
// Exercises the /charts route specifically and labels the retained-state sample so
// the leak is attributed to "charts-flow". Run with:
//   vibeguru memory:client http://localhost:5173 --flow test-app/flows/charts.flow.js
export default async function flow(page, { mark }) {
  await page.getByRole("link", { name: "Charts" }).click();
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForTimeout(200);
  await mark("charts-flow");
}
