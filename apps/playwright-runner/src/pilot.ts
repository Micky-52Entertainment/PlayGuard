import { MIN_CHANGE_SCORE } from "@playable-lab/checks";
import { clamp01 } from "@playable-lab/input-mapper";
import type { Orientation, PointerPhase, PointerSample, Rect } from "@playable-lab/protocol";
import type { CDPSession, Page } from "playwright";
import {
  PLAY_SCHEMA,
  REVIEW_SCHEMA,
  askWithinBudget,
  describeAiError,
  formatAction,
  mergeIssues,
  parseDecision,
  playSystemPrompt,
  playTurnText,
  reviewSystemPrompt,
} from "./ai.ts";
import type { AiAction, AiOutcome, AiProvider, AiRunInfo, Lang, TokenBudget } from "./ai.ts";
import { analyse, frameDifference, shrinkToJpeg } from "./frames.ts";
import type { FrameStats } from "./frames.ts";

/** The model could not be reached at all: there is no point in carrying on with the run. */
export class AiSetupError extends Error {}

export interface AiSettings {
  provider: AiProvider;
  budget: TokenBudget;
  lang: Lang;
  /** Longest side of the screenshots sent to the model, px. */
  imageSide: number;
  maxTurns: number;
}

export interface PilotEnv {
  page: Page;
  cdp: CDPSession;
  helper: Page;
  ai: AiSettings;
  width: number;
  height: number;
  orientation: Orientation;
  /** Ms since the playable's load. */
  sinceLoad: () => number;
  /** Saves a screenshot into the report and returns it. */
  capture: (label: string) => Promise<Buffer | undefined>;
  storeOpened: () => Promise<boolean>;
  log: (line: string) => void;
}

export interface PilotResult {
  info: AiRunInfo;
  /** The inputs the AI made, as a recording other screens can replay. */
  events: PointerSample[];
  rect: Rect;
  inputs: number;
  firstInputAt?: number;
}

// Long enough for the game to react and for the tap marker to fade.
const SETTLE_MS = 700;
const BETWEEN_ACTIONS_MS = 250;
const STILL_TURNS_TO_STOP = 3;

// Shows the people watching where the AI touched; gone before the next screenshot.
const MARKER_SOURCE = `
(function (x, y) {
  var dot = document.createElement("div");
  dot.style.cssText = "position:fixed;left:" + (x - 22) + "px;top:" + (y - 22) + "px;width:44px;height:44px;" +
    "border-radius:50%;border:3px solid #fff;background:rgba(255,64,129,.55);box-shadow:0 0 0 2px rgba(0,0,0,.45);" +
    "pointer-events:none;z-index:2147483647;transition:opacity .4s,transform .4s;";
  (document.body || document.documentElement).appendChild(dot);
  requestAnimationFrame(function () { dot.style.opacity = "0"; dot.style.transform = "scale(1.7)"; });
  setTimeout(function () { dot.remove(); }, 450);
})
`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const newInfo = (mode: AiRunInfo["mode"], provider: AiProvider): AiRunInfo => ({
  mode,
  provider: provider.id,
  model: provider.model,
  turns: [],
  issues: [],
  outcome: mode === "play" ? "steps" : "reviewed",
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
});

/**
 * The AI plays the playable on one screen: screenshot, a batch of inputs,
 * screenshot, until the store opens or it runs out of turns or tokens.
 */
