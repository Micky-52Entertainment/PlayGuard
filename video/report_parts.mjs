// Captures the verdict block and the store-link problem from a saved report, at 2x.
import { chromium } from "playwright";
import path from "node:path";
const [dir] = process.argv.slice(2);
const out = path.resolve("video/build/capture");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await p.goto("file://" + path.resolve(dir, "index.html"));
await p.waitForTimeout(2000);
for (const [text, name] of [["Not ready: 1 problem to fix", "07_verdict"], ["another app: 1504361627", "08_problem"]]) {
  const el = p.getByText(text, { exact: false }).first();
  await el.scrollIntoViewIfNeeded();
  // the block around the text: its nearest section-like ancestor
  const box = await el.evaluate((n) => {
    let e = n; for (let i = 0; i < 4 && e.parentElement && e.getBoundingClientRect().width < 900; i++) e = e.parentElement;
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const pad = 40;
  await p.screenshot({ path: `${out}/${name}.png`, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1920, box.w + pad * 2), height: Math.min(1000, box.h + pad * 2) } });
  console.log(name, JSON.stringify(box));
}
await b.close();
