import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fpsZone, runTraceChecks, summarizeFps } from "@playable-lab/checks";
import type { FpsZone } from "@playable-lab/checks";
import type { SessionTrace } from "@playable-lab/protocol";
import { lastLine, runRunner } from "./runner.ts";
import type { Depth } from "./runner.ts";
import { applyScreens } from "./runner.ts";
import type { Lang, Progress, ScreenTile } from "./runner.ts";

export type Verdict = "pass" | "warn" | "fail";

export interface ReportSummary {
  /** Folder name under reports/. */
  dir: string;
  url: string;
  generatedAt: string;
  status: Verdict;
  playable: string;
  network: string | null;
  sessionId: string | null;
  /** The other orientation's recording, played in the same check. */
  also: string[];
  /** Quick or full; null for checks made before depths existed. */
  depth: "quick" | "full" | null;
  stepId: string | null;
  /** Who played, when the run was an AI autoplay. */
  ai: string | null;
  /** Who ran the check. */
  by: string | null;
  screens: Record<Verdict, number>;
}

export interface JobState {
  state: "running" | "failed";
  startedAt: number;
  /** Screens replayed so far, while running. */
  progress?: Progress;
  /** Every screen of the run, with the ones done so far. */
  screens?: ScreenTile[];
  error?: string;
  /** The folder the run writes into: a failed run may be continued from it. */
  dir?: string;
}

export interface TraceSummary {
  id: string;
  playable: string;
  stepId: string | null;
  orientation: string;
  startedAt: number;
  durationMs: number;
  touches: number;
  /** API of the first store call, if the recording reached one. */
  cta: string | null;
  fps: { average: number; zone: FpsZone } | null;
  /** False when the recording cannot drive a replay; `problem` says why. */
  usable: boolean;
  problem: string | null;
  /** Who recorded it. */
  by: string | null;
  report: ReportSummary | null;
  job: JobState | null;
  /** Its latest check stopped half-way and can be continued. */
  interrupted?: { dir: string; done: number; total: number | null };
}

interface CachedTrace {
  mtimeMs: number;
  summary: Omit<TraceSummary, "report" | "job">;
}

interface CachedReport {
  mtimeMs: number;
  size: number;
  summary: ReportSummary;
}

const summarizeTrace = (trace: SessionTrace): CachedTrace["summary"] => {
  const pointers = trace.events.filter((event) => (event.type || "pointer") === "pointer");
  const fps = summarizeFps(trace.perf || []);
  const broken = runTraceChecks(trace).find((check) => check.status === "fail");
  const firstCta = (trace.adEvents || []).find((event) => event.kind === "cta");
  return {
    id: trace.sessionId,
    playable: trace.playable.name,
    stepId: trace.stepId || null,
    orientation: trace.orientationLock,
    startedAt: trace.startedAt,
    by: trace.by || null,
    durationMs: Math.max(0, (trace.endedAt || trace.startedAt) - trace.startedAt),
    touches: pointers.filter((event) => event.phase === "down").length,
    cta: firstCta ? firstCta.api : null,
    fps: fps ? { average: fps.average, zone: fpsZone(fps.average) } : null,
    usable: !broken && pointers.length > 0,
    problem: broken
      ? broken.message
      : pointers.length === 0
        ? "No input was recorded."
        : trace.abort
          ? `Aborted: ${trace.abort.reason}`
          : null,
  };
};

/** Maps in parallel, a few at a time, so thousands of files never open at once. */
const mapLimited = async <T, R>(items: T[], fn: (item: T) => Promise<R>, limit = 32): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/** Saved traces and replay reports, plus the replay jobs the console starts. */
export class Library {
  private readonly _traceCache = new Map<string, CachedTrace>();
  private readonly _reportCache = new Map<string, CachedReport>();
  private readonly _jobs = new Map<string, JobState>();

  public constructor(
    private readonly _root: string,
    private readonly _tracesDir: string,
    private readonly _reportsDir: string
  ) {}

  public get reportsDir(): string {
    return this._reportsDir;
  }

  public async reports(): Promise<ReportSummary[]> {
    let dirs: string[] = [];
    try {
      dirs = await readdir(this._reportsDir);
    } catch {
      this._reportCache.clear();
      return [];
    }
    const seen = new Set<string>();
    const list: ReportSummary[] = [];
    // Stat in parallel; only new or changed report.json files are read and parsed.
    const found = await mapLimited(dirs, (dir) => this._report(dir));
    for (let i = 0; i < dirs.length; i += 1) {
      seen.add(dirs[i]);
      const summary = found[i];
      if (summary) {
        list.push(summary);
      }
    }
    for (const dir of this._reportCache.keys()) {
      if (!seen.has(dir)) {
        this._reportCache.delete(dir);
      }
    }
    // Folder names end in a timestamp, so they sort by time.
    return list.sort((a, b) => (a.dir.slice(-15) < b.dir.slice(-15) ? 1 : -1));
  }

