import { spawn } from "node:child_process";
import path from "node:path";

export type Lang = "en" | "ru" | "fr";

export const asLang = (value: unknown): Lang => (value === "ru" || value === "fr" ? value : "en");

export interface Progress {
  /** Screens finished and screens planned. */
  done: number;
  total: number;
}

export interface Tokens {
  used: number;
  limit: number;
  calls: number;
}

/** One screen of a run: planned, then done with its verdict and last picture. */
export interface ScreenTile {
  id: string;
  name: string;
  w: number;
  h: number;
  orientation: string;
  scenario?: string;
  /** A language run: the phone's language code. */
  language?: string;
  /** An old-phone run: which one it stands for. */
  old?: string;
  status?: "pass" | "warn" | "fail";
  /** Path under reports/ of the screen's last picture. */
  shot?: string | null;
}

/** Folds a runner update into a list of tiles. */
export const applyScreens = (tiles: ScreenTile[] | undefined, update: RunnerUpdate): ScreenTile[] | undefined => {
  if (update.screens) {
    return update.screens;
  }
  if (!update.screen) {
    return tiles;
  }
  const list = tiles ? tiles.slice() : [];
  const index = list.findIndex((tile) => tile.id === update.screen!.id);
  const done = { status: update.screen.status, shot: update.screen.shot };
  if (index === -1) {
    list.push({ id: update.screen.id, name: update.screen.id, w: 390, h: 844, orientation: "portrait", ...done });
  } else {
    list[index] = { ...list[index], ...done };
  }
  return list;
};

export interface RunnerUpdate {
  screens?: ScreenTile[];
  screen?: { id: string; status: "pass" | "warn" | "fail"; shot: string | null };
  progress?: Progress;
  tokens?: Tokens;
  /** The runner's latest line of plain output, e.g. what the AI tester just did. */
  line?: string;
}

export interface RunnerResult {
  code: number | null;
  /** The end of the runner's output, without the progress lines. */
  output: string;
  /** Folder name under reports/, when a report was written. */
  reportDir: string | null;
}

/** How deep a check goes: the main screens only, or everything before a release. */
export type Depth = "quick" | "full";

export const asDepth = (value: unknown): Depth | undefined => (value === "quick" || value === "full" ? value : undefined);

/** Options every run gets, from the operator's settings, for the depth asked for. */
export const runnerDefaults: { argsFor: (depth?: Depth) => string[] } = { argsFor: () => [] };

/** The runner's last line of output: what it died of. */
export const lastLine = (output: string): string => {
  const lines = output.trim().split("\n");
  return lines[lines.length - 1] || "";
};

/**
 * Runs the Playwright runner in a child process and follows its progress
 * lines. Exit codes 0 and 1 both mean a report was written.
 */
export const runRunner = (
  root: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    onUpdate?: (update: RunnerUpdate) => void;
    /** Leave out today's settings: a screen checked again runs as its check first did. */
    noDefaults?: boolean;
    /** Quick before sending, or full before a release; the setting's choice when left out. */
    depth?: Depth;
  } = {}
): Promise<RunnerResult> =>
  new Promise((resolve) => {
    const child = spawn(
      path.join(root, "node_modules/.bin/tsx"),
      [path.join(root, "apps/playwright-runner/src/index.ts"), ...args, ...(options.noDefaults ? [] : runnerDefaults.argsFor(options.depth))],
      {
        cwd: root,
        env: { ...process.env, ...options.env, INIT_CWD: root },
        shell: process.platform === "win32",
      }
    );
    let output = "";
    let pending = "";
    const collect = (chunk: Buffer): void => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.startsWith("@@screens ") || line.startsWith("@@screen ")) {
          try {
            const data = JSON.parse(line.slice(line.indexOf(" ") + 1));
            options.onUpdate?.(line.startsWith("@@screens ") ? { screens: data } : { screen: data });
          } catch {
            // A malformed line only costs a picture.
          }
          continue;
        }
        const progress = /^@@progress (\d+) (\d+)/.exec(line);
        const tokens = /^@@tokens (\d+) (\d+) (\d+)/.exec(line);
        if (progress) {
          options.onUpdate?.({ progress: { done: Number(progress[1]), total: Number(progress[2]) } });
        } else if (tokens) {
          options.onUpdate?.({
            tokens: { used: Number(tokens[1]), limit: Number(tokens[2]), calls: Number(tokens[3]) },
          });
        } else {
          output = `${output}${line}\n`.slice(-4000);
          if (line.trim()) {
            options.onUpdate?.({ line: line.trim() });
          }
        }
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => resolve({ code: null, output: error.message, reportDir: null }));
    child.on("close", (code) => {
      output = `${output}${pending}`.slice(-4000);
      const match = /(?:PASS|WARN|FAIL)\s+(.+)[/\\]index\.html\s*$/m.exec(output.trim());
      resolve({
        code,
        output,
        reportDir: (code === 0 || code === 1) && match ? path.basename(match[1]) : null,
      });
    });
  });
