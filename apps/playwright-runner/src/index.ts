import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectEngine, describeEngine } from "@playable-lab/adapters";
import {
  detectNetwork,
  htmlByteSize,
  isTelemetry,
  networkById,
  AUDIBLE_PEAK,
  analyseWeight,
  formatBytes,
  overallStatus,
  runPerfChecks,
  runRuntimeChecks,
  runStaticChecks,
  runTraceChecks,
} from "@playable-lab/checks";
import type {
  AdNetworkProfile,
  AudioEvidence,
  BundleInfo,
  ExpectedApps,
  CheckResult,
  ObservedRequest,
  RuntimeEvidence,
} from "@playable-lab/checks";
import { DEVICE_CATALOG, FORMAT_SET, PLATFORMS, devicesById, platformOf } from "@playable-lab/device-catalog";
import type { Platform } from "@playable-lab/device-catalog";
import { clamp01, deviceCssSize } from "@playable-lab/input-mapper";
import { AD_SDK_MOCK_SOURCE, PLAYABLE_BRIDGE_SOURCE, wrapPlayableHtml } from "@playable-lab/playable-host";
import { PROTOCOL_VERSION } from "@playable-lab/protocol";
import type { AdEvent, DeviceProfile, Orientation, PointerSample, Rect, SessionTrace } from "@playable-lab/protocol";
import { defaultTestChain } from "@playable-lab/test-chain";
import { chromium, webkit } from "playwright";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { AI_PROVIDERS, aiCheck, createProvider } from "./ai.ts";
import type { AiRunInfo, Lang } from "./ai.ts";
import { analyse, frameDifference } from "./frames.ts";
import { AiSetupError, pilot, review } from "./pilot.ts";
import type { AiSettings } from "./pilot.ts";
import { buildReplayPlan } from "./plan.ts";
import type { ReplayAction, ReplayPlan, TouchPoint } from "./plan.ts";
import { renderReport } from "./report.ts";
import type { ConsoleLine, DeviceRun, RunReport, Shot } from "./report.ts";
import { SCENARIOS, memoryCheck, runScenario, stressCheck } from "./stress.ts";
import type { Scenario, StressResult } from "./stress.ts";
import { summarize, summaryLines } from "./summary.ts";
import { LANGUAGE_NAMES, LOCALES, TEXT_PROBE_SOURCE, languageChecks, readableStrings, screenMarks, textFitCheck } from "./text.ts";
import type { TextSnapshot } from "./text.ts";
import { OLD_PROFILES, oldBrowserScript, oldCodeCheck, scanFeatures } from "./compat.ts";
import type { OldProfile } from "./compat.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Recordings, uploads and reports: the project folder unless the hub runs on a separate one. */
const DATA = process.env.PLAYGUARD_DATA ? path.resolve(process.env.PLAYGUARD_DATA) : ROOT;
// npm runs workspace scripts from the package folder; paths on the command line
// are relative to where the operator typed them.
const USER_CWD = process.env.INIT_CWD || process.cwd();
const LOCAL_ORIGIN = "http://localhost:47871";
const SMOKE_DEVICES = FORMAT_SET;
const FALLBACK_DEVICES = ["pixel-7", "iphone-14", "ipad-pro-11"];

const USAGE = `Replay a recorded trace on a device matrix, run the checks, write an HTML report.

  npm run replay -- --trace traces/<session>.json [options]
  npm run check  -- --playable path/to/playable.html [options]     (no trace: load-only smoke run)
  npm run autoplay -- --playable path/to/playable.html [options]   (an AI plays it, portrait and landscape)

Options
  --network <id>        applovin | unity | meta | mintegral | google | tiktok | liftoff
                        (default: guessed from the file name)
  --devices <ids|all>   comma-separated device ids (default: the screens mirrored while recording)
  --orientation <o>     portrait | landscape | both (smoke run only; a trace keeps its own)
  --playable <file>     HTML to test instead of the one the trace was recorded on
  --bundle              the HTML is the entry of a multi-file build: serve its folder with it
  --zip-bytes <n>       size of the archive that build ships as (with --bundle)
  --name <text>         name to show in the report instead of the file name
  --url <url>           test a served playable instead of a file
  --require-cta         fail when the replay does not end in a store call
  --allow-external      let requests to other hosts through (default: answered empty and reported)
  --speed <n>           replay speed multiplier (default 1)
  --max-gap <ms>        shorten idle pauses longer than this
  --lead-in <ms>        delay before the first event of a trace without load-relative time (default 1500)
  --settle <ms>         how long a smoke run waits before the final frame (default 4000)
  --no-video            do not record video
  --headed              show the browser
  --channel <name>      browser channel, e.g. chrome (default: bundled Chromium, then Chrome)
  --out <dir>           report root (default: reports)
  --stress [list]       also run the stress scenarios on one phone screen: idle (nobody touches it),
                        monkey (random taps), rotate (turned during play).
                        A list picks some: --stress idle,rotate
  --idle <ms>           how long the idle scenario waits (default 30000)
  --store-ios <link>    the app's App Store link or id: the install link is compared with it
  --store-android <link>  the app's Google Play link or package name
  --platforms <list>    only these kinds of device: android, ios, tablet, foldable
  --no-webkit           run iPhone and iPad screens in Chromium even when WebKit (Safari's engine) is installed
  --by <name>           who runs the check, shown in the history
  --lang <en|ru|fr>     language of the plain summary at the top of the report (default en)

Autoplay
  --ai <provider>       claude | gpt | monkey (random taps, no model, no tokens) (default claude)
  --model <id>          model to use (default claude-opus-5-5, or gpt-5-mini / $OPENAI_MODEL)
  --ai-devices <ids|all>  screens the AI plays itself (default pixel-7). The other screens
                        replay its inputs for free and get one AI look at the result.
  --max-turns <n>       model calls per AI playthrough (default 14)
  --budget <tokens>     stop asking the model once the run has used this many tokens (default 80000)
  --ai-image <px>       longest side of the screenshots the model gets (default 640)
  --no-review           skip the AI look at replayed screens
  --parallel <n>        replays running at once (default 3)
  --headless            do not show the window the AI plays in
`;

const argv = process.argv.slice(2);

const flag = (name: string): boolean => {
  const index = argv.indexOf(name);
  return index !== -1 && argv[index + 1] !== "0";
};

const option = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const next = argv[index + 1];
  return next && !next.startsWith("--") ? next : undefined;
};

/** Every value of an option that may be given more than once. */
const options = (name: string): string[] => {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === name && next && !next.startsWith("--")) {
      values.push(next);
    }
  }
  return values;
};

