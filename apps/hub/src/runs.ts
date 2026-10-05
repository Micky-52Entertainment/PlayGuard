import { readFile } from "node:fs/promises";
import path from "node:path";
import { lastLine, runRunner } from "./runner.ts";
import type { Depth } from "./runner.ts";
import { applyScreens } from "./runner.ts";
import type { Lang, Progress, ScreenTile, Tokens } from "./runner.ts";
import type { AiProviderId } from "./settings.ts";

export type Verdict = "pass" | "warn" | "fail";

export interface QuickRun {
  id: string;
  playableId: string;
  playable: string;
  /** "ai": an AI tester plays it. "load": it is only opened on every screen. */
  mode: "ai" | "load";
  provider: AiProviderId | null;
  state: "running" | "done" | "failed";
  startedAt: number;
  progress: Progress | null;
  /** Every screen of the run, with the ones done so far. */
  screens?: ScreenTile[];
  tokens: Tokens | null;
  /** The runner's latest line: what the AI tester just saw and did. */
  lastLine: string | null;
  reportDir: string | null;
  /** The folder the run writes into: an interrupted run is continued from it. */
  dir: string | null;
  /** Continues a check that was interrupted. */
  resumed?: boolean;
  verdict: Verdict | null;
  error?: string;
}

export interface QuickRunRequest {
  playableId: string;
  playable: string;
  /** Entry HTML on disk. */
  file: string;
  /** Set when the entry belongs to a multi-file build: the size it ships at. */
  bundleBytes?: number;
  mode: "ai" | "load";
  provider?: AiProviderId;
  network?: string;
  lang: Lang;
  /** Who started it. */
  by?: string;
  /** Quick or full; the setting's choice when left out. */
  depth?: Depth;
  env: NodeJS.ProcessEnv;
}

/** Runs that need no recording: an AI playthrough, or a load on every screen. */
export class RunStore {
  private readonly _runs = new Map<string, QuickRun>();
  private _seq = 0;

  public constructor(
    private readonly _root: string,
    private readonly _reportsDir: string
  ) {}

  public get(id: string): QuickRun | undefined {
    return this._runs.get(id);
  }

  public start(request: QuickRunRequest): QuickRun {
    const run = this._create({
      playableId: request.playableId,
      playable: request.playable,
      mode: request.mode,
      provider: request.mode === "ai" ? request.provider || "claude" : null,
    });

    const args = ["--playable", request.file, "--name", request.playable, "--out", this._reportsDir, "--lang", request.lang];
    if (request.mode === "ai") {
      args.unshift("--autoplay");
      args.push("--ai", run.provider || "claude");
    }
    if (request.network) {
      args.push("--network", request.network);
    }
    if (request.by) {
      args.push("--by", request.by);
    }
    if (request.bundleBytes !== undefined) {
      args.push("--bundle", "--zip-bytes", String(request.bundleBytes));
    }

    this._follow(run, args, { env: request.env, depth: request.depth });
    console.log(`[hub] ${request.mode} run started for ${request.playable}`);
    return run;
  }

  /** Continues an interrupted check in its own folder: the screens it finished stay. */
  public resume(name: string, args: string[], onDone?: (reportDir: string) => void): QuickRun {
    const run = this._create({ playableId: "", playable: name, mode: "load", provider: null });
    run.resumed = true;
    // The saved command line already holds the settings the check was started with.
    this._follow(run, args, { noDefaults: true }, onDone);
    console.log(`[hub] continuing the check of ${name}`);
    return run;
  }

  private _create(fields: Pick<QuickRun, "playableId" | "playable" | "mode" | "provider">): QuickRun {
    const id = `r_${Date.now().toString(36)}_${this._seq}`;
    this._seq += 1;
    const run: QuickRun = {
      id,
      ...fields,
      state: "running",
      startedAt: Date.now(),
      progress: null,
      tokens: null,
      lastLine: null,
      reportDir: null,
      dir: null,
      verdict: null,
    };
    this._runs.set(id, run);
    return run;
  }

  private _follow(
    run: QuickRun,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; depth?: Depth; noDefaults?: boolean },
    onDone?: (reportDir: string) => void
  ): void {
    void runRunner(this._root, args, {
      ...options,
      onUpdate: (update) => {
        if (update.dir) {
          run.dir = update.dir;
        }
        if (update.progress) {
          run.progress = update.progress;
        }
        if (update.tokens) {
          run.tokens = update.tokens;
        }
        run.screens = applyScreens(run.screens, update);
        if (update.line) {
          run.lastLine = update.line;
        }
      },
    }).then(async (result) => {
      if (!result.reportDir) {
        run.state = "failed";
        run.error = lastLine(result.output) || "The runner did not produce a report.";
        return;
      }
      run.reportDir = result.reportDir;
      try {
        const report = JSON.parse(
          await readFile(path.join(this._reportsDir, result.reportDir, "report.json"), "utf8")
        ) as { status: Verdict };
        run.verdict = report.status;
      } catch {
        run.verdict = result.code === 0 ? "pass" : "fail";
      }
      run.state = "done";
      onDone?.(result.reportDir);
    });
  }
}
