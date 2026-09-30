import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { mascotSay } from "./mascotBus";
import type { Key } from "./i18n";

/** One screen of a run, as the hub reports it. */
export interface ScreenTile {
  id: string;
  name: string;
  w: number;
  h: number;
  orientation: string;
  scenario?: string;
  /** A language run: the phone's language code. */
  language?: string;
  /** An old-phone run: which one it stands for ("iOS 13"). */
  old?: string;
  status?: "pass" | "warn" | "fail";
  /** Path under /reports/ of the last picture. */
  shot?: string | null;
}

const GLYPH = { pass: "✓", warn: "!", fail: "✕" } as const;

/** Tallest a tile gets; the width follows the screen's own shape. */
const TILE_HEIGHT = 118;

/**
 * The check as a row of phones: every screen waits as a silhouette of its
 * shape, and lights up with its last picture when it is done.
 */
export const ScreensProgress = ({ tiles }: { tiles: ScreenTile[] }) => {
  const { t } = useI18n();
  return (
    <div className="screens" role="list">
      {tiles.map((tile, index) => {
        const width = Math.round((TILE_HEIGHT * tile.w) / tile.h);
        return (
          <figure
            key={tile.id}
            role="listitem"
            className={`screen-tile ${tile.status ? `done ${tile.status}` : "waiting"}`}
            style={{ animationDelay: `${Math.min(index, 16) * 0.04}s` }}
            title={`${tile.name} · ${tile.w}×${tile.h}`}
          >
            <div className="screen-frame" style={{ width, height: TILE_HEIGHT }}>
              {tile.shot ? <img src={`/reports/${tile.shot}`} alt="" /> : <span className="screen-shine" />}
              {tile.status && <span className={`screen-mark mark ${tile.status}`}>{GLYPH[tile.status]}</span>}
            </div>
            <figcaption>
              {tile.old
                ? tile.old
                : tile.language
                ? `${t("scenario.language")} ${tile.language.toUpperCase()}`
                : tile.scenario
                  ? t(`scenario.${tile.scenario}` as Key)
                  : tile.name}
              <span>{tile.orientation === "landscape" ? "↔" : "↕"}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
};

interface ReportRun {
  id: string;
  status: "pass" | "warn" | "fail";
  device: { name: string };
  orientation: string;
  cssWidth: number;
  cssHeight: number;
  shots: Array<{ file: string; label: string }>;
  scenario?: string;
  language?: string;
  old?: string;
}

interface ReportData {
  runs: ReportRun[];
  stress?: ReportRun[];
  languages?: ReportRun[];
  oldPhones?: ReportRun[];
}

const reportCache = new Map<string, Promise<ReportData | null>>();

/** A report's data, fetched once per session. */
export const loadReport = (dir: string): Promise<ReportData | null> => {
  let pending = reportCache.get(dir);
  if (!pending) {
    pending = fetch(`/reports/${encodeURIComponent(dir)}/report.json`).then(
      (response) => (response.ok ? (response.json() as Promise<ReportData>) : null),
      () => null
    );
    reportCache.set(dir, pending);
  }
  return pending;
};

const finalOf = (run: ReportRun): string | null => {
  const shot = run.shots.find((item) => item.label === "final") || run.shots[run.shots.length - 1];
  return shot ? shot.file : null;
};

/** Reports Micky already pointed at a lone failure in, this session. */
const nudged = new Set<string>();

/** The single failed screen among at least three that are otherwise fine. */
const loneFailure = (runs: ReportRun[]): ReportRun | null => {
  const failed = runs.filter((run) => run.status === "fail");
  return runs.length >= 3 && failed.length === 1 ? failed[0] : null;
};

interface RetryState {
  available: boolean;
  screens: Array<{ id: string; state: "running" | "failed"; error?: string }>;
}

/**
 * The result, gathered from its screens: each flies in to its place; the
 * ones with remarks are outlined. A click opens that screen in the report;
 * the round arrow checks that one screen again, without redoing the rest.
 */
export const ResultScreens = ({
  dir,
  onOpen,
  onChanged,
}: {
  dir: string;
  onOpen: (runId: string) => void;
  /** A screen was checked again: the report page should reload. */
  onChanged?: () => void;
}) => {
  const { t } = useI18n();
  const [data, setData] = useState<ReportData | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const running = useRef<string[]>([]);

  useEffect(() => {
    void loadReport(dir).then(setData);
  }, [dir, version]);

  // Follow the screens being checked again; when one is done, read the report anew.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/reports/${encodeURIComponent(dir)}/retry`);
        const next = (await response.json()) as RetryState;
        if (stopped) {
          return;
        }
        const now = next.screens.filter((item) => item.state === "running").map((item) => item.id);
        if (running.current.some((id) => !now.includes(id))) {
          reportCache.delete(dir);
          setVersion((value) => value + 1);
          onChanged?.();
        }
        running.current = now;
        setRetry(next);
        if (now.length > 0) {
          timer = setTimeout(() => void poll(), 1500);
        }
      } catch {
        // An older hub without the endpoint: no round arrows.
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [dir, version, tick]);

  // One screen failed while the others of its kind are fine: likely a hiccup,
  // so Micky suggests checking just that one again, once per report.
  const lone = data && retry?.available ? loneFailure(data.runs) : null;
  useEffect(() => {
    if (!lone || nudged.has(dir)) {
      return;
    }
    nudged.add(dir);
    mascotSay({ pose: "point", text: t("mascot.retry", { name: lone.device.name }), ms: 9000 });
  }, [lone?.id, dir]);

  const again = async (runId: string): Promise<void> => {
    setRetry((old) => (old ? { ...old, screens: [...old.screens.filter((item) => item.id !== runId), { id: runId, state: "running" }] } : old));
    running.current = [...running.current, runId];
    await fetch(`/api/reports/${encodeURIComponent(dir)}/screens/${encodeURIComponent(runId)}/retry`, { method: "POST" });
    setTick((value) => value + 1);
  };

  if (!data) {
    return null;
  }
  const tiles: ScreenTile[] = [...data.runs, ...(data.stress || []), ...(data.languages || []), ...(data.oldPhones || [])].map((run) => ({
    id: run.id,
    name: run.device.name,
    w: run.cssWidth,
    h: run.cssHeight,
    orientation: run.orientation,
    scenario: run.scenario,
    language: run.language,
    old: run.old,
    status: run.status,
    shot: finalOf(run) ? `${dir}/${finalOf(run)}` : null,
  }));
  return (
    <div className="result-screens">
      {tiles.map((tile, index) => {
        const width = Math.round((96 * tile.w) / tile.h);
        const state = retry?.screens.find((item) => item.id === tile.id);
        return (
          <div
            key={tile.id}
            className={`result-tile ${tile.status}${state?.state === "running" ? " retrying" : ""}${lone?.id === tile.id && !state ? " nudge" : ""}`}
            style={{ animationDelay: `${Math.min(index, 20) * 0.035}s` }}
          >
            <button
              className="result-open"
              onClick={() => onOpen(tile.id)}
              title={`${tile.old ? `${tile.old} · ` : tile.language ? `${tile.language.toUpperCase()} · ` : ""}${tile.name} · ${tile.w}×${tile.h}`}
            >
              <span className="result-frame" style={{ width, height: 96 }}>
                {tile.shot && <img src={`/reports/${tile.shot}?v=${version}`} alt="" loading="lazy" />}
                <span className={`screen-mark mark ${tile.status}`}>{tile.status ? GLYPH[tile.status] : ""}</span>
                {state?.state === "running" && (
                  <span className="result-busy">
                    <span className="spinner" />
                  </span>
                )}
              </span>
            </button>
            {retry?.available && state?.state !== "running" && (
              <button
                className="result-again"
                title={state?.state === "failed" ? `${t("retry.failed")} ${state.error || ""}` : t("retry.tip")}
                aria-label={t("retry.tip")}
                onClick={() => void again(tile.id)}
              >
                ↻
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Hovering a report flips through the pictures of its first screen, so the
 * playable is recognised without opening anything.
 */
export const useScrub = () => {
  const [preview, setPreview] = useState<{ x: number; y: number; frames: string[]; index: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const current = useRef<string | null>(null);

  const stop = (): void => {
    current.current = null;
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setPreview(null);
  };

  const start = (dir: string, event: React.MouseEvent): void => {
    const x = event.clientX;
    const y = event.clientY;
    current.current = dir;
    void loadReport(dir).then((data) => {
      if (!data || current.current !== dir) {
        return;
      }
      const run = data.runs.find((item) => item.shots.length > 1) || data.runs[0];
      if (!run) {
        return;
      }
      const frames = run.shots.map((shot) => `/reports/${encodeURIComponent(dir)}/${shot.file}`);
      setPreview({ x, y, frames, index: 0 });
      if (timer.current) {
        clearInterval(timer.current);
      }
      timer.current = setInterval(() => {
        setPreview((old) => (old ? { ...old, index: (old.index + 1) % old.frames.length } : old));
      }, 420);
    });
  };

  const move = (event: React.MouseEvent): void => {
    setPreview((old) => (old ? { ...old, x: event.clientX, y: event.clientY } : old));
  };

  useEffect(() => stop, []);

  const node = preview ? (
    <div className="scrub" style={{ left: preview.x + 18, top: Math.max(8, preview.y - 90) }} aria-hidden="true">
      <img src={preview.frames[preview.index]} alt="" />
      <span className="scrub-dots">
        {preview.frames.map((_, index) => (
          <i key={index} className={index === preview.index ? "on" : ""} />
        ))}
      </span>
    </div>
  ) : null;

  return { start, move, stop, node };
};
