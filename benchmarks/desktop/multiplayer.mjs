import { isolate, exerciseFault, requiredVisible } from "./common.mjs";
export const checks = ["connected", "peer-received-name", "peer-received-reaction", "room-visible"];
let peer;

export async function setup(page, { config }) {
  await isolate(page, config);
  const peerContext = await page.context().browser().newContext();
  peer = await peerContext.newPage();
  await isolate(peer, config);
  await peer.goto(config.url);
  await peer.locator('#status[data-state="open"]').waitFor();
  await peer.locator("#network").selectOption("perfect");
}

export default async function flow(page, { cycle, mark, check }) {
  await page.locator('#status[data-state="open"]').waitFor();
  await page.getByLabel("Your display name", { exact: true }).fill(`Lab-${cycle}`);
  await page.getByLabel("Your display name", { exact: true }).blur();
  await page.locator("#network").selectOption("perfect");
  const peerName = peer.locator("#people .person-name").filter({ hasText: new RegExp(`^Lab-${cycle}$`) });
  await peerName.waitFor();
  check("peer-received-name", await peerName.isVisible(), "A second isolated client receives the renamed participant through the real server");
  await page.locator("#stage").hover({ position: { x: 80 + cycle, y: 80 } });
  await page.locator("#reactions button").first().click();
  const peerReaction = peer.locator("#people li").filter({ hasText: `Lab-${cycle}` }).locator(".react-badge");
  await peerReaction.waitFor();
  check("peer-received-reaction", await peerReaction.isVisible(), "A second isolated client receives the reaction through the real server");
  check("connected", await page.locator('#status[data-state="open"]').isVisible(), "Local WebSocket stays connected during the workflow");
  await exerciseFault(page, cycle);
  await requiredVisible(page, check, page.locator("h1").filter({ hasText: /^Live Room$/ }), "room-visible");
  await mark("multiplayer-interactions");
}
