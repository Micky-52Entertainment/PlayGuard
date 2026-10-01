/**
 * The site's own tests: a separate PlayGuard on an empty data folder, driven
 * in a real browser through what a teammate does every day. Nothing here
 * touches the reports, recordings or settings of the lab in use.
 *
 *   npm run test:site
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8700 + Math.floor(Math.random() * 90);
const HUB = `http://127.0.0.1:${PORT}`;

let hub: ChildProcess;
let data: string;
let browser: Browser;
let hubLog = "";

const api = async <T>(pathname: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(HUB + pathname, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: HUB, ...(init.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${pathname}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
};

/** A browser tab as a returning teammate: English, named, tour and setup notes seen. */
const teammate = async (options: { viewport?: { width: number; height: number }; fresh?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 860 } });
  await context.addInitScript((fresh: boolean) => {
    localStorage.setItem("playable-lab.lang", "en");
    if (!fresh) {
      localStorage.setItem("playable-lab.tour-seen", "1");
      localStorage.setItem("playable-lab.name", "Site test");
    }
  }, Boolean(options.fresh));
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    hubLog += `\n[page error] ${error.message}`;
  });
  return { context, page };
};

/** Setup notes about optional downloads are the machine's business, not the test's. */
const dismissSetup = async (page: Page): Promise<void> => {
  const later = page.getByRole("button", { name: /^(Later|Not now|Skip)$/ });
  if (await later.first().isVisible().catch(() => false)) {
    await later.first().click();
  }
};

