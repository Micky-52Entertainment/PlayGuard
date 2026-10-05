import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isWriting } from "./runner.ts";

/** A check that stopped before its report was written, and can be continued. */
export interface InterruptedCheck {
  /** Its folder under reports/. */
  dir: string;
  name: string;
  startedAt: number;
  /** Screens finished before it stopped. */
  done: number;
  total: number | null;
  by?: string;
  /** "replay": a recorded playthrough replayed; "load": opened on every screen. */
  kind: "replay" | "load";
  /** The recordings it replays, by id. */
  traces: string[];
}

/** How the runner started the check: written into the folder as it begins (runner's RunInfo). */
interface RunInfo {
  argv: string[];
  startedAt?: number;
  name?: string;
  total?: number;
}

const option = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const inputsOf = (argv: string[]): string[] =>
  argv.flatMap((arg, index) => (index > 0 && (argv[index - 1] === "--playable" || argv[index - 1] === "--trace") ? [arg] : []));

/** The command line that continues the check in this folder, or null when it cannot be continued. */
export const resumeArgs = async (reportsDir: string, root: string, dir: string): Promise<string[] | null> => {
  const folder = path.resolve(reportsDir, dir);
  if (path.dirname(folder) !== path.resolve(reportsDir) || existsSync(path.join(folder, "report.json")) || isWriting(dir)) {
    return null;
  }
  let info: RunInfo;
  try {
    info = JSON.parse(await readFile(path.join(folder, "run.json"), "utf8")) as RunInfo;
  } catch {
    return null;
  }
  // Older folders keep no per-screen results; an AI check has no recording to replay.
  if (!info.startedAt || !Array.isArray(info.argv) || info.argv.includes("--autoplay")) {
    return null;
  }
  // The playable or the recording may have been deleted since.
  if (inputsOf(info.argv).some((file) => !existsSync(path.resolve(root, file)))) {
    return null;
  }
  return [...info.argv, "--resume", folder];
};

/** When the check behind a finished report was started. */
export const reportStartedAt = async (reportsDir: string, dir: string, generatedAt: string): Promise<number> => {
  try {
    const info = JSON.parse(await readFile(path.join(reportsDir, dir, "run.json"), "utf8")) as RunInfo;
    if (info.startedAt) {
      return info.startedAt;
    }
  } catch {
    // An older report: only its minute is known.
  }
  const minute = Date.parse(generatedAt.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(minute) ? 0 : minute + 59999;
};

/** Checks that stopped half-way: the hub or the computer went down, or the browser crashed. */
export const findInterrupted = async (
  reportsDir: string,
  root: string,
  /** Folders something else continues itself: an archive's builds. */
  owned: (dir: string) => boolean
): Promise<InterruptedCheck[]> => {
  let names: string[] = [];
  try {
    names = await readdir(reportsDir);
  } catch {
    return [];
  }
  const found: InterruptedCheck[] = [];
  for (const dir of names) {
    if (owned(dir) || !(await resumeArgs(reportsDir, root, dir))) {
      continue;
    }
    const folder = path.join(reportsDir, dir);
    const info = JSON.parse(await readFile(path.join(folder, "run.json"), "utf8")) as RunInfo;
    let done = 0;
    for (const entry of await readdir(folder)) {
      if (existsSync(path.join(folder, entry, "result.json"))) {
        done += 1;
      }
    }
    found.push({
      dir,
      name: info.name || dir,
      startedAt: info.startedAt!,
      done,
      total: info.total ?? null,
      by: option(info.argv, "--by"),
      kind: info.argv.includes("--trace") ? "replay" : "load",
      traces: info.argv.flatMap((arg, index) => (index > 0 && info.argv[index - 1] === "--trace" ? [path.basename(arg, ".json")] : [])),
    });
  }
  return found.sort((a, b) => b.startedAt - a.startedAt);
};
