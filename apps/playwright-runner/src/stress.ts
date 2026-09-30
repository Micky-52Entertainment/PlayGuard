import { BLANK_DOMINANT_RATIO } from "@playable-lab/checks";
import type { CheckResult, RuntimeEvidence } from "@playable-lab/checks";
import type { CDPSession, Page } from "playwright";
import { analyse } from "./frames.ts";

/**
 * Runs that do not replay a recording but put the playable under a condition
 * a player meets: a player who does nothing, one who taps everywhere, a
 * phone turned on its side.
 */
export type Scenario = "idle" | "monkey" | "rotate";

export const SCENARIOS: Scenario[] = ["idle", "monkey", "rotate"];

export const SCENARIO_TITLE: Record<Scenario, string> = {
  idle: "Left without a touch",
  monkey: "Random taps",
  rotate: "Turned during play",
};

const CHECK_ID: Record<Scenario, string> = {
  idle: "idle",
  monkey: "monkey",
  rotate: "rotate",
};

const MONKEY_INPUTS = 40;

interface Layout {
  vw: number;
  vh: number;
  scrollW: number;
  scrollH: number;
  canvas: { x: number; y: number; w: number; h: number } | null;
}

interface Turn {
  /** "on its side" or "turned back". */
  step: string;
  blank: boolean;
  /** Share of the main picture that is off screen, 0..1. */
  cut: number;
  /** Share of the screen the main picture covers, 0..1. */
  covered: number;
}

export interface StressResult {
  scenario: Scenario;
  /** The page stopped answering: its main thread is stuck. */
  hung: boolean;
  /** Uncaught exceptions that were already there when the scenario began. */
  errorsBefore: number;
  idleMs?: number;
  /** JavaScript memory of the page, in bytes: after loading, and after the idle wait. Both after a clean-up. */
  heapStart?: number;
  heapEnd?: number;
  inputs?: number;
  seed?: number;
  turns?: Turn[];
}

export interface StressEnv {
  scenario: Scenario;
  page: Page;
  /** Chromium's own protocol: touches and the processor throttle. */
  cdp: CDPSession;
  helper: Page;
  width: number;
  height: number;
  capture: (label: string) => Promise<Buffer | undefined>;
  seed: number;
  idleMs: number;
  errorCount: () => number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

/** False when the page does not answer within five seconds. */
const alive = async (page: Page): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 5000);
  });
  const answered = page.evaluate("1").then(
    () => true,
    () => false
  );
  const result = await Promise.race([answered, late]);
  clearTimeout(timer);
  return result;
};

/** Memory the page's scripts hold, after asking the engine to free what it can. */
const heapUsed = async (cdp: CDPSession): Promise<number | undefined> => {
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  } catch {
    return undefined;
  }
};

const LAYOUT_SOURCE = `
(function () {
  var canvas = window.__auditMainCanvas;
  if (!canvas || !canvas.isConnected) {
    var list = document.querySelectorAll("canvas");
    var best = 0;
    canvas = null;
    for (var i = 0; i < list.length; i += 1) {
      var box = list[i].getBoundingClientRect();
      if (box.width * box.height > best) { best = box.width * box.height; canvas = list[i]; }
    }
  }
  var root = document.documentElement;
  var out = { vw: window.innerWidth, vh: window.innerHeight, scrollW: root.scrollWidth, scrollH: root.scrollHeight, canvas: null };
  if (canvas) {
    var r = canvas.getBoundingClientRect();
    out.canvas = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return out;
})()
`;

const judgeLayout = (layout: Layout): { cut: number; covered: number } => {
  const screen = layout.vw * layout.vh || 1;
  if (!layout.canvas || layout.canvas.w * layout.canvas.h === 0) {
    // A playable built from page elements: it is cut when the page is wider or taller than the screen.
    const over =
      Math.max(0, layout.scrollW - layout.vw) / (layout.scrollW || 1) +
      Math.max(0, layout.scrollH - layout.vh) / (layout.scrollH || 1);
    return { cut: Math.min(1, over), covered: 1 };
  }
  const c = layout.canvas;
  const w = Math.max(0, Math.min(c.x + c.w, layout.vw) - Math.max(c.x, 0));
  const h = Math.max(0, Math.min(c.y + c.h, layout.vh) - Math.max(c.y, 0));
  const visible = w * h;
  return { cut: 1 - visible / (c.w * c.h), covered: visible / screen };
};

