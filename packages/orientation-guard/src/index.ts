import { orientationFromSize } from "@playable-lab/input-mapper";
import type { AbortCode, Orientation } from "@playable-lab/protocol";

export interface OrientationVerdictOk {
  ok: true;
  orientation: Orientation;
}

export interface OrientationVerdictAbort {
  ok: false;
  code: AbortCode;
  reason: string;
}

export type OrientationVerdict = OrientationVerdictOk | OrientationVerdictAbort;

export const resolveOrientation = (
  cssWidth: number,
  cssHeight: number,
  lock: Orientation
): Orientation => {
  const current = orientationFromSize(cssWidth, cssHeight);
  return current === "square" ? lock : current;
};

export const evaluateSessionOrientation = (
  lock: Orientation,
  cssWidth: number,
  cssHeight: number,
  seen?: Orientation
): OrientationVerdict => {
  const current = resolveOrientation(cssWidth, cssHeight, lock);

  if (current !== lock) {
    return {
      ok: false,
      code: "ORIENTATION_CHANGED",
      reason: `Session is locked to ${lock}, but the device is now ${current}. Replay this step in ${lock} only — portrait and landscape cannot share one session.`,
    };
  }

  if (seen && seen !== current) {
    return {
      ok: false,
      code: "ORIENTATION_CHANGED",
      reason: `This session already ran in ${seen} and then switched to ${current}. Stop and replay as two separate steps.`,
    };
  }

  return { ok: true, orientation: current };
};
