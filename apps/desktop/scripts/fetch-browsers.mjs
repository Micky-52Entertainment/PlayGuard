#!/usr/bin/env node
// Downloads the browsers the installer carries (Chromium, WebKit and the video
// encoder) into apps/desktop/browsers, for this computer's platform and chip.
// Run it on the same kind of machine the installer is for.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BROWSERS = path.join(DESKTOP, "browsers");
// The Playwright the app ships with, so browser and library versions match.
const CLI = path.join(DESKTOP, "stage/node_modules/playwright/cli.js");

if (!existsSync(CLI)) {
  console.error("Run `npm run bundle` first: the browsers must match the bundled Playwright.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [CLI, "install", "chromium", "webkit", "ffmpeg"], {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS },
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Three things in the downloaded browsers break the Mac app's signature, and
// macOS then calls the downloaded app "damaged". None of them is needed:
// - empty folders, which the installer drops, leaving links to them dangling
//   (WebKit's Versions/A/Frameworks);
// - those dangling links;
// - "._name" files (macOS metadata stored as files, one ships in WebKit), which
//   are signed but dropped when the app is copied out of the .dmg.
const pruneEmpty = (dir) => {
  let empty = true;
  for (const name of readdirSync(dir)) {
    const item = path.join(dir, name);
    const info = lstatSync(item);
    if (name.startsWith("._") && info.isFile()) {
      unlinkSync(item);
      continue;
    }
    if (info.isDirectory() && !info.isSymbolicLink()) {
      if (pruneEmpty(item)) {
        rmdirSync(item);
        continue;
      }
    }
    empty = false;
  }
  return empty;
};
const pruneDangling = (dir) => {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const item = path.join(dir, name);
    const info = lstatSync(item);
    if (info.isSymbolicLink()) {
      try {
        statSync(item);
      } catch {
        unlinkSync(item);
        removed += 1;
      }
    } else if (info.isDirectory()) {
      removed += pruneDangling(item);
    }
  }
  return removed;
};
pruneEmpty(BROWSERS);
// Removing a link can leave another one pointing at it: repeat until none is left.
while (pruneDangling(BROWSERS) > 0) {}
