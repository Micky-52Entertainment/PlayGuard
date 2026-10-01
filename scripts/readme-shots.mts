/**
 * Screenshots for the README, taken from a PlayGuard on an empty data folder
 * with the demo playable in samples/demo.
 *
 *   PLAYGUARD_DATA=/tmp/empty HUB_PORT=8797 npm run hub   # in another terminal
 *   npx tsx scripts/readme-shots.mts http://localhost:8797
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HUB = process.argv[2] || "http://localhost:8797";
const OUT = path.join(ROOT, "docs/images");
const DEMO = path.join(ROOT, "samples/demo");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
  localStorage.setItem("playable-lab.lang", "en");
  localStorage.setItem("playable-lab.tour-seen", "1");
  localStorage.setItem("playable-lab.name", "Demo");
});
const page = await context.newPage();
const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const later = async () => {
  const button = page.getByRole("button", { name: /^(Later|Not now|Skip)$/ });
  if (await button.first().isVisible().catch(() => false)) {
    await button.first().click();
  }
};

await page.goto(HUB);
await page.waitForTimeout(1000);
await later();
await shot("1-upload");

const pick = async (button: string, file: string) => {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: button, exact: true }).first().click()]);
  await chooser.setFiles(file);
};

await pick("Choose files", path.join(DEMO, "builds/applovin/index.html"));
await page.getByPlaceholder(/play\.google\.com/).fill("com.example.demo");
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, "2-playthrough.png"), fullPage: true });

await page.getByRole("button", { name: "Quick check", exact: true }).click();
await page.locator(".hero").waitFor({ timeout: 300000 });
await page.frameLocator(".report-frame").locator(".glances").waitFor();
await page.waitForTimeout(1500);
await shot("3-result");

await page.getByRole("button", { name: "Builds", exact: true }).click();
await page.waitForTimeout(800);
await later();
await pick("Upload files", path.join(DEMO, "demo-builds.zip"));
await page.waitForTimeout(3000);
await page.locator("table").first().waitFor({ timeout: 300000 });
for (let i = 0; i < 150; i += 1) {
  const batches = (await fetch(`${HUB}/api/batches`).then((r) => r.json())) as Array<{ builds: Array<{ verdict: string | null }> }>;
  const builds = batches[0]?.builds || [];
  if (builds.length > 0 && builds.every((build) => Boolean(build.verdict))) {
    break;
  }
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(1500);
await shot("4-builds");

await browser.close();