const random = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export const runScenario = async (env: StressEnv): Promise<StressResult> => {
  const { page, cdp } = env;
  const result: StressResult = { scenario: env.scenario, hung: false, errorsBefore: env.errorCount() };
  const isBlank = async (png: Buffer | undefined): Promise<boolean> =>
    png ? (await analyse(env.helper, png)).dominant >= BLANK_DOMINANT_RATIO : false;

  if (env.scenario === "idle") {
    result.idleMs = env.idleMs;
    // Let the first screen settle before the baseline, or loading itself reads as growth.
    await sleep(2000);
    result.heapStart = await heapUsed(cdp);
    const until = Date.now() + env.idleMs;
    while (Date.now() < until && !result.hung) {
      await sleep(Math.min(5000, until - Date.now()));
      result.hung = !(await alive(page));
    }
    if (!result.hung) {
      result.heapEnd = await heapUsed(cdp);
    }
    await env.capture(`after ${Math.round(env.idleMs / 1000)} s without a touch`);
    return result;
  }

  if (env.scenario === "monkey") {
    const next = random(env.seed);
    result.seed = env.seed >>> 0 || 1;
    result.inputs = 0;
    const point = (): { x: number; y: number } => ({
      x: Math.round((0.06 + next() * 0.88) * env.width),
      y: Math.round((0.06 + next() * 0.88) * env.height),
    });
    const touch = (type: string, at?: { x: number; y: number }): Promise<unknown> =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: at ? [{ x: at.x, y: at.y, id: 1, force: 0.5, radiusX: 8, radiusY: 8 }] : [],
      });
    await sleep(1000);
    for (let i = 0; i < MONKEY_INPUTS && !result.hung; i += 1) {
      const from = point();
      try {
        await touch("touchStart", from);
        if (next() < 0.2) {
          // A short swipe, as a careless thumb makes.
          const to = point();
          for (let step = 1; step <= 4; step += 1) {
            await sleep(30);
            await touch("touchMove", {
              x: Math.round(from.x + ((to.x - from.x) * step) / 4),
              y: Math.round(from.y + ((to.y - from.y) * step) / 4),
            });
          }
        } else {
          await sleep(40);
        }
        await touch("touchEnd");
        result.inputs += 1;
      } catch {
        // The page is navigating or gone; the liveness check below says which.
      }
      await sleep(250);
      if (i % 10 === 9) {
        result.hung = !(await alive(page));
      }
    }
    await sleep(1200);
    result.hung = result.hung || !(await alive(page));
    await env.capture(`after ${result.inputs} random taps`);
    return result;
  }

  // rotate
  result.turns = [];
  const turn = async (width: number, height: number, step: string): Promise<void> => {
    try {
      await page.setViewportSize({ width, height });
      await page.evaluate("window.dispatchEvent(new Event('orientationchange'))");
    } catch {
      result.hung = true;
      return;
    }
    await sleep(1800);
    if (!(await alive(page))) {
      result.hung = true;
      return;
    }
    const png = await env.capture(step);
    let layout: Layout | null = null;
    try {
      layout = (await page.evaluate(LAYOUT_SOURCE)) as Layout;
    } catch {
      layout = null;
    }
    const judged = layout ? judgeLayout(layout) : { cut: 0, covered: 1 };
    result.turns!.push({ step, blank: await isBlank(png), cut: judged.cut, covered: judged.covered });
  };
  await sleep(2500);
  await env.capture("before the turn");
  await turn(env.height, env.width, "on its side");
  if (!result.hung) {
    await turn(env.width, env.height, "turned back");
  }
  return result;
};

const MB = 1024 * 1024;

