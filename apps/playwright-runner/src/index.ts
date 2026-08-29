import { readFile } from "node:fs/promises";
import path from "node:path";
import { devicesById } from "@playable-lab/device-catalog";
import { mapToTarget, viewportForDevice } from "@playable-lab/input-mapper";
import type { SessionTrace } from "@playable-lab/protocol";
import { chromium } from "playwright";

const arg = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1];
};

const replay = async (): Promise<void> => {
  const tracePath = arg("--trace");
  if (!tracePath) {
    throw new Error("Usage: npm run replay -- --trace ../../traces/<session>.json");
  }
  const trace = JSON.parse(await readFile(path.resolve(tracePath), "utf8")) as SessionTrace;
  if (trace.abort) {
    throw new Error(`Trace aborted (${trace.abort.code}): ${trace.abort.reason}`);
  }

  const catalog = devicesById();
  const deviceIds = (arg("--devices") || "").split(",").filter(Boolean);
  const targets = deviceIds.length
    ? deviceIds
    : ["pixel-7", "iphone-14", "ipad-pro-11"];

  const browser = await chromium.launch({ headless: arg("--headed") !== "1" });
  const playableUrl = arg("--url") || `http://127.0.0.1:8787${trace.playable.url}`;

  for (let i = 0; i < targets.length; i += 1) {
    const device = catalog.get(targets[i]);
    if (!device) {
      console.warn(`Skip unknown device ${targets[i]}`);
      continue;
    }
    const viewport = viewportForDevice(device, trace.orientationLock);
    const context = await browser.newContext({
      viewport: { width: viewport.cssWidth, height: viewport.cssHeight },
      deviceScaleFactor: device.dpr,
      hasTouch: true,
      isMobile: device.group !== "tablet",
      userAgent:
        device.os === "ios"
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
          : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile",
    });
    const page = await context.newPage();
    await page.goto(playableUrl, { waitUntil: "domcontentloaded" });
    let lastT = 0;
    let mouseDown = false;
    for (let e = 0; e < trace.events.length; e += 1) {
      const event = trace.events[e];
      const wait = Math.max(0, event.t - lastT);
      if (wait) {
        await page.waitForTimeout(Math.min(wait, 2000));
      }
      lastT = event.t;
      const inputType = event.type || "pointer";
      if (inputType === "gesture") {
        continue;
      }
      if (inputType === "wheel" || event.phase === "wheel") {
        await page.mouse.wheel(event.deltaX || 0, event.deltaY || 0);
        continue;
      }
      if (inputType === "key") {
        const key = event.key || event.code || "";
        if (!key) {
          continue;
        }
        if (event.phase === "up") {
          await page.keyboard.up(key);
        } else if (!event.repeat) {
          await page.keyboard.down(key);
        }
        continue;
      }
      if (event.isPrimary === false) {
        continue;
      }
      const point = mapToTarget(event.nx, event.ny, viewport);
      await page.mouse.move(point.x, point.y);
      if (event.phase === "down" && !mouseDown) {
        await page.mouse.down();
        mouseDown = true;
      } else if ((event.phase === "up" || event.phase === "cancel") && mouseDown) {
        await page.mouse.up();
        mouseDown = false;
      }
    }
    await page.screenshot({
      path: path.resolve(`traces/${trace.sessionId}-${device.id}.png`),
    });
    await context.close();
  }
  await browser.close();
};

void replay();