const numberOption = (name: string): number | undefined => {
  const raw = option(name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} expects a number, got "${raw}"`);
  }
  return parsed;
};

const userPath = (value: string): string => path.resolve(USER_CWD, value);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const slug = (value: string): string =>
  value
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "playable";

const stamp = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

// Runs in the page. Kept as source text so the TS toolchain cannot rewrite it.
const PROBE_SOURCE = `
(function () {
  if (window.__labProbe) return;
  var probe = window.__labProbe = { frames: 0, longest: 0, start: 0, last: 0 };
  function tick(now) {
    if (probe.last) {
      var delta = now - probe.last;
      if (delta > probe.longest) probe.longest = delta;
    } else {
      probe.start = now;
    }
    probe.last = now;
    probe.frames += 1;
    requestAnimationFrame(tick);
  }
  window.addEventListener("load", function () { requestAnimationFrame(tick); });
})();
`;

// Measures what the page actually sends to the speakers, in three parts of a
// run: before the first touch, after it, and while the ad is hidden.
const AUDIO_PROBE_SOURCE = `
(function () {
  if (window.__labAudio) return;
  window.__playableLabKeepSound = true;
  var taps = [];
  var played = [];
  var state = { phase: "pre", pre: 0, play: 0, hidden: 0, hiddenAt: 0, lastHeard: 0 };
  function tapFor(ctx) {
    for (var i = 0; i < taps.length; i += 1) if (taps[i].ctx === ctx) return taps[i];
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    var tap = { ctx: ctx, analyser: analyser, data: new Float32Array(1024) };
    taps.push(tap);
    return tap;
  }
  try {
    var connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target) {
      try {
        var ctx = target && target.context;
        var offline = typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;
        if (ctx && !offline && target === ctx.destination) {
          connect.call(this, tapFor(ctx).analyser);
        }
      } catch (_) {}
      return connect.apply(this, arguments);
    };
  } catch (_) {}
  try {
    var play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (played.indexOf(this) === -1) played.push(this);
      return play.apply(this, arguments);
    };
  } catch (_) {}
  function level() {
    var peak = 0;
    var i;
    var j;
    for (i = 0; i < taps.length; i += 1) {
      if (taps[i].ctx.state !== "running") continue;
      try {
        taps[i].analyser.getFloatTimeDomainData(taps[i].data);
        for (j = 0; j < taps[i].data.length; j += 1) {
          var v = Math.abs(taps[i].data[j]);
          if (v > peak) peak = v;
        }
      } catch (_) {}
    }
    var list = played.slice();
    var inPage = document.querySelectorAll("audio,video");
    for (i = 0; i < inPage.length; i += 1) if (list.indexOf(inPage[i]) === -1) list.push(inPage[i]);
    for (i = 0; i < list.length; i += 1) {
      var el = list[i];
      var silentVideo = el.tagName === "VIDEO" && el.webkitAudioDecodedByteCount === 0;
      if (!el.paused && !el.ended && !el.muted && el.volume > 0 && el.readyState > 2 && !silentVideo) {
        peak = Math.max(peak, el.volume);
      }
    }
    return peak;
  }
  setInterval(function () {
    var now = Date.now();
    var v = level();
    if (v > ${AUDIBLE_PEAK}) state.lastHeard = now;
    if (state.phase === "hidden") {
      // Give the playable a moment to react to being hidden.
      if (now - state.hiddenAt > 600 && v > state.hidden) state.hidden = v;
    } else if (v > state[state.phase]) {
      state[state.phase] = v;
    }
  }, 120);
  ["pointerdown", "touchstart", "mousedown", "keydown"].forEach(function (name) {
    window.addEventListener(name, function () {
      if (state.phase === "pre") state.phase = "play";
    }, true);
  });
  function setHidden(hidden) {
    try {
      if (hidden) {
        Object.defineProperty(document, "hidden", { configurable: true, get: function () { return true; } });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "hidden"; } });
      } else {
        delete document.hidden;
        delete document.visibilityState;
      }
    } catch (_) {}
    try { document.dispatchEvent(new Event("visibilitychange")); } catch (_) {}
    try { window.dispatchEvent(new Event(hidden ? "blur" : "focus")); } catch (_) {}
    try { if (window.__labAdContainer) window.__labAdContainer.setViewable(!hidden); } catch (_) {}
  }
  window.__labAudio = {
    read: function () { return { pre: state.pre, play: state.play }; },
    heardLately: function () { return Date.now() - state.lastHeard < 1500; },
    hide: function () {
      state.before = state.phase;
      state.phase = "hidden";
      state.hidden = 0;
      state.hiddenAt = Date.now();
      setHidden(true);
    },
    show: function () {
      state.phase = state.before || "play";
      setHidden(false);
      return state.hidden;
    }
  };
})();
`;

// Counts calls to the browser features ads may not use. Everything still works as
// it would: the playable must not behave differently because it is watched.
const API_PROBE_SOURCE = `
(function () {
  if (window.__labApis) return;
  var calls = window.__labApis = {};
  function note(name) { calls[name] = (calls[name] || 0) + 1; }
  function wrap(owner, prop, name) {
    try {
      var original = owner && owner[prop];
      if (typeof original !== "function") return;
      owner[prop] = function () { note(name); return original.apply(this, arguments); };
    } catch (_) {}
  }
  if (window.Geolocation) {
    wrap(Geolocation.prototype, "getCurrentPosition", "geolocation");
    wrap(Geolocation.prototype, "watchPosition", "geolocation");
  }
  if (window.MediaDevices) wrap(MediaDevices.prototype, "getUserMedia", "camera");
  wrap(navigator, "getUserMedia", "camera");
  wrap(navigator, "webkitGetUserMedia", "camera");
  if (window.Notification) wrap(Notification, "requestPermission", "notifications");
  wrap(Navigator.prototype, "vibrate", "vibrate");
  wrap(Navigator.prototype, "share", "share");
  if (window.Clipboard) {
    wrap(Clipboard.prototype, "writeText", "clipboard");
    wrap(Clipboard.prototype, "write", "clipboard");
  }
  ["alert", "confirm", "prompt"].forEach(function (name) { wrap(window, name, "dialog"); });
  try {
    var setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      var session = false;
      try { session = this === window.sessionStorage; } catch (_) {}
      note(session ? "sessionStorage" : "localStorage");
      return setItem.apply(this, arguments);
    };
  } catch (_) {}
  if (window.IDBFactory) wrap(IDBFactory.prototype, "open", "indexedDB");
  try {
    var cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    if (cookie && cookie.set) {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get: cookie.get,
        set: function (value) { note("cookies"); return cookie.set.call(this, value); }
      });
    }
  } catch (_) {}
})();
`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".atlas": "text/plain",
  ".bin": "application/octet-stream",
};

const listFiles = async (root: string, prefix = ""): Promise<string[]> => {
  const out: string[] = [];
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  for (let i = 0; i < entries.length; i += 1) {
    const relative = prefix ? `${prefix}/${entries[i].name}` : entries[i].name;
    if (entries[i].isDirectory()) {
      out.push(...(await listFiles(root, relative)));
    } else {
      out.push(relative);
    }
  }
  return out;
};

interface PlayableSource {
  name: string;
  engine: string;
  /** Folder the rest of a multi-file build is served from. */
  bundleRoot?: string;
  bundle?: BundleInfo;
  /** Present when the playable is a file the runner serves itself. */
  html?: string;
  entryUrl: string;
  origin: string;
}

/** A recording made on a build of an uploaded archive: that build's entry file, and its zip size if it ships as one. */
const archiveBuild = async (playableId: string): Promise<{ file: string; zipBytes?: number } | undefined> => {
  const match = /^(b_[a-z0-9]+_\d+)_(\d+)$/.exec(playableId);
  if (!match) {
    return undefined;
  }
  try {
    const dir = path.join(DATA, "batches", match[1]);
    const batch = JSON.parse(await readFile(path.join(dir, "batch.json"), "utf8")) as {
      builds: Array<{ id: string; kind: string; bytes: number; entry: string }>;
    };
    const build = batch.builds.find((item) => item.id === match[2]);
    if (!build || !existsSync(path.join(dir, build.entry))) {
      return undefined;
    }
    return { file: path.join(dir, build.entry), zipBytes: build.kind === "zip" ? build.bytes : undefined };
  } catch {
    return undefined;
  }
};

const resolvePlayable = async (trace: SessionTrace | undefined): Promise<PlayableSource> => {
  const url = option("--url");
  if (url) {
    const parsed = new URL(url);
    return {
      name: trace?.playable.name || parsed.pathname.split("/").pop() || parsed.host,
      engine: trace ? describeEngine(trace.playable.engine) : "served over HTTP",
      entryUrl: url,
      origin: parsed.origin,
    };
  }

  let html: string | undefined;
  let fromArchive: { file: string; zipBytes?: number } | undefined;
  let name = trace?.playable.name || "playable.html";
  const file = option("--playable");
  if (file) {
    html = await readFile(userPath(file), "utf8");
    name = path.basename(file);
    // Hub uploads are stored as <id>/source.html with the real name beside them.
    try {
      const meta = JSON.parse(await readFile(path.join(path.dirname(userPath(file)), "meta.json"), "utf8"));
      name = String(meta.name || name);
    } catch {
      // A plain file outside playables/.
    }
  } else if (trace) {
    // Traces written before the hub stopped embedding the HTML still carry it.
    const embedded = (trace.playable as { html?: unknown }).html;
    const stored = path.join(DATA, "playables", trace.playable.id, "source.html");
    fromArchive = await archiveBuild(trace.playable.id);
    if (trace.playable.id === "sample-tap") {
      html = await readFile(path.join(ROOT, "samples/playable/index.html"), "utf8");
    } else if (existsSync(stored)) {
      html = await readFile(stored, "utf8");
    } else if (fromArchive) {
      html = await readFile(fromArchive.file, "utf8");
    } else if (typeof embedded === "string" && embedded) {
      html = embedded;
    }
  }
  if (html === undefined) {
    throw new Error(
      trace
        ? `Playable "${trace.playable.id}" is not in playables/. Pass --playable <file> or --url <url>.`
        : "Nothing to test. Pass --trace <file>, --playable <file> or --url <url>."
    );
  }
  let bundleRoot: string | undefined;
  let bundle: BundleInfo | undefined;
  let entryName = "index.html";
  const bundleFile = file && flag("--bundle") ? userPath(file) : fromArchive?.zipBytes ? fromArchive.file : undefined;
  if (bundleFile) {
    bundleRoot = path.dirname(bundleFile);
    entryName = path.basename(bundleFile);
    const files = await listFiles(bundleRoot);
    const scripts: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      if (/\.m?js$/i.test(files[i])) {
        scripts.push(await readFile(path.join(bundleRoot, files[i]), "utf8"));
      }
    }
    const sizes: Array<{ name: string; bytes: number }> = [];
    for (let i = 0; i < files.length; i += 1) {
      if (files[i] !== "meta.json") {
        sizes.push({ name: files[i], bytes: statSync(path.join(bundleRoot, files[i])).size });
      }
    }
    bundle = {
      sizes,
      zipBytes: numberOption("--zip-bytes") ?? fromArchive?.zipBytes ?? 0,
      files: files.filter((item) => item !== "meta.json"),
      entry: entryName,
      scripts: scripts.join("\n"),
    };
  }
  return {
    name: option("--name") || name,
    engine: describeEngine(detectEngine(html, name)),
    html,
    bundleRoot,
    bundle,
    entryUrl: `${LOCAL_ORIGIN}/${encodeURIComponent(entryName)}`,
    origin: LOCAL_ORIGIN,
  };
};

const resolveDevices = (trace: SessionTrace | undefined): DeviceProfile[] => {
  const catalog = devicesById();
  const raw = option("--devices");
  let ids: string[];
  if (raw === "all") {
    ids = DEVICE_CATALOG.map((device) => device.id);
  } else if (raw) {
    ids = raw.split(",").filter(Boolean);
  } else if (trace) {
    const step = defaultTestChain().steps.find((item) => item.id === trace.stepId);
    const mirrored = (trace.deviceIds || []).filter((id) => catalog.has(id));
    // Check the screens the operator was looking at while recording.
    ids = mirrored.length > 0 ? mirrored : step ? step.deviceIds : FALLBACK_DEVICES;
  } else {
    ids = SMOKE_DEVICES;
  }
  const devices: DeviceProfile[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const device = catalog.get(ids[i]);
    if (!device) {
      throw new Error(
        `Unknown device "${ids[i]}". Known: ${DEVICE_CATALOG.map((item) => item.id).join(", ")}`
      );
    }
    devices.push(device);
  }
  // The platforms the team turned off in Settings are left out, whatever the list said.
  const raw_platforms = option("--platforms");
  if (raw_platforms) {
    const wanted = raw_platforms.split(",").filter((item): item is Platform => (PLATFORMS as string[]).includes(item));
    const kept = devices.filter((device) => wanted.includes(platformOf(device)));
    if (kept.length === 0) {
      throw new Error(
        `No screens left to check: the platforms turned on (${wanted.join(", ") || "none"}) have none of the chosen screens. Turn a platform on in Settings.`
      );
    }
    return kept;
  }
  return devices;
};

const resolveOrientations = (trace: SessionTrace | undefined): Orientation[] => {
  if (trace) {
    return [trace.orientationLock];
  }
  const raw = option("--orientation") || "both";
  if (raw === "both") {
    return ["portrait", "landscape"];
  }
  if (raw !== "portrait" && raw !== "landscape") {
    throw new Error(`--orientation expects portrait, landscape or both, got "${raw}"`);
  }
  return [raw];
};

const launch = async (headless: boolean): Promise<Browser> => {
  const channel = option("--channel");
  // An ad container lets sound start without a touch; with the browser's own
  // block in place a playable that breaks the "silent until touched" rule would pass.
  const args = ["--autoplay-policy=no-user-gesture-required"];
  if (channel) {
    return chromium.launch({ headless, channel, args });
  }
  try {
    return await chromium.launch({ headless, args });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Executable doesn't exist")) {
      throw error;
    }
    console.warn("Bundled Chromium is not installed (npx playwright install chromium); using Google Chrome.");
    return chromium.launch({ headless, channel: "chrome", args });
  }
};

/** WebKit, the engine of Safari, for the iPhone and iPad screens. Undefined when it is not installed. */
const launchWebkit = async (): Promise<Browser | undefined> => {
  try {
    return await webkit.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.warn(
      message.includes("Executable doesn't exist")
        ? "WebKit is not installed (npx playwright install webkit): iPhone and iPad screens run in Chromium."
        : `WebKit did not start, iPhone and iPad screens run in Chromium: ${message}`
    );
    return undefined;
  }
};

/**
 * A touch that goes down and comes up in one place is a tap. Returns the index
 * of the action that lifts it, or -1 when the touch turns into a drag or a hold.
 */
const tapEndIndex = (actions: ReplayAction[], start: number): number => {
  const first = actions[start];
  if (first.kind !== "touch" || first.type !== "touchStart" || first.points.length !== 1) {
    return -1;
  }
  for (let i = start + 1; i < actions.length; i += 1) {
    const action = actions[i];
    if (action.kind !== "touch" || action.type === "touchStart") {
      return -1;
    }
    if (action.type === "touchMove") {
      const point = action.points[0];
      if (
        action.points.length !== 1 ||
        Math.abs(point.nx - first.points[0].nx) > 0.015 ||
        Math.abs(point.ny - first.points[0].ny) > 0.015
      ) {
        return -1;
      }
      continue;
    }
    return action.at - first.at <= 700 ? i : -1;
  }
  return -1;
};

interface RunContext {
  browser: Browser;
  helper: Page;
  playable: PlayableSource;
  network?: AdNetworkProfile;
  plan?: ReplayPlan;
  /** Math.random seed of the recorded session. */
  seed?: number;
  expectCta: boolean;
  outDir: string;
  videoDir?: string;
  /** Set for an autoplay run. */
  ai?: AiSettings;
  /** The visible browser the AI plays in; replays stay in `browser`. */
  pilotBrowser?: Browser;
  /** Safari's engine, for the iOS screens; undefined when it is not installed or was turned off. */
  webkit?: Browser;
  /** Why iOS screens are not in WebKit, for the note on those screens. */
  webkitMissing?: "not-installed" | "off";
  idleMs: number;
  /** The app the install button should lead to, when the operator said which. */
  apps: ExpectedApps;
  /** When the recording's last store call came, ms since load: the replay waits at least that long. */
  ctaAt?: number;
  /** The scripts the playable really ran, read on its first Chromium screen: checked for old browsers. */
  sources?: string[];
}

/** What one screen of an autoplay run does. */
interface DeviceJob {
  /** The AI plays here instead of a replay. */
  pilot?: boolean;
  /** Replay this instead of the run's plan: the AI recording nearest in shape. */
  plan?: ReplayPlan;
  /** Ask the AI to look at the screen after the replay. */
  review?: boolean;
  /** Filled by a pilot run: the inputs the AI made. */
  recorded?: { events: PointerSample[]; rect: Rect; startedAt: number };
  /** Put the playable under a condition instead of replaying input. */
  scenario?: Scenario;
  /** Run with the phone set to this language (a code of LOCALES). */
  language?: string;
  /** Play it as on an old phone: the newer browser features taken away. */
  old?: OldProfile;
}

const userAgentFor = (device: DeviceProfile, old?: OldProfile): string => {
  if (old?.safari !== undefined) {
    const major = Math.floor(old.safari);
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${major}_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${major}.0 Mobile/15E148 Safari/604.1`;
  }
  if (old?.chrome !== undefined) {
    return `Mozilla/5.0 (Linux; Android 9; SM-G930F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${old.chrome}.0.0.0 Mobile Safari/537.36`;
  }
  if (device.os === "ios") {
    return device.group === "tablet"
      ? "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
      : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  }
  return device.group === "tablet"
    ? "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
};

