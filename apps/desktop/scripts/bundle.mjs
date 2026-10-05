#!/usr/bin/env node
// Builds the app folder electron-builder packs (stage/): the hub and the runner
// as plain JavaScript, the built console, and a copy of the repo layout the hub
// reads its files from (PLAYGUARD_ROOT points here in the installed app).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DESKTOP, "../..");
const STAGE = path.join(DESKTOP, "stage");
const WINDOWS = process.platform === "win32";

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: WINDOWS });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed`);
    process.exit(result.status ?? 1);
  }
};

const desktop = JSON.parse(readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const lockedVersion = (name) => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (!version) {
    throw new Error(`${name} is not in package-lock.json: run npm install at the repo root`);
  }
  return version;
};

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, "out"), { recursive: true });

// 1. The console, built the same way `npm start` builds it.
run("npm", ["run", "build", "-w", "@playable-lab/lab-console"], ROOT);

// 2. Hub and runner: one ESM file each. Playwright stays a real package, since it
// finds its browsers and helper files next to itself.
const NODE_SHIM = [
  'import { createRequire as __pgCreateRequire } from "node:module";',
  'import { fileURLToPath as __pgFileURLToPath } from "node:url";',
  'import { dirname as __pgDirname } from "node:path";',
  "const require = __pgCreateRequire(import.meta.url);",
  "const __filename = __pgFileURLToPath(import.meta.url);",
  "const __dirname = __pgDirname(__filename);",
].join("\n");
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["playwright", "playwright-core", "electron", "bufferutil", "utf-8-validate", "fsevents"],
  banner: { js: NODE_SHIM },
  logLevel: "warning",
  legalComments: "none",
};
await build({ ...common, entryPoints: [path.join(ROOT, "apps/hub/src/index.ts")], outfile: path.join(STAGE, "out/hub.mjs") });
await build({ ...common, entryPoints: [path.join(ROOT, "apps/playwright-runner/src/index.ts")], outfile: path.join(STAGE, "out/runner.mjs") });

// 3. The Electron side.
const electronCommon = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron", "electron-updater"], logLevel: "warning" };
await build({ ...electronCommon, entryPoints: [path.join(DESKTOP, "src/main.ts")], outfile: path.join(STAGE, "main.cjs") });
await build({ ...electronCommon, entryPoints: [path.join(DESKTOP, "src/preload.cts")], outfile: path.join(STAGE, "preload.cjs") });

// 4. The files the hub and runner read at run time, at the same paths as in the repo.
const copy = (from) => cpSync(path.join(ROOT, from), path.join(STAGE, from), { recursive: true });
copy("apps/lab-console/dist");
copy("apps/lab-console/public/favicon.png");
copy("samples/playable");
cpSync(path.join(DESKTOP, "resources/icon.png"), path.join(STAGE, "icon.png"));
// Health asks Playwright where its browsers are "from the runner's folder".
mkdirSync(path.join(STAGE, "apps/playwright-runner"), { recursive: true });
writeFileSync(path.join(STAGE, "apps/playwright-runner/package.json"), JSON.stringify({ name: "runner", private: true }) + "\n");

// 5. The app's own package.json and its few real dependencies.
writeFileSync(
  path.join(STAGE, "package.json"),
  JSON.stringify(
    {
      name: "playguard",
      productName: desktop.productName,
      version: desktop.version,
      description: desktop.description,
      author: desktop.author,
      main: "main.cjs",
      dependencies: {
        playwright: lockedVersion("playwright"),
        "electron-updater": desktop.devDependencies["electron-updater"],
      },
    },
    null,
    2
  ) + "\n"
);
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], STAGE);

console.log(`Bundled PlayGuard ${desktop.version} into ${path.relative(ROOT, STAGE)}`);