export const pilot = async (env: PilotEnv): Promise<PilotResult> => {
  const { page, cdp, helper, ai } = env;
  const info = newInfo("play", ai.provider);
  const events: PointerSample[] = [];
  let rect: Rect = { x: 0, y: 0, w: env.width, h: env.height };
  let inputs = 0;
  let firstInputAt: number | undefined;

  const refreshRect = async (): Promise<void> => {
    try {
      const measured = (await page.evaluate(
        "window.__playableLabRect ? window.__playableLabRect() : null"
      )) as Rect | null;
      if (measured && measured.w > 0 && measured.h > 0) {
        rect = measured;
      }
    } catch {
      // Keep the previous rect.
    }
  };

  const touch = async (phase: PointerPhase, x: number, y: number): Promise<void> => {
    events.push({
      t: Date.now(),
      rt: env.sinceLoad(),
      kind: "touch",
      phase,
      pointerId: 1,
      nx: clamp01((x - rect.x) / rect.w),
      ny: clamp01((y - rect.y) / rect.h),
      pressure: phase === "up" ? 0 : 0.5,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: phase === "down" ? "touchStart" : phase === "move" ? "touchMove" : "touchEnd",
      touchPoints: phase === "up" ? [] : [{ x, y, id: 1, force: 0.5, radiusX: 8, radiusY: 8 }],
    });
  };

  const press = async (x: number, y: number): Promise<void> => {
    await refreshRect();
    inputs += 1;
    if (firstInputAt === undefined) {
      firstInputAt = env.sinceLoad();
    }
    try {
      await page.evaluate(`${MARKER_SOURCE}(${x}, ${y})`);
    } catch {
      // The marker is for the audience only.
    }
    await touch("down", x, y);
  };

  const perform = async (action: AiAction): Promise<void> => {
    if (action.kind === "wait") {
      await sleep(action.ms);
      return;
    }
    const x = (action.x / 100) * env.width;
    const y = (action.y / 100) * env.height;
    await press(x, y);
    if (action.kind === "tap") {
      await sleep(60);
      await touch("up", x, y);
    } else if (action.kind === "hold") {
      await sleep(action.ms);
      await touch("up", x, y);
    } else {
      const x2 = (action.x2 / 100) * env.width;
      const y2 = (action.y2 / 100) * env.height;
      const steps = 10;
      for (let i = 1; i <= steps; i += 1) {
        await sleep(35);
        await touch("move", x + ((x2 - x) * i) / steps, y + ((y2 - y) * i) / steps);
      }
      await sleep(60);
      await touch("up", x2, y2);
    }
  };

  const system = playSystemPrompt(ai.lang);
  let previous: FrameStats | undefined;
  let touched = false;
  let still = 0;
  let outcome: AiOutcome = "steps";

  for (let turn = 1; turn <= ai.maxTurns; turn += 1) {
    if (await env.storeOpened()) {
      break;
    }
    if (ai.budget.used >= ai.budget.limit) {
      outcome = "budget";
      break;
    }
    const png = await env.capture(`AI turn ${turn}`);
    if (!png) {
      outcome = "error";
      info.note = "no screenshot";
      break;
    }
    const stats = await analyse(helper, png);
    const changed = previous ? frameDifference(previous, stats) >= MIN_CHANGE_SCORE : undefined;
    previous = stats;
    if (info.turns.length > 0) {
      info.turns[info.turns.length - 1].changed = changed;
    }
    still = touched && changed === false ? still + 1 : 0;
    if (still >= STILL_TURNS_TO_STOP) {
      // Asking again would cost tokens and get the same picture.
      outcome = "stuck";
      break;
    }

    let decision;
    try {
      decision = parseDecision(
        await askWithinBudget(ai.provider, ai.budget, info, {
          kind: "play",
          system,
          text: playTurnText({
            width: env.width,
            height: env.height,
            orientation: env.orientation,
            turn,
            maxTurns: ai.maxTurns,
            at: env.sinceLoad(),
            previous: info.turns,
            lastChanged: changed,
            reported: info.issues.map((issue) => issue.text),
          }),
          images: [await shrinkToJpeg(helper, png, ai.imageSide)],
          schema: PLAY_SCHEMA,
        })
      );
    } catch (error) {
      if (ai.budget.calls === 0) {
        throw new AiSetupError(`${ai.provider.id} (${ai.provider.model}): ${describeAiError(error)}`);
      }
      outcome = "error";
      info.note = describeAiError(error);
      break;
    }

    mergeIssues(info.issues, decision.issues, turn);
    const actions = decision.actions.map(formatAction);
    info.turns.push({ turn, at: env.sinceLoad(), see: decision.see, actions });
    env.log(`  ${String(turn).padStart(2)}. ${decision.see || "?"}  →  ${actions.join("; ") || "no input"}`);
    for (let i = 0; i < decision.issues.length; i += 1) {
      env.log(`      ${decision.issues[i].severity}: ${decision.issues[i].text}`);
    }

    touched = decision.actions.some((action) => action.kind !== "wait");
    try {
      for (let i = 0; i < decision.actions.length; i += 1) {
        await perform(decision.actions[i]);
        await sleep(BETWEEN_ACTIONS_MS);
      }
    } catch (error) {
      outcome = "error";
      info.note = `input failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      break;
    }
    await sleep(SETTLE_MS);

    if (decision.status !== "playing") {
      outcome = decision.status;
      break;
    }
  }

  if (await env.storeOpened()) {
    outcome = "store";
  }
  info.outcome = outcome;
  return { info, events, rect, inputs, firstInputAt };
};

export interface ReviewEnv {
  helper: Page;
  ai: AiSettings;
  width: number;
  height: number;
  orientation: Orientation;
  deviceName: string;
  frames: Buffer[];
}

/** One model call on a replayed screen: does the layout hold on this shape? */
export const review = async (env: ReviewEnv): Promise<AiRunInfo | undefined> => {
  const { ai } = env;
  if (env.frames.length === 0 || ai.budget.used >= ai.budget.limit) {
    return undefined;
  }
  const info = newInfo("review", ai.provider);
  try {
    const images: string[] = [];
    for (let i = 0; i < env.frames.length; i += 1) {
      images.push(await shrinkToJpeg(env.helper, env.frames[i], ai.imageSide));
    }
    const reply = parseDecision(
      await askWithinBudget(ai.provider, ai.budget, info, {
        kind: "review",
        system: reviewSystemPrompt(ai.lang),
        text: `${env.deviceName}, ${env.width}x${env.height} ${env.orientation}. ${images.length} screenshot${images.length === 1 ? "" : "s"}.`,
        images,
        schema: REVIEW_SCHEMA,
      })
    );
    mergeIssues(info.issues, reply.issues);
  } catch (error) {
    info.outcome = "error";
    info.note = describeAiError(error);
  }
  return info;
};