const openContext = async (
  run: RunContext,
  browser: Browser,
  device: DeviceProfile,
  cssWidth: number,
  cssHeight: number,
  language?: string,
  old?: OldProfile
): Promise<{ context: BrowserContext; page: Page; video: boolean }> => {
  const base = {
    // The phone's language: what navigator.language, and Unity's systemLanguage, report.
    locale: LOCALES[language || "en"] || "en-US",
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: device.dpr,
    hasTouch: true,
    isMobile: true,
    userAgent: userAgentFor(device, old),
  };
  if (run.videoDir) {
    try {
      const context = await browser.newContext({
        ...base,
        recordVideo: { dir: run.videoDir, size: { width: cssWidth, height: cssHeight } },
      });
      const page = await context.newPage();
      return { context, page, video: true };
    } catch (error) {
      // Video needs Playwright's ffmpeg; carry on without it.
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.warn(
        reason.includes("ffmpeg")
          ? "Video disabled: Playwright's ffmpeg is not installed (npx playwright install ffmpeg)."
          : `Video disabled: ${reason}`
      );
      run.videoDir = undefined;
    }
  }
  const context = await browser.newContext(base);
  const page = await context.newPage();
  return { context, page, video: false };
};

const runDevice = async (
  run: RunContext,
  device: DeviceProfile,
  orientation: Orientation,
  job: DeviceJob = {}
): Promise<DeviceRun> => {
  const { cssWidth, cssHeight } = deviceCssSize(device, orientation);
  const id = `${device.id}-${orientation}${job.scenario ? `-${job.scenario}` : ""}${job.language ? `-lang-${job.language}` : ""}${job.old ? `-old-${job.old.id}` : ""}`;
  const shotDir = path.join(run.outDir, id);
  await mkdir(shotDir, { recursive: true });

  const piloted = Boolean(job.pilot && run.ai);
  const plan = piloted || job.scenario ? undefined : job.plan || run.plan;
  // The AI and the scenarios drive the page through Chromium's own protocol.
  const inWebkit = Boolean(run.webkit && device.os === "ios" && !piloted && !job.scenario);
  const { context, page, video } = await openContext(
    run,
    inWebkit ? (run.webkit as Browser) : (piloted && run.pilotBrowser) || run.browser,
    device,
    cssWidth,
    cssHeight,
    job.language,
    job.old
  );
  const requests: ObservedRequest[] = [];
  const consoleLines: ConsoleLine[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const navigations: AdEvent[] = [];
  const shots: Shot[] = [];
  let loadedAt = 0;

  const note = (text: string): void => {
    consoleLines.push({ type: "runner", text });
  };

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (run.playable.html !== undefined && url === run.playable.entryUrl) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: wrapPlayableHtml(run.playable.html, false, run.seed),
      });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      await route.continue();
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      await route.continue();
      return;
    }
    if (parsed.origin === run.playable.origin) {
      if (run.playable.html === undefined) {
        await route.continue();
        return;
      }
      if (/favicon\.ico$/.test(parsed.pathname)) {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      // Networks inject mraid.js themselves; the lab mock is already in the page.
      if (/(^|\/)mraid\.js$/i.test(parsed.pathname)) {
        await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
        return;
      }
      if (run.playable.bundleRoot) {
        // The rest of a zipped build, straight from its unpacked folder.
        const relative = path.normalize(decodeURIComponent(parsed.pathname)).replace(/^[/\\]+/, "");
        const target = path.join(run.playable.bundleRoot, relative);
        if (target.startsWith(run.playable.bundleRoot + path.sep) && existsSync(target)) {
          await route.fulfill({
            status: 200,
            contentType: MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
            body: await readFile(target),
          });
          return;
        }
      }
      requests.push({ url: parsed.pathname + parsed.search, kind: "missing-local", resourceType: request.resourceType() });
      await route.fulfill({ status: 404, body: "" });
      return;
    }

    let topNavigation = false;
    try {
      topNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      topNavigation = false;
    }
    if (topNavigation) {
      // A store link followed directly instead of through the network's API.
      navigations.push({
        t: Date.now(),
        rt: loadedAt ? Date.now() - loadedAt : 0,
        kind: "cta",
        api: "navigation",
        detail: url,
      });
      await route.abort("aborted");
      return;
    }
    // The network's own SDK has to really load: the build is written against it.
    if (run.network?.passExternal?.some((part) => url.includes(part))) {
      requests.push({ url, kind: "allowed", resourceType: request.resourceType() });
      await route.continue();
      return;
    }
    if (isTelemetry(url)) {
      requests.push({ url, kind: "telemetry", resourceType: request.resourceType() });
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (run.network?.allowedExternal.some((prefix) => url.includes(prefix))) {
      requests.push({ url, kind: "allowed", resourceType: request.resourceType() });
      await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      return;
    }
    requests.push({ url, kind: "external", resourceType: request.resourceType() });
    if (flag("--allow-external")) {
      await route.continue();
    } else {
      // Answered locally with an empty response: nothing leaves the machine, and
      // the playable does not see a network error the lab itself would have caused.
      await route.fulfill({ status: 204, body: "" });
    }
  });

  page.on("console", (message) => {
    const text = message.text();
    if (consoleLines.length < 400) {
      consoleLines.push({ type: message.type(), text });
    }
    // Blocked and missing requests are reported by the network check.
    if (message.type() === "error" && !text.startsWith("Failed to load resource")) {
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack ? error.stack.split("\n").slice(0, 3).join(" ") : error.message);
    if (consoleLines.length < 400) {
      consoleLines.push({ type: "exception", text: error.message });
    }
  });

  await page.addInitScript(PROBE_SOURCE);
  await page.addInitScript(AUDIO_PROBE_SOURCE);
  await page.addInitScript(API_PROBE_SOURCE);
  await page.addInitScript(TEXT_PROBE_SOURCE);
  if (job.old) {
    await page.addInitScript(oldBrowserScript(job.old));
  }
  // The code the playable really runs (packed builds unpack it only at run time), read once.
  let scriptIds: string[] | null = null;
  let scriptSession: CDPSession | null = null;
  if (!run.sources && !inWebkit && !job.scenario && !job.old && !job.language) {
    try {
      scriptSession = await context.newCDPSession(page);
      scriptIds = [];
      const ids = scriptIds;
      scriptSession.on("Debugger.scriptParsed", (event: { scriptId: string }) => {
        if (ids.length < 400) {
          ids.push(event.scriptId);
        }
      });
      await scriptSession.send("Debugger.enable");
    } catch {
      scriptIds = null;
    }
  }
  // Playables pick the store link by platform; the user agent alone leaves navigator.platform saying "Mac".
  await page.addInitScript(
    `try { Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: function () { return ${JSON.stringify(
      device.os === "ios" ? (device.group === "tablet" ? "iPad" : "iPhone") : "Linux armv81"
    )}; } }); } catch (_) {}`
  );
  if (run.playable.html === undefined) {
    const seedFlag = typeof run.seed === "number" ? `window.__playableLabSeed=${run.seed >>> 0};` : "";
    await page.addInitScript(`${seedFlag}\n${AD_SDK_MOCK_SOURCE}\n${PLAYABLE_BRIDGE_SOURCE}`);
  }

  const evidence: RuntimeEvidence = {
    loaded: false,
    pageErrors,
    consoleErrors,
    requests,
    adEvents: [],
    inputs: 0,
    firstInputAt: plan?.firstInputAt,
    expectCta: run.expectCta,
  };

  // The text on screen is read with every picture: a pop-up or an end card has its own.
  const texts: TextSnapshot[] = [];
  // Where the playthrough touched the screen, in page pixels: dots on the report's picture.
  const taps: Array<{ x: number; y: number }> = [];
  const capture = async (label: string): Promise<Buffer | undefined> => {
    const file = `${String(shots.length + 1).padStart(2, "0")}-${slug(label)}.png`;
    try {
      const png = await page.screenshot({ path: path.join(shotDir, file) });
      shots.push({ file: `${id}/${file}`, label });
      if (!job.scenario) {
        try {
          const read = (await page.evaluate("window.__labReadText ? window.__labReadText() : null")) as Omit<TextSnapshot, "label"> | null;
          if (read) {
            // The screen's own size: a page wider than it makes the browser zoom out, which is the problem itself.
            texts.push({ label, shot: `${id}/${file}`, items: read.items, width: cssWidth, height: cssHeight });
          }
        } catch {
          // The page is navigating or gone: no text from this picture.
        }
      }
      return png;
    } catch (error) {
      note(`screenshot failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return undefined;
    }
  };

  let firstFrame: Buffer | undefined;
  let lastFrame: Buffer | undefined;
  let ai: AiRunInfo | undefined;
  let stress: StressResult | undefined;
  let cdp: CDPSession | undefined;


  try {
    await page.goto(run.playable.entryUrl, { waitUntil: "load", timeout: 45000 });
    loadedAt = Date.now();
    evidence.loaded = true;
    evidence.loadMs = (await page.evaluate(
      "Math.round((performance.getEntriesByType('navigation')[0] || {}).loadEventStart || performance.now())"
    )) as number;
  } catch (error) {
    evidence.loadError = error instanceof Error ? error.message.split("\n")[0] : String(error);
  }

  if (evidence.loaded) {
    const actions = plan ? plan.actions : [];
    const firstAt = actions.length ? actions[0].at : Number.POSITIVE_INFINITY;

    // Let the engine draw its first frames, unless input starts sooner.
    await sleep(Math.min(800, firstAt - (Date.now() - loadedAt) - 150));
    firstFrame = await capture("loaded");

    let rect: Rect = { x: 0, y: 0, w: cssWidth, h: cssHeight };
    const refreshRect = async (): Promise<void> => {
      try {
        const measured = (await page.evaluate(
          "window.__playableLabRect ? window.__playableLabRect() : null"
        )) as Rect | null;
        if (measured && measured.w > 0 && measured.h > 0) {
          rect = measured;
        }
      } catch {
        // Keep the previous rect; the page may be mid-navigation.
      }
    };
    const toPx = (nx: number, ny: number): { x: number; y: number } => ({
      x: rect.x + clamp01(nx) * rect.w,
      y: rect.y + clamp01(ny) * rect.h,
    });
    // The page maps each point: through the scene when the recording carries an
    // anchor and the engine is reachable, otherwise by screen fraction.
    const resolve = async (
      points: Array<{ nx: number; ny: number; anchor?: unknown }>
    ): Promise<Array<{ x: number; y: number }>> => {
      if (points.some((point) => point.anchor)) {
        try {
          const mapped = (await page.evaluate(
            `window.__playableLabPoint ? ${JSON.stringify(
              points.map((point) => [clamp01(point.nx), clamp01(point.ny), point.anchor || null])
            )}.map(function (p) { return window.__playableLabPoint(p[0], p[1], p[2]); }) : null`
          )) as Array<{ x: number; y: number }> | null;
          if (mapped) {
            return mapped;
          }
        } catch {
          // Fall through to the screen-fraction mapping.
        }
      }
      return points.map((point) => toPx(point.nx, point.ny));
    };

    if (job.scenario) {
      if (!cdp) {
        cdp = await context.newCDPSession(page);
      }
      stress = await runScenario({
        scenario: job.scenario,
        page,
        cdp,
        helper: run.helper,
        width: cssWidth,
        height: cssHeight,
        capture,
        seed: run.seed || 20240607,
        idleMs: run.idleMs,
        errorCount: () => pageErrors.length,
      });
    }

    // WebKit has no protocol for touches: a tap goes through Playwright's own
    // touchscreen, anything longer is dispatched inside the page.
    const contacts = new Map<number, TouchPoint>();
    const skipped = new Set<number>();
    const inPage = async (samples: unknown[]): Promise<void> => {
      await page.evaluate(
        `(function (list) { if (window.__playableLabReplay) { list.forEach(function (ev) { window.__playableLabReplay(ev); }); } })(${JSON.stringify(samples)})`
      );
    };
    const sample = (phase: string, point: TouchPoint, primary: boolean): unknown => ({
      type: "pointer",
      kind: "touch",
      phase,
      pointerId: point.id,
      nx: clamp01(point.nx),
      ny: clamp01(point.ny),
      anchor: point.anchor,
      pressure: point.force,
      isPrimary: primary,
      pointers: Array.from(contacts.values()).map((item) => ({
        pointerId: item.id,
        nx: clamp01(item.nx),
        ny: clamp01(item.ny),
        anchor: item.anchor,
      })),
    });
    const webkitTouch = async (index: number): Promise<boolean> => {
      const action = actions[index];
      if (action.kind !== "touch") {
        return false;
      }
      if (action.type === "touchStart" && contacts.size === 0) {
        const end = tapEndIndex(actions, index);
        if (end !== -1) {
          const [at] = await resolve(action.points);
          await page.touchscreen.tap(at.x, at.y);
          let shot = false;
          for (let k = index + 1; k <= end; k += 1) {
            skipped.add(k);
            shot = shot || Boolean((actions[k] as { shot?: boolean }).shot);
          }
          return shot;
        }
      }
      const samples: unknown[] = [];
      if (action.type === "touchStart" || action.type === "touchMove") {
        for (let p = 0; p < action.points.length; p += 1) {
          const point = action.points[p];
          const known = contacts.has(point.id);
          const primary = contacts.size === 0 || contacts.keys().next().value === point.id;
          contacts.set(point.id, point);
          if (action.type === "touchMove" || !known) {
            samples.push(sample(known ? "move" : "down", point, primary));
          }
        }
      } else {
        const lifted = action.points.length > 0 ? action.points : Array.from(contacts.values());
        for (let p = 0; p < lifted.length; p += 1) {
          const point = contacts.get(lifted[p].id) || lifted[p];
          const primary = contacts.keys().next().value === point.id;
          contacts.delete(point.id);
          samples.push(sample(action.type === "touchCancel" ? "cancel" : "up", point, primary));
        }
      }
      await inPage(samples);
      return false;
    };

    if (piloted && run.ai) {
      const played = await pilot({
        page,
        cdp: await context.newCDPSession(page),
        helper: run.helper,
        ai: run.ai,
        width: cssWidth,
        height: cssHeight,
        orientation,
        sinceLoad: () => Date.now() - loadedAt,
        capture,
        storeOpened: async () =>
          navigations.length > 0 ||
          ((await page
            .evaluate("(window.__labAdEvents || []).some(function (e) { return e.kind === 'cta'; })")
            .catch(() => false)) as boolean),
        log: (line) => {
          console.log(line);
          reportTokens(run.ai);
        },
      });
      ai = played.info;
      evidence.inputs = played.inputs;
      evidence.firstInputAt = played.firstInputAt;
      job.recorded = { events: played.events, rect: played.rect, startedAt: loadedAt };
    }

    let shotPending = false;
    let failures = 0;
    for (let i = 0; i < actions.length; i += 1) {
      if (skipped.has(i)) {
        continue;
      }
      const action = actions[i];
      let wait = loadedAt + action.at - Date.now();
      if (shotPending) {
        // Give the game a moment to react before the picture, if the trace allows.
        const pause = Math.min(350, wait);
        await sleep(pause);
        await capture(`after input at ${(actions[i - 1].at / 1000).toFixed(1)}s`);
        shotPending = false;
        wait = loadedAt + action.at - Date.now();
      }
      await sleep(wait);

      try {
        if (action.kind === "touch") {
          if (action.type === "touchStart") {
            await refreshRect();
            evidence.inputs += 1;
            if (inWebkit) {
              const [where] = await resolve(action.points.slice(-1));
              if (where) {
                taps.push(where);
              }
            }
          }
          if (inWebkit) {
            if (await webkitTouch(i)) {
              shotPending = true;
            }
            continue;
          }
          if (!cdp) {
            cdp = await context.newCDPSession(page);
          }
          const mapped = await resolve(action.points);
          if (action.type === "touchStart" && mapped.length > 0) {
            taps.push(mapped[mapped.length - 1]);
          }
          await cdp.send("Input.dispatchTouchEvent", {
            type: action.type,
            touchPoints: action.points.map((point, index) => ({
              x: mapped[index].x,
              y: mapped[index].y,
              id: point.id,
              force: point.force,
              radiusX: 8,
              radiusY: 8,
            })),
          });
        } else if (action.kind === "mouse") {
          if (action.type === "down") {
            await refreshRect();
            evidence.inputs += 1;
          }
          const [px] = await resolve([action]);
          await page.mouse.move(px.x, px.y);
          if (action.type === "down") {
            taps.push(px);
            await page.mouse.down();
          } else if (action.type === "up") {
            await page.mouse.up();
          }
        } else if (action.kind === "wheel") {
          const px = toPx(action.nx, action.ny);
          await page.mouse.move(px.x, px.y);
          await page.mouse.wheel(action.deltaX, action.deltaY);
        } else if (action.type === "down") {
          evidence.inputs += 1;
          await page.keyboard.down(action.key);
        } else {
          await page.keyboard.up(action.key);
        }
      } catch (error) {
        failures += 1;
        if (failures <= 5) {
          note(`input ${action.kind} at ${action.at}ms failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        }
      }
      if ((action.kind === "touch" || action.kind === "mouse") && action.shot) {
        shotPending = true;
      }
    }

    await sleep(
      job.scenario
        ? 0
        : piloted
          ? 800
          : actions.length
            ? // A store call can come seconds after the tap that caused it: an end card, a delayed redirect.
              Math.max(1500, run.ctaAt === undefined ? 0 : loadedAt + run.ctaAt + 1500 - Date.now())
            : (numberOption("--settle") ?? 4000) - (Date.now() - loadedAt)
    );
    lastFrame = await capture("final");

    try {
      const recorded = (await page.evaluate("window.__labAdEvents || []")) as AdEvent[];
      evidence.adEvents = [...recorded, ...navigations].sort((a, b) => a.rt - b.rt);
      evidence.apiCalls = ((await page.evaluate("window.__labApis || null")) as Record<string, number> | null) || undefined;
      const probe = (await page.evaluate("window.__labProbe || null")) as
        | { frames: number; longest: number; start: number; last: number }
        | null;
      if (probe && probe.frames > 1 && probe.last > probe.start) {
        evidence.fps = ((probe.frames - 1) * 1000) / (probe.last - probe.start);
        evidence.longestFrameMs = probe.longest;
      }
    } catch (error) {
      evidence.adEvents = navigations;
      note(`could not read page state: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }

    if (!job.scenario) {
      try {
        const heard = (await page.evaluate("window.__labAudio ? window.__labAudio.read() : null")) as
          | { pre: number; play: number }
          | null;
        if (heard) {
          const audio: AudioEvidence = { beforeInput: heard.pre, afterInput: heard.play };
          // Only a sound that is playing right now can be caught not stopping.
          if ((await page.evaluate("window.__labAudio.heardLately()")) as boolean) {
            await page.evaluate("window.__labAudio.hide()");
            await sleep(1600);
            audio.hidden = (await page.evaluate("window.__labAudio.show()")) as number;
          }
          evidence.audio = audio;
        }
      } catch (error) {
        note(`sound was not measured: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
  }

  if (scriptSession && scriptIds && !run.sources) {
    const sources: string[] = [];
    for (const scriptId of scriptIds) {
      try {
        const { scriptSource } = (await scriptSession.send("Debugger.getScriptSource", { scriptId })) as { scriptSource: string };
        // The lab's own helpers are not the playable's code.
        if (scriptSource && !/__playableLab|__labReadText|__labApis|__labAudio|__labProbe|__labAdEvents|__playableLabAds/.test(scriptSource)) {
          sources.push(scriptSource);
        }
      } catch {
        // A script that went away with its frame.
      }
    }
    run.sources = sources;
  }
  const pageVideo = video ? page.video() : null;
  await context.close();
  let videoFile: string | undefined;
  if (pageVideo) {
    try {
      await pageVideo.saveAs(path.join(run.outDir, `${id}.webm`));
      videoFile = `${id}.webm`;
    } catch (error) {
      note(`video not saved: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }

  if (lastFrame) {
    const last = await analyse(run.helper, lastFrame);
    evidence.finalDominantRatio = last.dominant;
    if (firstFrame) {
      evidence.changeScore = frameDifference(await analyse(run.helper, firstFrame), last);
    }
  }

  if (!piloted && job.review && run.ai && lastFrame) {
    ai = await review({
      helper: run.helper,
      ai: run.ai,
      width: cssWidth,
      height: cssHeight,
      orientation,
      deviceName: device.name,
      frames: firstFrame && evidence.inputs > 0 ? [firstFrame, lastFrame] : [lastFrame],
    });
  }

  const checks = job.scenario
    ? [
        stressCheck(
          stress || { scenario: job.scenario, hung: false, errorsBefore: 0 },
          evidence
        ),
      ]
    : runRuntimeChecks(evidence, run.network, { os: device.os, apps: run.apps }).filter(
        // A language run answers about its words; the rest is answered by the main screens.
        (check) => (!job.language && !job.old) || LANGUAGE_RUN_CHECKS.has(check.id) || (job.old !== undefined && OLD_RUN_CHECKS.has(check.id))
      );
  if (!job.scenario && !job.old) {
    checks.push(textFitCheck(texts));
  }
  const memory = stress ? memoryCheck(stress) : null;
  if (memory) {
    checks.push(memory);
  }
  if (ai) {
    checks.push(aiCheck(ai));
  }
  if (!job.scenario && !job.language && !job.old && device.os === "ios") {
    checks.push(
      inWebkit
        ? {
            id: "safari-engine",
            title: "Safari engine",
            status: "info",
            message: "This screen ran in WebKit, the engine of Safari.",
          }
        : {
            id: "safari-engine",
            title: "Safari engine",
            status: "skip",
            message: piloted
              ? "The AI played this screen in Chromium; its replays on other iOS screens use WebKit."
              : run.webkitMissing === "off"
                ? "WebKit was turned off for this run: this screen ran in Chromium."
                : "WebKit (Safari's engine) is not installed: this screen ran in Chromium. Install it in Settings.",
          }
    );
  }
  return {
    id,
    engine: inWebkit ? "webkit" : "chromium",
    scenario: job.scenario,
    language: job.language,
    old: job.old?.name,
    strings: job.scenario ? undefined : readableStrings(texts),
    marks: screenMarks(
      texts,
      (shots.find((shot) => shot.label === "final") || shots[shots.length - 1])?.file,
      taps,
      cssWidth,
      cssHeight
    ),
    stressResult: stress,
    device,
    orientation,
    cssWidth,
    cssHeight,
    status: overallStatus(checks),
    checks,
    shots,
    video: videoFile,
    evidence,
    console: consoleLines,
    ai,
  };
};

// Lines for whoever started the runner: the hub turns them into a progress bar.
const progress = { done: 0, total: 0, extra: 0 };
const reportProgress = (): void => {
  console.log(`@@progress ${progress.done} ${progress.total}`);
};
/** Name of the report folder, so the screens' pictures can be shown while the run goes on. */
let reportName = "";

/** The screens a run will check, for the console to draw before any of them is done. */
/** Screens checked at the same time; more makes the computer the bottleneck and the timings unreliable. */
const SCREENS_AT_ONCE = Math.max(1, Math.min(4, Number(process.env.PLAYGUARD_PARALLEL) || 3));

/** The checks an old-phone run keeps: does it open, run without errors, draw, react, reach the store. */
const OLD_RUN_CHECKS = new Set(["load", "js-errors", "render", "responds", "cta"]);

/** The checks a language run keeps: whether it opens, its errors, its picture, its words. */
const LANGUAGE_RUN_CHECKS = new Set(["load", "js-errors", "render", "text-fit", "language"]);

/** The narrowest phone: long translations run out of room there first. */
const languagePhone = (devices: DeviceProfile[]): DeviceProfile | undefined => {
  const phones = devices.filter((device) => device.group !== "tablet");
  return [...(phones.length > 0 ? phones : devices)].sort(
    (a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height)
  )[0];
};

const reportPlan = (
  devices: DeviceProfile[],
  orientations: Orientation[],
  scenarios: Scenario[],
  languages: string[] = [],
  old: OldProfile[] = []
): void => {
  const screens: Array<{ id: string; name: string; w: number; h: number; orientation: Orientation; scenario?: Scenario; language?: string; old?: string }> = [];
  for (let o = 0; o < orientations.length; o += 1) {
    for (let d = 0; d < devices.length; d += 1) {
      const size = deviceCssSize(devices[d], orientations[o]);
      screens.push({ id: `${devices[d].id}-${orientations[o]}`, name: devices[d].name, w: size.cssWidth, h: size.cssHeight, orientation: orientations[o] });
    }
  }
  const phone = devices.find((device) => device.id === "pixel-7") || devices.find((device) => device.os === "android" && device.group !== "tablet") || devices[0];
  for (let i = 0; i < scenarios.length && phone; i += 1) {
    const size = deviceCssSize(phone, orientations[0]);
    screens.push({ id: `${phone.id}-${orientations[0]}-${scenarios[i]}`, name: phone.name, w: size.cssWidth, h: size.cssHeight, orientation: orientations[0], scenario: scenarios[i] });
  }
  const narrow = languagePhone(devices);
  for (let i = 0; i < languages.length && narrow; i += 1) {
    const size = deviceCssSize(narrow, orientations[0]);
    screens.push({ id: `${narrow.id}-${orientations[0]}-lang-${languages[i]}`, name: narrow.name, w: size.cssWidth, h: size.cssHeight, orientation: orientations[0], language: languages[i] });
  }
  const catalog = devicesById();
  for (const profile of old) {
    const phone = catalog.get(profile.device);
    if (phone) {
      const size = deviceCssSize(phone, orientations[0]);
      screens.push({ id: `${phone.id}-${orientations[0]}-old-${profile.id}`, name: phone.name, w: size.cssWidth, h: size.cssHeight, orientation: orientations[0], old: profile.name });
    }
  }
  console.log(`@@screens ${JSON.stringify(screens)}`);
};

/** One screen is done: its verdict and its last picture. */
const reportScreen = (result: DeviceRun): void => {
  const shot = result.shots.find((item) => item.label === "final") || result.shots[result.shots.length - 1];
  console.log(`@@screen ${JSON.stringify({ id: result.id, status: result.status, shot: shot && reportName ? `${reportName}/${shot.file}` : null })}`);
};

const reportTokens = (ai: AiSettings | undefined): void => {
  if (ai) {
    console.log(`@@tokens ${ai.budget.used} ${ai.budget.limit} ${ai.budget.calls}`);
  }
};

const shapeOf = (device: DeviceProfile): number =>
  Math.max(device.width, device.height) / Math.min(device.width, device.height);

const pool = async <T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker));
};

const resolvePilotIds = (devices: DeviceProfile[]): string[] => {
  const raw = option("--ai-devices");
  if (raw === "all") {
    return devices.map((device) => device.id);
  }
  if (!raw) {
    return [devices.some((device) => device.id === "pixel-7") ? "pixel-7" : devices[0].id];
  }
  const catalog = devicesById();
  const ids = raw.split(",").filter(Boolean);
  for (let i = 0; i < ids.length; i += 1) {
    const device = catalog.get(ids[i]);
    if (!device) {
      throw new Error(`Unknown device "${ids[i]}" in --ai-devices.`);
    }
    if (!devices.some((item) => item.id === device.id)) {
      devices.unshift(device);
    }
  }
  return ids;
};

/**
 * The AI plays each orientation on a few screens; every other screen replays
 * the recording closest to its own shape, which costs no tokens.
 */
const runAutoplay = async (
  run: RunContext,
  devices: DeviceProfile[],
  orientations: Orientation[]
): Promise<DeviceRun[]> => {
  const settings = run.ai as AiSettings;
  const pilotIds = resolvePilotIds(devices);
  const parallel = numberOption("--parallel") ?? 3;
  const runs: DeviceRun[] = [];
  const announce = (result: DeviceRun): void => {
    printChecks(
      `${result.device.name} · ${result.orientation} · ${result.cssWidth}×${result.cssHeight}`,
      result.status,
      result.checks
    );
    progress.done += 1;
    reportProgress();
    reportScreen(result);
    reportTokens(settings);
  };
  progress.total = devices.length * orientations.length + progress.extra;
  reportProgress();

  for (let o = 0; o < orientations.length; o += 1) {
    const orientation = orientations[o];
    const done = new Map<string, DeviceRun>();
    const recordings: Array<{ device: DeviceProfile; plan: ReplayPlan }> = [];

    const pilots = devices.filter((device) => pilotIds.includes(device.id));
    for (let d = 0; d < pilots.length; d += 1) {
      const device = pilots[d];
      console.log(`\n${settings.provider.id} plays ${device.name} · ${orientation}`);
      const job: DeviceJob = { pilot: true };
      const result = await runDevice(run, device, orientation, job);
      done.set(device.id, result);
      announce(result);
      if (job.recorded && job.recorded.events.length > 0) {
        const trace: SessionTrace = {
          version: PROTOCOL_VERSION,
          sessionId: `ai-${device.id}-${orientation}`,
          playable: {
            id: slug(run.playable.name),
            engine: detectEngine(run.playable.html || "", run.playable.name),
            name: run.playable.name,
            url: run.playable.entryUrl,
          },
          orientationLock: orientation,
          sourceViewport: {
            cssWidth: result.cssWidth,
            cssHeight: result.cssHeight,
            dpr: device.dpr,
            orientation,
            contentRect: job.recorded.rect,
            fit: "stretch",
          },
          startedAt: job.recorded.startedAt,
          endedAt: Date.now(),
          deviceIds: devices.map((item) => item.id),
          seed: run.seed,
          events: job.recorded.events,
          adEvents: result.evidence.adEvents,
        };
        // Reusable later: npm run replay -- --trace <this file> --playable <file>
        await writeFile(
          path.join(run.outDir, `${trace.sessionId}.trace.json`),
          JSON.stringify(trace, null, 2),
          "utf8"
        );
        recordings.push({ device, plan: buildReplayPlan(trace) });
      }
    }

    const rest = devices.filter((device) => !pilotIds.includes(device.id));
    if (rest.length > 0) {
      console.log(
        recordings.length > 0
          ? `\nReplaying the AI's inputs on ${rest.length} more ${orientation} screens`
          : `\nNo AI input to replay: loading ${rest.length} more ${orientation} screens`
      );
    }
    await pool(rest, parallel, async (device) => {
      let source = recordings[0];
      for (let i = 1; i < recordings.length; i += 1) {
        if (
          Math.abs(shapeOf(recordings[i].device) - shapeOf(device)) <
          Math.abs(shapeOf(source.device) - shapeOf(device))
        ) {
          source = recordings[i];
        }
      }
      const result = await runDevice(run, device, orientation, {
        plan: source?.plan,
        review: !flag("--no-review"),
      });
      done.set(device.id, result);
      announce(result);
    });

    for (let d = 0; d < devices.length; d += 1) {
      const result = done.get(devices[d].id);
      if (result) {
        runs.push(result);
      }
    }
  }
  return runs;
};

