// Captures a saved PlayGuard report (static HTML) at 2x: node video/report_shot.mjs <report dir> <name>
import { chromium } from "playwright";
import path from "node:path";
const [dir, name] = process.argv.slice(2);
const out = path.resolve("video/build/capture");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await p.goto("file://" + path.resolve(dir, "index.html"));
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/${name}.png`, timeout: 60000 });
await p.screenshot({ path: `${out}/${name}_full.png`, fullPage: true, timeout: 60000 });
await b.close();
