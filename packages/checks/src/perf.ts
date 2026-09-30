import type { PerfSample } from "@playable-lab/protocol";
import type { CheckResult } from "./types.ts";

export type FpsZone = "green" | "yellow" | "red";

/** At or above `green` is smooth; below `yellow` is a visible stutter. */
export const FPS_ZONES = { green: 50, yellow: 30 } as const;

export const ZONE_LABEL: Record<FpsZone, string> = {
  green: `Green · ${FPS_ZONES.green}+ fps`,
  yellow: `Yellow · ${FPS_ZONES.yellow}–${FPS_ZONES.green} fps`,
  red: `Red · under ${FPS_ZONES.yellow} fps`,
};

export const fpsZone = (fps: number): FpsZone =>
  fps >= FPS_ZONES.green ? "green" : fps >= FPS_ZONES.yellow ? "yellow" : "red";

export interface FpsSummary {
  samples: number;
  durationMs: number;
  average: number;
  min: number;
  max: number;
  zone: FpsZone;
  /** Share of the session spent in each zone, 0..1. */
  share: Record<FpsZone, number>;
}

/** Each sample covers the time since the previous one, so slow seconds weigh by their length. */
export const summarizeFps = (perf: PerfSample[]): FpsSummary | null => {
  if (perf.length === 0) {
    return null;
  }
  const time: Record<FpsZone, number> = { green: 0, yellow: 0, red: 0 };
  let total = 0;
  let frames = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 0; i < perf.length; i += 1) {
    const span = Math.max(1, i === 0 ? 1000 : perf[i].at - perf[i - 1].at);
    total += span;
    frames += (perf[i].fps * span) / 1000;
    time[fpsZone(perf[i].fps)] += span;
    min = Math.min(min, perf[i].fps);
    max = Math.max(max, perf[i].fps);
  }
  const average = (frames * 1000) / total;
  return {
    samples: perf.length,
    durationMs: total,
    average,
    min,
    max,
    zone: fpsZone(average),
    share: { green: time.green / total, yellow: time.yellow / total, red: time.red / total },
  };
};

export const runPerfChecks = (perf: PerfSample[] | undefined): CheckResult[] => {
  const summary = summarizeFps(perf || []);
  if (!summary) {
    return [];
  }
  const red = Math.round(summary.share.red * 100);
  const status = summary.zone === "red" ? "fail" : summary.zone === "yellow" || red >= 5 ? "warn" : "pass";
  return [
    {
      id: "phone-fps",
      title: "Frame rate on the phone",
      status,
      message: `${summary.average.toFixed(0)} fps average, ${summary.min.toFixed(0)} fps at worst; ${Math.round(summary.share.green * 100)}% green, ${Math.round(summary.share.yellow * 100)}% yellow, ${red}% red over ${(summary.durationMs / 1000).toFixed(0)} s.`,
    },
  ];
};