const MARK: Record<CheckResult["status"], string> = {
  pass: "✓",
  warn: "!",
  fail: "✕",
  info: "·",
  skip: "–",
};

const printChecks = (title: string, status: string, checks: CheckResult[]): void => {
  console.log(`\n${title}  ${status.toUpperCase()}`);
  for (let i = 0; i < checks.length; i += 1) {
    const check = checks[i];
    if (check.status === "pass" || check.status === "skip") {
      continue;
    }
    console.log(`  ${MARK[check.status]} ${check.title}: ${check.message}`);
  }
};

const main = async (): Promise<number> => {
  if (flag("--help") || argv.length === 0) {
    console.log(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  const autoplay = flag("--autoplay");
  const tracePath = option("--trace");
  if (autoplay && tracePath) {
    throw new Error("Autoplay records its own input: drop --trace, or use npm run replay.");
  }
  const lang = option("--lang") || process.env.PLAYABLE_LAB_LANG || "en";
  if (lang !== "en" && lang !== "ru" && lang !== "fr") {
    throw new Error(`--lang expects en, ru or fr, got "${lang}"`);
  }
  // One recording per orientation: portrait played once, landscape once, one report.
  const traces: SessionTrace[] = [];
  const tracePaths = options("--trace");
  for (let i = 0; i < tracePaths.length; i += 1) {
    const read = JSON.parse(await readFile(userPath(tracePaths[i]), "utf8")) as SessionTrace;
    if (!traces.some((item) => item.orientationLock === read.orientationLock)) {
      traces.push(read);
    }
  }
  const trace = traces[0];
  if (trace && traces.length > 1) {
    // The screens mirrored in either pass are checked in both orientations.
    const ids = new Set(traces.flatMap((item) => item.deviceIds || []));
    trace.deviceIds = ids.size > 0 ? Array.from(ids) : trace.deviceIds;
  }
  const playable = await resolvePlayable(trace);
  const devices = resolveDevices(trace);
  const orientations = traces.length > 1 ? traces.map((item) => item.orientationLock) : resolveOrientations(trace);

  const networkId = option("--network");
  const explicit = networkById(networkId);
  if (networkId && !explicit) {
    throw new Error(`Unknown network "${networkId}". See --help for the list.`);
  }
  const network = explicit || detectNetwork(playable.name, playable.html || "").network;

  const planOf = (item: SessionTrace) =>
    buildReplayPlan(item, {
      speed: numberOption("--speed") ?? 1,
      maxGapMs: numberOption("--max-gap"),
      leadInMs: numberOption("--lead-in") ?? 1500,
    });
  const plan = trace ? planOf(trace) : undefined;
  const plans = new Map(traces.map((item, index) => [item.orientationLock, index === 0 ? plan! : planOf(item)]));
  const ctaOf = (item: SessionTrace | undefined): number | undefined =>
    (item?.adEvents || [])
      .filter((event) => event.kind === "cta")
      .reduce<number | undefined>((latest, event) => (latest === undefined || event.rt > latest ? event.rt : latest), undefined);
  /** Points the run at the recording made in this orientation. */
  const useTraceFor = (orientation: Orientation): void => {
    const own = traces.find((item) => item.orientationLock === orientation);
    if (!own || traces.length < 2) {
      return;
    }
    run.plan = plans.get(orientation);
    run.seed = own.seed;
    run.ctaAt = ctaOf(own);
    run.expectCta = flag("--require-cta") || Boolean(own.adEvents?.some((event) => event.kind === "cta"));
  };

  let scenarios: Scenario[] = [];
  if (argv.includes("--stress") && flag("--stress")) {
    const picked = option("--stress");
    scenarios = picked ? (picked.split(",").filter(Boolean) as Scenario[]) : SCENARIOS;
    const unknown = scenarios.find((item) => !SCENARIOS.includes(item));
    if (unknown) {
      throw new Error(`Unknown scenario "${unknown}" in --stress. Known: ${SCENARIOS.join(", ")}.`);
    }
  }
  // The phone set to each language in turn, English first: the others are compared with it.
  const rawLanguages = option("--languages");
  const languages =
    rawLanguages && rawLanguages !== "none"
      ? Array.from(new Set(["en", ...rawLanguages.split(",").filter((code) => LOCALES[code])]))
      : [];
  if (languages.length === 1) {
    languages.length = 0;
  }
  // Old phones: iOS 13, iOS 14, Android 8–9, each played once with its browser's gaps.
  const rawOld = option("--old-phones");
  const oldProfiles =
    rawOld && rawOld !== "none"
      ? OLD_PROFILES.filter((profile) => rawOld === "all" || rawOld.split(",").includes(profile.id))
      : [];
  progress.extra = scenarios.length + languages.length + oldProfiles.length;

  const apps: ExpectedApps = { ios: option("--store-ios"), android: option("--store-android") };

  const fileChecks: CheckResult[] = [];
  if (playable.html !== undefined) {
    fileChecks.push(
      ...runStaticChecks(
        playable.html,
        network,
        playable.bundle && playable.bundle.zipBytes > 0 ? playable.bundle : undefined,
        { apps }
      )
    );
  }
  for (let i = 0; i < traces.length; i += 1) {
    const own = [...runTraceChecks(traces[i]), ...runPerfChecks(traces[i].perf)];
    // Two passes: say which one a remark is about.
    fileChecks.push(
      ...(traces.length > 1 ? own.map((check) => ({ ...check, title: `${check.title} · ${traces[i].orientationLock}` })) : own)
    );
  }
  const shipped = playable.bundle?.zipBytes || (playable.html !== undefined ? htmlByteSize(playable.html) : 0);
  if (shipped > 0) {
    // 1.6 Mbit/s is a weak 3G signal, 12 Mbit/s an ordinary 4G one.
    const seconds = (bitsPerSecond: number): string => {
      const value = (shipped * 8) / bitsPerSecond;
      return value < 1 ? "under a second" : `about ${Math.round(value)} s`;
    };
    fileChecks.push({
      id: "download-time",
      title: "Download time",
      status: "info",
      message: `${formatBytes(shipped)} downloads in ${seconds(1_600_000)} on slow 3G and ${seconds(12_000_000)} on 4G, before the ad can start.`,
    });
  }

  let ai: AiSettings | undefined;
  // One seed for the AI's game and every replay of it: same "random" game everywhere.
  const seed = autoplay ? Math.floor(Math.random() * 0x100000000) : trace?.seed;
  if (autoplay) {
    const imageSide = numberOption("--ai-image") ?? 640;
    ai = {
      provider: createProvider(option("--ai") || AI_PROVIDERS[0], option("--model"), { imageSide, seed: seed || 1 }),
      budget: { limit: numberOption("--budget") ?? 80000, used: 0, calls: 0, input: 0, output: 0 },
      lang: lang as Lang,
      imageSide,
      maxTurns: numberOption("--max-turns") ?? 14,
    };
  }

  const started = new Date();
  // One screen of an existing report checked again: its result replaces the old one there.
  const only = option("--only");
  const into = option("--into");
  if (Boolean(only) !== Boolean(into)) {
    throw new Error("--only and --into go together: the screen to check again, and the report it belongs to.");
  }
  const outDir = into
    ? userPath(into)
    : path.join(userPath(option("--out") || path.join(DATA, "reports")), `${slug(trace ? trace.sessionId : playable.name)}-${stamp(started)}`);
  await mkdir(outDir, { recursive: true });
  if (only) {
    await rm(path.join(outDir, only), { recursive: true, force: true });
    await rm(path.join(outDir, `${only}.webm`), { force: true });
  } else {
    // How this check was started, so one of its screens can be checked again later.
    await writeFile(path.join(outDir, "run.json"), JSON.stringify({ argv }, null, 2), "utf8");
  }
  const screenId = (device: DeviceProfile, orientation: Orientation, job: { scenario?: string; language?: string; old?: string } = {}): string =>
    `${device.id}-${orientation}${job.scenario ? `-${job.scenario}` : ""}${job.language ? `-lang-${job.language}` : ""}${job.old ? `-old-${job.old}` : ""}`;
  const wanted = (device: DeviceProfile, orientation: Orientation, job: { scenario?: string; language?: string; old?: string } = {}): boolean =>
    !only || screenId(device, orientation, job) === only;
  const videoDir = flag("--no-video")
    ? undefined
    : await mkdtemp(path.join(os.tmpdir(), "playable-lab-video-"));

  console.log(`Playable  ${playable.name}`);
  console.log(`Network   ${network ? `${network.name}${explicit ? "" : " (from the file name)"}` : "not set (--network)"}`);
  console.log(
    `Input     ${plan ? `${plan.inputs} inputs over ${(plan.durationMs / 1000).toFixed(1)} s, timed from ${plan.timing === "load" ? "page load" : "the first event"}` : ai ? `AI autoplay: ${ai.provider.id} (${ai.provider.model}), up to ${ai.maxTurns} turns a playthrough, ${ai.budget.limit} tokens for the run` : "none (smoke run)"}`
  );

  const browser = await launch(!flag("--headed"));
  const pilotBrowser = ai && !flag("--headless") && !flag("--headed") ? await launch(false) : undefined;
  const wantsWebkit = devices.some((device) => device.os === "ios");
  const webkitOff = flag("--no-webkit");
  const webkitBrowser = wantsWebkit && !webkitOff ? await launchWebkit() : undefined;
  const helperContext = await browser.newContext();
  const helper = await helperContext.newPage();
  const run: RunContext = {
    browser,
    helper,
    playable,
    network,
    plan,
    seed,
    ai,
    pilotBrowser,
    webkit: webkitBrowser,
    webkitMissing: webkitBrowser ? undefined : webkitOff ? "off" : "not-installed",
    idleMs: numberOption("--idle") ?? 30000,
    apps,
    ctaAt: ctaOf(trace),
    expectCta: flag("--require-cta") || Boolean(trace?.adEvents?.some((event) => event.kind === "cta")),
    outDir,
    videoDir,
  };

  const runs: DeviceRun[] = [];
  const stress: DeviceRun[] = [];
  reportName = path.basename(outDir);
  if (!only) {
    reportPlan(devices, orientations, scenarios, languages, ai ? [] : oldProfiles);
  }
  const languageRuns: DeviceRun[] = [];
  const oldRuns: DeviceRun[] = [];
  try {
    if (ai) {
      runs.push(...(await runAutoplay(run, devices, orientations)));
    } else {
      progress.total = only ? 1 : devices.length * orientations.length + progress.extra;
      reportProgress();
      // Screens run a few at a time: each has its own browser tab and its own clock.
      for (let o = 0; o < orientations.length; o += 1) {
        useTraceFor(orientations[o]);
        const screens = devices.filter((device) => wanted(device, orientations[o]));
        const done: DeviceRun[] = [];
        await pool(screens, SCREENS_AT_ONCE, async (device) => {
          const result = await runDevice(run, device, orientations[o]);
          done.push(result);
          progress.done += 1;
          reportProgress();
          reportScreen(result);
          printChecks(`${result.device.name} · ${result.orientation} · ${result.cssWidth}×${result.cssHeight}`, result.status, result.checks);
        });
        // The report keeps the screens in their usual order.
        runs.push(...screens.map((device) => done.find((item) => item.device.id === device.id)!).filter(Boolean));
      }
    }
    const narrow = languagePhone(devices);
    if (languages.length > 0 && narrow) {
      useTraceFor(orientations[0]);
      await pool(languages.filter((language) => wanted(narrow, orientations[0], { language })), 3, async (language) => {
        const result = await runDevice(run, narrow, orientations[0], { language });
        languageRuns.push(result);
        progress.done += 1;
        reportProgress();
      });
      languageRuns.sort((a, b) => languages.indexOf(a.language!) - languages.indexOf(b.language!));
      // Checked again on its own: compared with the other languages of the report it belongs to.
      const previousLanguages: DeviceRun[] = only
        ? ((JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8")) as RunReport).languages || []).filter(
            (item) => item.id !== only
          )
        : [];
      const allLanguages = [...previousLanguages, ...languageRuns];
      const english = allLanguages.find((item) => item.language === "en");
      const verdicts = languageChecks(
        { code: "en", strings: english?.strings || [] },
        allLanguages.filter((item) => item !== english).map((item) => ({ code: item.language!, strings: item.strings || [] }))
      );
      for (const result of allLanguages) {
        result.checks = result.checks.filter((check) => check.id !== "language");
        const verdict = verdicts.get(result.language!);
        if (verdict) {
          result.checks.push(verdict);
        }
        result.status = overallStatus(result.checks);
        if (!languageRuns.includes(result)) {
          languageRuns.push(result);
          continue;
        }
        reportScreen(result);
        printChecks(`${result.device.name} · ${LANGUAGE_NAMES[result.language!] || result.language}`, result.status, result.checks);
      }
    }
    if (oldProfiles.length > 0 && !ai) {
      const catalog = devicesById();
      useTraceFor(orientations[0]);
      // Read the code once: from what the playable ran, or from its file.
      const sources = run.sources && run.sources.length > 0 ? run.sources : extractScripts(playable.html || "");
      const hasWebp = /data:image\/webp|\.webp\b/i.test(playable.html || "") || Boolean(playable.bundle?.sizes && Object.keys(playable.bundle.sizes).some((name) => name.endsWith(".webp")));
      const found = await scanFeatures(sources, hasWebp);
      await pool(
        oldProfiles.filter((profile) => {
          const phone = catalog.get(profile.device);
          return phone ? wanted(phone, orientations[0], { old: profile.id }) : false;
        }),
        3,
        async (profile) => {
          const phone = catalog.get(profile.device)!;
          const result = await runDevice(run, phone, orientations[0], { old: profile });
          result.checks = [oldPhoneCheck(profile, result.checks), oldCodeCheck(profile, found), ...result.checks];
          result.status = overallStatus(result.checks.slice(0, 2));
          oldRuns.push(result);
          progress.done += 1;
          reportProgress();
          reportScreen(result);
          printChecks(`Old phone · ${profile.name}`, result.status, result.checks.slice(0, 2));
        }
      );
      oldRuns.sort((a, b) => OLD_PROFILES.findIndex((item) => item.name === a.old) - OLD_PROFILES.findIndex((item) => item.name === b.old));
    }
    if (scenarios.length > 0) {
      const phone =
        devices.find((device) => device.id === "pixel-7") ||
        devices.find((device) => device.os === "android" && device.group !== "tablet") ||
        devices[0];
      const announce = (result: DeviceRun): void => {
        stress.push(result);
        progress.done += 1;
        reportProgress();
        reportScreen(result);
        printChecks(`${result.device.name} · ${result.orientation} · ${result.scenario}`, result.status, result.checks);
      };
      useTraceFor(orientations[0]);
      await pool(scenarios.filter((scenario) => wanted(phone, orientations[0], { scenario })), 3, async (scenario) => {
        announce(await runDevice(run, phone, orientations[0], { scenario }));
      });
      stress.sort((a, b) => SCENARIOS.indexOf(a.scenario as Scenario) - SCENARIOS.indexOf(b.scenario as Scenario));
    }
  } catch (error) {
    if (error instanceof AiSetupError) {
      // Nothing was played: an empty report would only mislead.
      await rm(outDir, { recursive: true, force: true });
      throw new Error(
        `The AI could not be reached, nothing was tested. ${error.message}\n` +
          "Set ANTHROPIC_API_KEY (--ai claude) or OPENAI_API_KEY (--ai gpt); --ai monkey needs no key."
      );
    }
    throw error;
  } finally {
    await browser.close();
    if (pilotBrowser) {
      await pilotBrowser.close();
    }
    if (webkitBrowser) {
      await webkitBrowser.close();
    }
    if (videoDir) {
      await rm(videoDir, { recursive: true, force: true });
    }
  }

  if (only) {
    return await mergeInto(outDir, only, [...runs, ...stress, ...languageRuns, ...oldRuns], lang as Lang);
  }

  const status = overallStatus([
    ...fileChecks,
    ...runs.map((item) => ({ id: item.id, title: item.id, status: item.status, message: "" })),
    ...stress.map((item) => ({ id: item.id, title: item.id, status: item.status, message: "" })),
    ...languageRuns.map((item) => ({ id: item.id, title: item.id, status: item.status, message: "" })),
    ...oldRuns.map((item) => ({ id: item.id, title: item.id, status: item.status, message: "" })),
  ]);
  printChecks("File", overallStatus(fileChecks), fileChecks);

  const report: RunReport = {
    generatedAt: started.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    by: option("--by") || trace?.by,
    status,
    playable: {
      name: playable.name,
      bytes: shipped,
      engine: playable.engine,
    },
    network: network
      ? { id: network.id, name: network.name, guessed: !explicit, notes: network.notes, docs: network.docs }
      : undefined,
    trace:
      trace && plan
        ? {
            sessionId: trace.sessionId,
            also: traces.length > 1 ? traces.slice(1).map((item) => item.sessionId) : undefined,
            stepId: trace.stepId,
            inputs: plan.inputs,
            durationMs: plan.durationMs,
            timing: plan.timing,
          }
        : undefined,
    fileChecks,
    weight:
      playable.html !== undefined
        ? analyseWeight(
            playable.html,
            playable.bundle?.sizes
              ? { files: playable.bundle.sizes, entry: playable.bundle.entry, scripts: playable.bundle.scripts }
              : undefined
          )
        : undefined,
    perf: trace?.perf,
    runs,
    stress: stress.length > 0 ? stress : undefined,
    languages: languageRuns.length > 0 ? languageRuns : undefined,
    oldPhones: oldRuns.length > 0 ? oldRuns : undefined,
    depth: option("--depth") === "quick" ? "quick" : option("--depth") === "full" ? "full" : undefined,
    ai: ai
      ? {
          provider: ai.provider.id,
          model: ai.provider.model,
          calls: ai.budget.calls,
          inputTokens: ai.budget.input,
          outputTokens: ai.budget.output,
          budget: ai.budget.limit,
        }
      : undefined,
  };
  report.summary = summarize(report, lang as Lang);
  await writeFile(path.join(outDir, "index.html"), renderReport(report), "utf8");
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log(`\n${summaryLines(report.summary).join("\n")}`);
  if (ai) {
    console.log(
      `\nAI        ${ai.budget.calls} calls, ${ai.budget.input} input + ${ai.budget.output} output tokens${ai.budget.used >= ai.budget.limit ? " (budget reached)" : ""}`
    );
  }
  console.log(`\n${status.toUpperCase()}  ${path.join(outDir, "index.html")}`);
  return status === "fail" ? 1 : 0;
};

/** The inline scripts of a page, for reading when the playable could not be watched running. */
const extractScripts = (html: string): string[] => {
  const scripts: string[] = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1].trim()) {
      scripts.push(match[1]);
    }
  }
  return scripts;
};