  /** One report folder's summary, from the cache while its report.json is unchanged. */
  private async _report(dir: string): Promise<ReportSummary | null> {
    const file = path.join(this._reportsDir, dir, "report.json");
    let mtimeMs: number;
    let size: number;
    try {
      const info = await stat(file);
      mtimeMs = info.mtimeMs;
      size = info.size;
    } catch {
      // Not a report folder.
      this._reportCache.delete(dir);
      return null;
    }
    const cached = this._reportCache.get(dir);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached.summary;
    }
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      const screens: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0 };
      const runs: Array<{ status: Verdict }> = raw.runs || [];
      for (let r = 0; r < runs.length; r += 1) {
        screens[runs[r].status] += 1;
      }
      const summary: ReportSummary = {
        dir,
        url: `/reports/${encodeURIComponent(dir)}/index.html`,
        generatedAt: String(raw.generatedAt || ""),
        status: raw.status,
        playable: String(raw.playable?.name || dir),
        network: raw.network?.name || null,
        sessionId: raw.trace?.sessionId || null,
        also: Array.isArray(raw.trace?.also) ? raw.trace.also.map(String) : [],
          depth: raw.depth === "quick" || raw.depth === "full" ? raw.depth : null,
        stepId: raw.trace?.stepId || null,
        ai: raw.ai ? String(raw.ai.provider) : null,
        by: raw.by ? String(raw.by) : null,
        screens,
      };
      this._reportCache.set(dir, { mtimeMs, size, summary });
      return summary;
    } catch {
      // A run that is still writing: not cached, so it is read again next time.
      this._reportCache.delete(dir);
      return null;
    }
  }

  public async traces(): Promise<TraceSummary[]> {
    const reports = await this.reports();
    let files: string[] = [];
    try {
      files = (await readdir(this._tracesDir)).filter((file) => file.endsWith(".json"));
    } catch {
      this._traceCache.clear();
      return [];
    }
    // Newest report per session (reports are sorted newest first), for a lookup instead of a scan per trace.
    const bySession = new Map<string, ReportSummary>();
    for (let i = 0; i < reports.length; i += 1) {
      const ids = reports[i].sessionId ? [reports[i].sessionId as string, ...reports[i].also] : reports[i].also;
      for (let k = 0; k < ids.length; k += 1) {
        if (!bySession.has(ids[k])) {
          bySession.set(ids[k], reports[i]);
        }
      }
    }
    const summaries = await mapLimited(files, (file) => this._trace(file));
    const seen = new Set(files);
    for (const file of this._traceCache.keys()) {
      if (!seen.has(file)) {
        this._traceCache.delete(file);
      }
    }
    const list: TraceSummary[] = [];
    for (let i = 0; i < summaries.length; i += 1) {
      const summary = summaries[i];
      if (!summary) {
        continue;
      }
      list.push({
        ...summary,
        report: bySession.get(summary.id) || null,
        job: this._jobs.get(summary.id) || null,
      });
    }
    return list.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** One trace file's summary, from the cache while the file is unchanged. */
  private async _trace(name: string): Promise<CachedTrace["summary"] | null> {
    const file = path.join(this._tracesDir, name);
    try {
      const info = await stat(file);
      let cached = this._traceCache.get(name);
      if (!cached || cached.mtimeMs !== info.mtimeMs) {
        const trace = JSON.parse(await readFile(file, "utf8")) as SessionTrace;
        cached = { mtimeMs: info.mtimeMs, summary: summarizeTrace(trace) };
        this._traceCache.set(name, cached);
      }
      return cached.summary;
    } catch {
      this._traceCache.delete(name);
      return null;
    }
  }

  /** Is a replay of this trace running right now? */
  public busy(traceId: string): boolean {
    return this._jobs.get(traceId)?.state === "running";
  }

  /** Replays a trace with the runner in a child process. Returns false if one is already running. */
  public async startChecks(
    traceId: string,
    network?: string,
    lang: Lang = "en",
    by?: string,
    also?: string[],
    depth?: Depth
  ): Promise<boolean> {
    if (this._jobs.get(traceId)?.state === "running") {
      return false;
    }
    // Checked again: a recording played in both orientations is checked with its pair.
    let pair = also;
    if (!pair) {
      const last = (await this.reports()).find((report) => report.sessionId === traceId);
      pair = last?.also || [];
    }
    const args = ["--trace", path.join(this._tracesDir, `${traceId}.json`), "--out", this._reportsDir, "--lang", lang];
    for (let i = 0; i < pair.length; i += 1) {
      args.push("--trace", path.join(this._tracesDir, `${path.basename(pair[i])}.json`));
    }
    if (network) {
      args.push("--network", network);
    }
    if (by) {
      args.push("--by", by);
    }
    const job: JobState = { state: "running", startedAt: Date.now() };
    this._jobs.set(traceId, job);

    void runRunner(this._root, args, {
      depth,
      onUpdate: (update) => {
        if (update.progress) {
          job.progress = update.progress;
        }
        if (update.dir) {
          job.dir = update.dir;
        }
        job.screens = applyScreens(job.screens, update);
      },
    }).then((result) => {
      // 0 and 1 both mean a report was written; 1 is "some check failed".
      if (result.code === 0 || result.code === 1) {
        this._jobs.delete(traceId);
        return;
      }
      this._jobs.set(traceId, {
        state: "failed",
        startedAt: job.startedAt,
        dir: result.dir || undefined,
        error: lastLine(result.output) || `Runner exited with code ${result.code}`,
      });
    });
    console.log(`[hub] checks started for ${traceId}`);
    return true;
  }
}
