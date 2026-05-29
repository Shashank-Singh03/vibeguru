// Control flow: exercises only the /clean route (which cleans up correctly).
// Expected result: ZERO findings — proves Vibecheck does not false-positive.
export default async function flow(page, { mark }) {
  await page.getByRole("link", { name: "Clean" }).click();
  await page.waitForTimeout(200);
  await page.goBack();
  await page.waitForTimeout(200);
  await mark("clean-flow");
}