/** What happened when the playable was played as on an old phone, as one line. */
const oldPhoneCheck = (profile: OldProfile, checks: CheckResult[]): CheckResult => {
  const of = (id: string): CheckResult | undefined => checks.find((check) => check.id === id);
  const load = of("load");
  const errors = of("js-errors");
  const render = of("render");
  const base = { id: "old-phone", title: "Plays on an old phone" };
  if (load?.status === "fail") {
    return { ...base, status: "fail", message: `As on ${profile.name}, the ad did not load: ${load.message}` };
  }
  if (render?.status === "fail") {
    // Without WebGL 2 an engine falls back to WebGL 1, which the imitation reproduces only roughly.
    const noWebgl2 = profile.safari !== undefined ? profile.safari < 15 : (profile.chrome ?? 999) < 56;
    return noWebgl2 && errors?.status !== "fail"
      ? {
          ...base,
          status: "warn",
          message: `As on ${profile.name}, the picture broke without WebGL 2, which that phone lacks. The imitation is rough here: check on a real phone.`,
        }
      : { ...base, status: "fail", message: `As on ${profile.name}, the screen stayed blank.`, details: errors?.details?.slice(0, 4) };
  }
  if (errors?.status === "fail") {
    return {
      ...base,
      status: "fail",
      message: `As on ${profile.name}, the code crashed: a feature that browser lacks was called.`,
      details: errors.details?.slice(0, 4),
    };
  }
  if (errors?.status === "warn") {
    return { ...base, status: "warn", message: `As on ${profile.name}, it played but wrote errors.`, details: errors.details?.slice(0, 4) };
  }
  return { ...base, status: "pass", message: `As on ${profile.name}, it loaded and played without errors.` };
};

