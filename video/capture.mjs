// Walks through PlayGuard in English and captures stills (2x) and a video of the console
// while the playable is played in the game window. node video/capture.mjs <zip>
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";

const zip = process.argv[2];
const out = path.resolve("video/build/capture");
mkdirSync(out, { recursive: true });
import { writeFileSync } from "node:fs";
// Straight from the browser: Playwright's own screenshot waits for fonts, which never
// settle while 17 playables keep drawing.
const shot = async (page, name, opts = {}) => {
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!opts.fullPage });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
  await cdp.detach();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const marks = [];
const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log(name, marks.at(-1).t); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  recordVideo: { dir: `${out}/video`, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript(() => localStorage.setItem("playable-lab.lang", "en"));
const page = await ctx.newPage();
await page.goto("http://localhost:8787/");
await page.waitForLoadState("networkidle");
await wait(1500);
await shot(page, "00_welcome");
const skip = page.getByRole("button", { name: "Skip", exact: true });
if (await skip.isVisible()) await skip.click();
await wait(800);
mark("home");
await shot(page, "01_home");

// The drop zone takes the file the way a user drags it in.
await page.evaluate(async (url) => {
  const b = await fetch(url).then((r) => r.blob());
  const dt = new DataTransfer();
  dt.items.add(new File([b], url.split("/").pop(), { type: "application/zip" }));
  const z = document.querySelector(".dropzone");
  for (const t of ["dragenter", "dragover", "drop"]) z.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
}, `http://127.0.0.1:9911/${path.basename(zip)}`);
await page.getByRole("button", { name: "Open the game window" }).waitFor({ timeout: 90000 });
await wait(1000);
const name = page.getByPlaceholder("Name");
if (await name.isVisible()) { await name.fill("Micky"); await page.getByRole("button", { name: "Save", exact: true }).click(); }
await wait(1500);
mark("choice");
await shot(page, "02_choice");
await shot(page, "02_choice_full", { fullPage: true });

await page.getByText("Skip the link check", { exact: false }).click();
await wait(500);
// The game in its own window, played by touch: pointer events for PlayGuard's recorder,
// touch events for the game itself, as a real finger sends both.
async function playIn(game, shots, start) {
  await game.evaluate(async ({ shots, start }) => {
    const ifr = document.querySelector("iframe");
    const win = ifr.contentWindow, c = ifr.contentDocument.getElementById("application-canvas");
    const r = ifr.getBoundingClientRect();
    const sl = (ms) => new Promise((s) => setTimeout(s, ms));
    const ev = (ph, x, y) => {
      const cx = x - r.left, cy = y - r.top;
      c.dispatchEvent(new win.PointerEvent({ down: "pointerdown", move: "pointermove", up: "pointerup" }[ph],
        { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: "touch", isPrimary: true, buttons: ph === "up" ? 0 : 1 }));
      const t = new win.Touch({ identifier: 1, target: c, clientX: cx, clientY: cy, pageX: cx, pageY: cy });
      const list = ph === "up" ? [] : [t];
      c.dispatchEvent(new win.TouchEvent({ down: "touchstart", move: "touchmove", up: "touchend" }[ph],
        { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: [t] }));
    };
    for (const [x, y] of shots) {
      ev("down", start[0], start[1]); await sl(60);
      for (let i = 1; i <= 15; i++) { ev("move", start[0] + (x - start[0]) * i / 15, start[1] + (y - start[1]) * i / 15); await sl(30); }
      await sl(200); ev("up", x, y); await sl(2900);
    }
  }, { shots, start });
}


const SHOTS = [[237, 545], [120, 545], [180, 480], [330, 530], [272, 545], [85, 560], [288, 545]];

// The game runs in a browser of its own: a popup in the same window would sit in the
// background and the game would stop drawing.
const gameBrowser = await chromium.launch();
async function playStep(name, size, map) {
  let text = "";
  for (let i = 0; i < 60 && !text.includes(`orientation=${name}`); i++) {
    text = await page.evaluate(() => document.body.innerText);
    await wait(1000);
  }
  const link = text.match(new RegExp(`http://\\S+/play/\\S+orientation=${name}\\S*`))[0]
    .replace(/^http:\/\/[^/]+/, "http://localhost:8787");
  const gctx = await gameBrowser.newContext({ viewport: size, hasTouch: true });
  const game = await gctx.newPage();
  await game.goto(link);
  await wait(1500);
  const start = game.locator("button").first();
  if (await start.count()) await start.click();
  await wait(8500);
  await game.screenshot({ path: `${out}/debug_${name}.png`, timeout: 15000 }).catch(() => {});
  console.log("buttons", await game.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText).join("|")), "iframes", await game.locator("iframe").count());
  mark(`${name}_play`);
  const half = SHOTS.length >> 1;
  await playIn(game, SHOTS.slice(0, half).map(map), map([206, 760]));
  await shot(page, `04_${name}_mid`);
  await playIn(game, SHOTS.slice(half).map(map), map([206, 760]));
  mark(`${name}_done`);
  await shot(page, `04_${name}_end`);
  await page.getByRole("button", { name: "Save the recording" }).click({ timeout: 120000 });
  await wait(3000);
  await gctx.close();
}

await page.getByRole("button", { name: "Open the game window" }).click();
await wait(2500);
for (const p of ctx.pages()) if (p !== page) await p.close();
await playStep("portrait", { width: 412, height: 915 }, (p) => p);
// Landscape: the board is smaller and centred; scale the aim around the shooter.
const k = 0.39, sp = [206, 825], sl = [457, 372];
await playStep("landscape", { width: 915, height: 412 }, ([x, y]) => [sl[0] + (x - sp[0]) * k, sl[1] + (y - sp[1]) * k]);
mark("checks");
await shot(page, "05_checks");
await wait(4000);
await shot(page, "05_checks_b");

const video = page.video();
await ctx.close();
renameSync(await video.path(), `${out}/console.webm`);
await browser.close();
await gameBrowser.close();
console.log(JSON.stringify(marks));
