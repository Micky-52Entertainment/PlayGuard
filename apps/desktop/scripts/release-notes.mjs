#!/usr/bin/env node
// The text of a release page: which file to download, how to open it the first
// time, and the CHANGELOG section of this version. Prints to stdout.
//   node apps/desktop/scripts/release-notes.mjs 1.1.0
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const version = (process.argv[2] || "").replace(/^v/, "");
if (!version) {
  console.error("Usage: release-notes.mjs <version>");
  process.exit(1);
}

// "## 1.1.0 — 6 October 2026" up to the next "## ".
const changelog = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((line) => new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`).test(line));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section: rename "## Unreleased" to it before tagging.`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
if (end === -1) {
  end = lines.length;
}
const changes = lines.slice(start + 1, end).join("\n").trim();

const repo = "https://github.com/Micky-52Entertainment/PlayGuard";
const file = (name) => `[\`PlayGuard-${version}-${name}\`](${repo}/releases/download/v${version}/PlayGuard-${version}-${name})`;

process.stdout.write(`## Download

| Computer | File |
| --- | --- |
| Mac with an Apple chip (M1 and newer) | ${file("mac-arm64.dmg")} |
| Mac with an Intel processor | ${file("mac-x64.dmg")} |
| Windows 10 / 11 | ${file("win-x64.exe")} |

The other files are for automatic updates; you do not need them.

**First start.** The app is not signed with a developer certificate yet, so the system asks once:
- **Mac:** open PlayGuard, press Done, then System Settings → Privacy & Security → **Open Anyway**.
- **Windows:** "Windows protected your PC" → **More info → Run anyway**.

Allow local network access when asked: phones and teammates reach PlayGuard through it. Already installed? Windows updates by itself on quit; on a Mac drag the new version into Applications. Checks and reports are kept.

Full guide and troubleshooting: [docs/INSTALL.md](${repo}/blob/main/docs/INSTALL.md) · по-русски: [КАК-НАЧАТЬ.md](${repo}/blob/main/%D0%9A%D0%90%D0%9A-%D0%9D%D0%90%D0%A7%D0%90%D0%A2%D0%AC.md)

## What's new

${changes}
`);