/**
 * One screen checked again: its new result takes the old one's place in the
 * report, and the verdict, the summary and the page are worked out anew.
 */
const mergeInto = async (outDir: string, only: string, fresh: DeviceRun[], lang: Lang): Promise<number> => {
  const report = JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8")) as RunReport;
  const swap = (list: DeviceRun[] | undefined): DeviceRun[] | undefined =>
    list?.map((item) => fresh.find((next) => next.id === item.id) || item);
  const replaced = fresh.find((item) => item.id === only);
  if (!replaced) {
    throw new Error(`No screen "${only}" in this check: nothing was checked again.`);
  }
  report.runs = swap(report.runs) || [];
  report.stress = swap(report.stress);
  // A language run brings the other languages' re-worked verdicts with it.
  report.languages = report.languages ? report.languages.map((item) => fresh.find((next) => next.id === item.id) || item) : undefined;
  report.oldPhones = swap(report.oldPhones);
  report.status = overallStatus([
    ...report.fileChecks,
    ...[...report.runs, ...(report.stress || []), ...(report.languages || []), ...(report.oldPhones || [])].map((item) => ({
      id: item.id,
      title: item.id,
      status: item.status,
      message: "",
    })),
  ]);
  report.summary = summarize(report, report.summary?.lang || lang);
  await writeFile(path.join(outDir, "index.html"), renderReport(report), "utf8");
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  reportName = path.basename(outDir);
  reportScreen(replaced);
  console.log(`\n${summaryLines(report.summary).join("\n")}`);
  console.log(`\n${report.status.toUpperCase()}  ${path.join(outDir, "index.html")}`);
  return report.status === "fail" ? 1 : 0;
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
);