before(async () => {
  data = await mkdtemp(path.join(os.tmpdir(), "playguard-site-"));
  hub = spawn(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "apps/hub/src/index.ts")], {
    cwd: ROOT,
    env: { ...process.env, HUB_PORT: String(PORT), PLAYGUARD_DATA: data },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hub.stdout?.on("data", (chunk) => (hubLog = `${hubLog}${chunk}`.slice(-8000)));
  hub.stderr?.on("data", (chunk) => (hubLog = `${hubLog}${chunk}`.slice(-8000)));
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${HUB}/api/meta`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // Small and quick: one phone, upright, no stress or language runs.
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      stress: false,
      languages: { on: false },
      oldPhones: false,
      platforms: { android: true, ios: false, tablet: false, foldable: false },
      orientations: { portrait: true, landscape: false },
    }),
  });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  hub?.kill();
  await rm(data, { recursive: true, force: true });
});

describe("PlayGuard site", { timeout: 600000 }, () => {
  test("a first visit opens the tour, and it can be skipped", async () => {
    const { context, page } = await teammate({ fresh: true });
    await page.goto(HUB);
    const tour = page.getByRole("dialog", { name: "Introduction" });
    await tour.waitFor();
    assert.match(await tour.innerText(), /Welcome to PlayGuard/);
    await page.getByRole("button", { name: "Skip" }).click();
    await tour.waitFor({ state: "hidden" });
    // Then the lab asks who is using it, once.
    const name = page.getByRole("dialog", { name: "What is your name?" });
    await name.waitFor();
    await name.getByRole("button", { name: "Later" }).click();
    await name.waitFor({ state: "hidden" });
    await context.close();
  });

  test("step 2 stays locked until the store links match, and can be unlocked on purpose", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Try it on a sample" }).click();
    const gate = page.locator(".gate");
    await gate.waitFor();
    const quick = page.getByRole("button", { name: "Quick check" });
    assert.equal(await quick.isDisabled(), true, "the start buttons are locked while the links are not confirmed");
    await gate.locator("input[type=checkbox]").check();
    assert.equal(await quick.isDisabled(), false, "ticking the box unlocks them");
    await context.close();
  });

  test("a quick check goes from the sample to a verdict and a report", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Try it on a sample" }).click();
    await page.locator(".gate input[type=checkbox]").check();
    // Quick before sending is the default depth; full is one click away.
    assert.equal(await page.locator('.depth-option[aria-checked="true"]').innerText().then((text) => /Quick/.test(text)), true);
    await page.getByRole("button", { name: "Quick check" }).click();
    await page.locator(".hero").waitFor({ timeout: 300000 });
    await page.locator(".depth-upgrade").waitFor();
    assert.match(await page.locator(".hero h1").innerText(), /Ready|Needs a look|Not ready/);
    await page.locator(".result-tile").first().waitFor();
    const reports = await api<Array<{ dir: string; url: string }>>("/api/reports");
    assert.equal(reports.length, 1, "the check wrote one report");
    const frame = page.frameLocator(".report-frame");
    await frame.locator(".glances").waitFor();
    await context.close();
  });

  test("one screen of a report is checked again, and the rest stays", async () => {
    const [report] = await api<Array<{ dir: string }>>("/api/reports");
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    const tile = page.locator(".result-tile").first();
    await tile.waitFor();
    const before = await api<{ runs: Array<{ id: string; shots: unknown[] }> }>(`/reports/${report.dir}/report.json`);
    await tile.hover();
    await tile.locator(".result-again").click();
    await page.locator(".result-tile.retrying").waitFor();
    await page.locator(".result-tile.retrying").waitFor({ state: "detached", timeout: 240000 });
    const state = await api<{ available: boolean; screens: Array<{ state: string }> }>(`/api/reports/${report.dir}/retry`);
    assert.equal(state.screens.length, 0, "no retry is left running or failed");
    const after = await api<{ runs: Array<{ id: string }> }>(`/reports/${report.dir}/report.json`);
    assert.deepEqual(
      after.runs.map((run) => run.id),
      before.runs.map((run) => run.id),
      "the same screens, in the same order"
    );
    await context.close();
  });

  test("the recording relays a touch to each mirror, where it really landed", async () => {
    const session = await api<{ sessionId: string; playUrl: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ playableId: "sample-tap", orientationLock: "portrait" }),
    });
    const desk = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const harness = await desk.newPage();
    await harness.goto(`${HUB}/api/meta`);
    await harness.setContent(
      `<iframe src="${HUB}/view/${session.sessionId}?role=slave" style="width:300px;height:600px"></iframe>` +
        "<script>window.got=[];addEventListener('message',function(e){if(e.data&&e.data.type==='playable:touch')got.push(e.data)})</script>"
    );
    await harness.waitForTimeout(1500);
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await phoneContext.newPage();
    await phone.goto(`${session.playUrl.replace(/^https?:\/\/[^/]+/, HUB)}&pc=1`);
    await phone.waitForTimeout(2500);
    await phone.touchscreen.tap(195, 600);
    await harness.waitForFunction("window.got.length >= 2", undefined, { timeout: 10000 });
    const got = (await harness.evaluate("window.got")) as Array<{ phase: string; x: number; y: number }>;
    assert.deepEqual(got.map((item) => item.phase), ["down", "up"]);
    assert.ok(Math.abs(got[0].x - 0.5) < 0.02 && Math.abs(got[0].y - 600 / 844) < 0.02, "the spot matches the touch");
    await api(`/api/sessions/${session.sessionId}/abort`, { method: "POST", body: "{}" });
    await desk.close();
    await phoneContext.close();
  });

  test("settings keep the chosen languages", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Check the translation").click();
    await page.waitForTimeout(400);
    const saved = await api<{ languages: { on: boolean } }>("/api/settings");
    assert.equal(saved.languages.on, true);
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ languages: { on: false } }) });
    await context.close();
  });

  test("help shows a picture beside every answer", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.locator(".help-section").first().waitFor();
    assert.equal(await page.locator(".help-section").count(), await page.locator(".help-art").count());
    await context.close();
  });

  test("on a phone nothing scrolls sideways", async () => {
    const { context, page } = await teammate({ viewport: { width: 375, height: 812 } });
    await page.goto(HUB);
    await dismissSetup(page);
    assert.equal(await page.getByRole("button", { name: "Recordings", exact: true }).count(), 0, "the Recordings tab is turned off");
    for (const view of ["Check", "Builds", "Reports", "Help", "Settings"]) {
      const tab = page.getByRole("button", { name: view, exact: true });
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(300);
      }
      const wide = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth");
      assert.ok((wide as number) <= 1, `${view} is ${wide}px wider than the phone`);
    }
    await context.close();
  });

  test("a result can be presented full screen, and Esc leaves", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.getByRole("button", { name: /Present/ }).click();
    const slides = page.locator(".present");
    await slides.waitFor();
    await page.locator(".present-title h1").waitFor();
    await page.keyboard.press("ArrowRight");
    await page.locator(".present-grid").waitFor();
    await page.keyboard.press("Escape");
    await slides.waitFor({ state: "detached" });
    await context.close();
  });

  test("Micky answers from Help, explains a result, and can be hidden", async () => {
    const { context, page } = await teammate();
    await page.goto(HUB);
    await dismissSetup(page);
    const mascot = page.locator(".mascot");
    await mascot.waitFor();
    await mascot.locator(".mascot-body").click();
    const panel = mascot.locator(".mascot-panel");
    await panel.waitFor();
    await panel.getByRole("textbox").fill("how do I clear the history");
    await panel.getByRole("button", { name: "Ask" }).click();
    await panel.locator(".mascot-answer p").waitFor();
    assert.ok((await panel.locator(".mascot-answer p").innerText()).length > 20, "an answer from Help");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    // On a report Micky has the result's main point ready.
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.waitForTimeout(800);
    await mascot.locator(".mascot-body").click();
    await mascot.locator(".mascot-explain").waitFor();
    await page.keyboard.press("Escape");
    await mascot.hover();
    await mascot.locator(".mascot-hide").click();
    await mascot.waitFor({ state: "detached" });
    await context.close();
  });

  test("the first check lights up the button to press", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.addInitScript(() => {
      localStorage.setItem("playable-lab.lang", "en");
      localStorage.setItem("playable-lab.tour-seen", "1");
      localStorage.setItem("playable-lab.name", "New teammate");
    });
    const page = await context.newPage();
    await page.goto(HUB);
    await dismissSetup(page);
    await page.locator('[data-guide="upload"].guide-glow').waitFor({ timeout: 5000 });
    await context.close();
  });

  test("the report page speaks the reader's language", async () => {
    const [report] = await api<Array<{ dir: string }>>("/api/reports");
    const html = await (await fetch(`${HUB}/reports/${report.dir}/index.html`)).text();
    assert.match(html, /<html lang="(en|ru|fr)">/);
    assert.match(html, /class="glances"/, "the screens at a glance come first");
  });
});

process.on("exit", (code) => {
  if (code !== 0 && hubLog) {
    console.error(`\n--- hub output ---\n${hubLog}`);
  }
});
