import type { PointerSample, SessionTrace, TapAnchor } from "@playable-lab/protocol";

export interface TouchPoint {
  id: number;
  nx: number;
  ny: number;
  /** Scene anchor from the recording; the page resolves it in preference to nx/ny. */
  anchor?: TapAnchor;
  force: number;
}

export type ReplayAction =
  | {
      at: number;
      kind: "touch";
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel";
      /**
       * Start / move: every contact on the screen. End: the contacts being
       * lifted (empty lifts them all), which is how Chrome's input API reads it.
       */
      points: TouchPoint[];
      /** Contacts still down after this action. */
      remaining: number;
      shot?: boolean;
    }
  | {
      at: number;
      kind: "mouse";
      type: "down" | "move" | "up";
      nx: number;
      ny: number;
      anchor?: TapAnchor;
      shot?: boolean;
    }
  | { at: number; kind: "wheel"; nx: number; ny: number; deltaX: number; deltaY: number }
  | { at: number; kind: "key"; type: "down" | "up"; key: string };

export interface PlanOptions {
  /** Delay before the first event of a trace that has no load-relative time. */
  leadInMs: number;
  /** Idle gaps longer than this are shortened to it. */
  maxGapMs?: number;
  speed: number;
  /** How many taps get a screenshot, spread over the session. */
  maxShots: number;
}

export interface ReplayPlan {
  actions: ReplayAction[];
  durationMs: number;
  /** Touches, clicks and key presses: the things a player would call "an input". */
  inputs: number;
  firstInputAt?: number;
  /** "load": events carry `rt`. "first-event": old trace, timed from its first event. */
  timing: "load" | "first-event";
  /** CSS size of the recording phone's game area, to carry a drag's distance over to another screen. */
  source?: { w: number; h: number };
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  leadInMs: 1500,
  speed: 1,
  maxShots: 6,
};

const typeOf = (event: PointerSample): string => event.type || "pointer";

const offsets = (events: PointerSample[], options: PlanOptions): { at: number[]; timing: ReplayPlan["timing"] } => {
  const relative = events.every((event) => typeof event.rt === "number");
  const first = events.length ? events[0].t : 0;
  const at: number[] = [];
  let previousRaw = 0;
  let previous = 0;
  for (let i = 0; i < events.length; i += 1) {
    const raw = Math.max(
      previousRaw,
      relative ? (events[i].rt as number) : events[i].t - first + options.leadInMs
    );
    let gap = raw - previousRaw;
    if (options.maxGapMs !== undefined && gap > options.maxGapMs) {
      gap = options.maxGapMs;
    }
    previous += gap / (options.speed > 0 ? options.speed : 1);
    previousRaw = raw;
    at.push(Math.round(previous));
  }
  return { at, timing: relative ? "load" : "first-event" };
};

/**
 * Turns a recorded trace into device-independent input actions. Coordinates
 * stay normalised; the runner maps them onto each screen's content rect.
 */
export const buildReplayPlan = (
  trace: SessionTrace,
  overrides: Partial<PlanOptions> = {}
): ReplayPlan => {
  const options: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...overrides };
  const events = trace.events;
  const { at, timing } = offsets(events, options);
  const actions: ReplayAction[] = [];
  const active = new Map<number, TouchPoint>();
  let mouseDown = false;
  let inputs = 0;
  let firstInputAt: number | undefined;

  const input = (time: number): void => {
    inputs += 1;
    if (firstInputAt === undefined) {
      firstInputAt = time;
    }
  };

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const time = at[i];
    const type = typeOf(event);

    // Gestures are derived on the source; a real touch regenerates them.
    if (type === "gesture") {
      continue;
    }
    if (type === "wheel" || event.phase === "wheel") {
      actions.push({
        at: time,
        kind: "wheel",
        nx: event.nx,
        ny: event.ny,
        deltaX: event.deltaX || 0,
        deltaY: event.deltaY || 0,
      });
      continue;
    }
    if (type === "key") {
      const key = event.key || event.code || "";
      if (!key || event.repeat) {
        continue;
      }
      if (event.phase !== "up") {
        input(time);
      }
      actions.push({ at: time, kind: "key", type: event.phase === "up" ? "up" : "down", key });
      continue;
    }

    // The screens under test are touch devices: a session played with a mouse
    // on the computer is replayed as one finger. Hovering has no touch equivalent.
    if (event.kind === "mouse") {
      if (event.phase === "down") {
        mouseDown = true;
      } else if (!mouseDown) {
        continue;
      } else if (event.phase !== "move") {
        mouseDown = false;
      }
    }

    const point: TouchPoint = {
      id: event.pointerId,
      nx: event.nx,
      ny: event.ny,
      anchor: event.anchor,
      force: event.pressure > 0 ? Math.min(1, event.pressure) : 0.5,
    };
    if (event.phase === "down") {
      active.set(point.id, point);
      input(time);
      actions.push({
        at: time,
        kind: "touch",
        type: "touchStart",
        points: Array.from(active.values()),
        remaining: active.size,
      });
    } else if (event.phase === "move") {
      // A move for a finger we never saw land cannot be replayed.
      if (!active.has(point.id)) {
        continue;
      }
      active.set(point.id, point);
      actions.push({
        at: time,
        kind: "touch",
        type: "touchMove",
        points: Array.from(active.values()),
        remaining: active.size,
      });
    } else {
      if (!active.delete(point.id)) {
        continue;
      }
      // A cancel always drops every finger, so it is only usable for the last one.
      const cancel = event.phase === "cancel" && active.size === 0;
      actions.push({
        at: time,
        kind: "touch",
        type: cancel ? "touchCancel" : "touchEnd",
        points: cancel ? [] : [point],
        remaining: active.size,
      });
    }
  }

  // A trace cut off mid-gesture must not leave fingers down.
  const last = actions.length ? actions[actions.length - 1].at : 0;
  if (active.size > 0) {
    actions.push({ at: last, kind: "touch", type: "touchEnd", points: [], remaining: 0 });
  }

  // Screenshot after a spread of "all fingers lifted" moments.
  const lifts: number[] = [];
  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (
      (action.kind === "touch" && action.remaining === 0) ||
      (action.kind === "mouse" && action.type === "up")
    ) {
      lifts.push(i);
    }
  }
  const shots = Math.min(options.maxShots, lifts.length);
  for (let s = 0; s < shots; s += 1) {
    const index = lifts[Math.floor(((s + 1) * lifts.length) / shots) - 1];
    const action = actions[index];
    if (action.kind === "touch" || action.kind === "mouse") {
      action.shot = true;
    }
  }

  return {
    actions,
    durationMs: last,
    inputs,
    firstInputAt,
    timing,
    source: sourceSize(trace),
  };
};

const sourceSize = (trace: SessionTrace): ReplayPlan["source"] => {
  const rect = trace.sourceViewport?.contentRect;
  return rect && rect.w > 0 && rect.h > 0 ? { w: rect.w, h: rect.h } : undefined;
};
