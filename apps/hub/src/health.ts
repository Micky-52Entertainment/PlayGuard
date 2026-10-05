import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { lanIPv4 } from "./lan.ts";

export interface HealthReport {
  /** What the checks run in: Playwright's own Chromium, the installed Google Chrome, or nothing. */
  browser: "bundled" | "chrome" | "none";
  /** Reports get a video only with the bundled browser and ffmpeg. */
  video: boolean;
  /** WebKit, Safari's engine, is installed: iPhone and iPad screens run in it. */
  webkit: boolean;
  /** False when this computer has no network address a phone could reach. */
  lan: boolean;
  /** What is not on this computer yet and can be downloaded with one confirmation. */
  missing: Component[];
  /** Rough size of that download, in megabytes. */
  downloadMb: number;
  install: InstallState;
}

export type Component = "browser" | "video" | "webkit";

export interface InstallState {
  state: "idle" | "running" | "failed";
  /** What is being downloaded right now, e.g. "Webkit". */
  step?: string;
  percent?: number;
  error?: string;
}

const PACKAGE: Record<Component, string> = { browser: "chromium", video: "ffmpeg", webkit: "webkit" };
const SIZE_MB: Record<Component, number> = { browser: 220, video: 2, webkit: 80 };

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
];

/** Is everything the checks need installed on this computer, and the one-click fix when it is not. */
export class Health {
  private _install: InstallState = { state: "idle" };

  public constructor(private readonly _root: string) {}

  public report(): HealthReport {
    const bundled = this._bundledChromium();
    let ffmpeg = false;
    if (bundled.browsersDir) {
      try {
        ffmpeg = readdirSync(bundled.browsersDir).some((name) => name.startsWith("ffmpeg"));
      } catch {
        ffmpeg = false;
      }
    }
    const chrome = CHROME_PATHS.some((file) => existsSync(file));
    const webkit = this._webkit();
    const missing: Component[] = [];
    if (!bundled.installed) {
      missing.push("browser");
    }
    if (!ffmpeg) {
      missing.push("video");
    }
    if (!webkit) {
      missing.push("webkit");
    }
    return {
      browser: bundled.installed ? "bundled" : chrome ? "chrome" : "none",
      // The recorder works with the installed Google Chrome as well as with the bundled browser.
      video: ffmpeg && (bundled.installed || chrome),
      webkit,
      lan: lanIPv4() !== "127.0.0.1",
      missing,
      downloadMb: missing.reduce((total, item) => total + SIZE_MB[item], 0),
      install: this._install,
    };
  }

  /** Downloads whatever is missing. Returns false if a download is already running or nothing is missing. */
  public install(): boolean {
    const missing = this.report().missing;
    if (this._install.state === "running" || missing.length === 0) {
      return false;
    }
    this._install = { state: "running" };
    const packages = missing.map((item) => PACKAGE[item]);
    const child = process.env.PLAYGUARD_RUNNER_JS
      ? // The installed app has no npm scripts: run Playwright's own command line on the app's Node.
        spawn(
          process.env.PLAYGUARD_NODE || process.execPath,
          [path.join(path.dirname(this._require().resolve("playwright/package.json")), "cli.js"), "install", ...packages],
          { cwd: this._root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }
        )
      : spawn(path.join(this._root, "node_modules/.bin/playwright"), ["install", ...packages], {
          cwd: this._root,
          shell: process.platform === "win32",
        });
    let tail = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      tail = (tail + text).slice(-1000);
      const step = /Downloading ([A-Za-z ]+?) (?:v?\d|\(|playwright)/.exec(text);
      const percent = /(\d+)% of/.exec(text);
      if (this._install.state === "running" && (step || percent)) {
        this._install = {
          state: "running",
          step: step ? step[1].trim() : this._install.step,
          percent: percent ? Number(percent[1]) : step ? 0 : this._install.percent,
        };
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      this._install = { state: "failed", error: error.message };
    });
    child.on("close", (code) => {
      const lines = tail.trim().split("\n");
      this._install =
        code === 0 ? { state: "idle" } : { state: "failed", error: lines[lines.length - 1] || `exit code ${code}` };
    });
    return true;
  }

  /** Playwright belongs to the runner: resolve it from there. */
  private _require(): NodeRequire {
    return createRequire(path.join(this._root, "apps/playwright-runner/package.json"));
  }

  private _webkit(): boolean {
    try {
      const require = this._require();
      return existsSync((require("playwright") as { webkit: { executablePath(): string } }).webkit.executablePath());
    } catch {
      return false;
    }
  }

  private _bundledChromium(): { installed: boolean; browsersDir: string | null } {
    try {
      // Ask Playwright where its browser lives.
      const require = this._require();
      const executable = (require("playwright") as { chromium: { executablePath(): string } }).chromium.executablePath();
      let dir = path.dirname(executable);
      while (dir !== path.dirname(dir) && !/^chromium[-_]/.test(path.basename(dir))) {
        dir = path.dirname(dir);
      }
      return {
        installed: existsSync(executable),
        browsersDir: dir === path.dirname(dir) ? null : path.dirname(dir),
      };
    } catch {
      return { installed: false, browsersDir: null };
    }
  }
}