/** Does the playable keep taking memory while nothing happens? Null when it was not measured. */
export const memoryCheck = (result: StressResult): CheckResult | null => {
  if (result.scenario !== "idle" || result.heapStart === undefined || result.heapEnd === undefined) {
    return null;
  }
  const seconds = Math.round((result.idleMs || 0) / 1000);
  const end = result.heapEnd / MB;
  const growth = (result.heapEnd - result.heapStart) / MB;
  const leaking = growth > 15 && result.heapEnd > result.heapStart * 1.25;
  const status = growth > 80 ? "fail" : leaking || end > 300 ? "warn" : "pass";
  const size = `${end.toFixed(0)} MB of script memory after ${seconds} s untouched`;
  return {
    id: "memory",
    title: "Memory while idle",
    status,
    message:
      growth > 15 && status !== "pass"
        ? `${size}, ${growth.toFixed(0)} MB more than at the start: memory keeps growing while nothing happens, and a budget phone closes an ad that does this.`
        : status === "warn"
          ? `${size}: heavy for a budget phone.`
          : `${size}, ${growth >= 1 ? `${growth.toFixed(0)} MB more than` : "the same as"} at the start.`,
  };
};

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** The one verdict of a scenario run. */
export const stressCheck = (result: StressResult, evidence: RuntimeEvidence): CheckResult => {
  const id = CHECK_ID[result.scenario];
  const title = SCENARIO_TITLE[result.scenario];
  const crashes = evidence.pageErrors.slice(result.errorsBefore);
  const base = { id, title };

  if (!evidence.loaded) {
    return { ...base, status: "fail", message: `Did not load: ${evidence.loadError || "timeout"}.` };
  }
  if (result.hung) {
    return { ...base, status: "fail", message: "The playable froze: the page stopped answering." };
  }

  const blank = evidence.finalDominantRatio !== undefined && evidence.finalDominantRatio >= BLANK_DOMINANT_RATIO;
  const crashNote = crashes.length > 0 ? `${crashes.length} uncaught ${crashes.length === 1 ? "error" : "errors"}` : "";

  if (result.scenario === "idle") {
    const seconds = Math.round((result.idleMs || 0) / 1000);
    const redirect = evidence.adEvents.find((event) => event.kind === "cta");
    if (redirect) {
      return {
        ...base,
        status: "fail",
        message: `Opened the store by itself (${redirect.api}) although nobody touched the ad. Networks reject automatic redirects.`,
      };
    }
    if (crashes.length > 0 || blank) {
      return {
        ...base,
        status: "fail",
        message: `Left alone for ${seconds} s: ${[crashNote, blank ? "the screen went blank" : ""].filter(Boolean).join(", ")}.`,
        details: crashes.slice(0, 6),
      };
    }
    return { ...base, status: "pass", message: `Left alone for ${seconds} s: still running, no errors.` };
  }

  if (result.scenario === "monkey") {
    if (crashes.length > 0 || blank) {
      return {
        ...base,
        status: "fail",
        message: `${result.inputs} random taps (seed ${result.seed}): ${[crashNote, blank ? "the screen went blank" : ""].filter(Boolean).join(", ")}.`,
        details: crashes.slice(0, 6),
      };
    }
    return { ...base, status: "pass", message: `${result.inputs} random taps: still running, no errors.` };
  }

  const turns = result.turns || [];
  const blankTurn = turns.find((turn) => turn.blank);
  const worstCut = turns.reduce((worst, turn) => (turn.cut > worst.cut ? turn : worst), { step: "", blank: false, cut: 0, covered: 1 });
  const smallest = turns.reduce((worst, turn) => (turn.covered < worst.covered ? turn : worst), { step: "", blank: false, cut: 0, covered: 1 });
  if (blankTurn || crashes.length > 0) {
    return {
      ...base,
      status: "fail",
      message: `${[blankTurn ? `Blank screen when ${blankTurn.step}` : "", crashNote].filter(Boolean).join("; ")}.`,
      details: crashes.slice(0, 6),
    };
  }
  if (worstCut.cut > 0.03) {
    return {
      ...base,
      status: worstCut.cut > 0.15 ? "fail" : "warn",
      message: `${percent(worstCut.cut)} of the picture is off screen when ${worstCut.step}: the playable did not rearrange itself for the new orientation.`,
    };
  }
  if (smallest.covered < 0.5) {
    return {
      ...base,
      status: "warn",
      message: `The picture fills only ${percent(smallest.covered)} of the screen when ${smallest.step}.`,
    };
  }
  return { ...base, status: "pass", message: "Rearranged itself when the screen was turned, and again when turned back." };
};
