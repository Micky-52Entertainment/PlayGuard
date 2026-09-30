import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTrace } from "@playable-lab/protocol";
import {
  analyseWeight,
  linkGate,
  expectedId,
  storeLinkCheck,
  detectNetwork,
  fpsZone,
  guessNetwork,
  networkById,
  networkNameFromFile,
  overallStatus,
  runPerfChecks,
  runRuntimeChecks,
  runStaticChecks,
  runTraceChecks,
  summarizeFps,
} from "./index.ts";
import type { CheckResult, RuntimeEvidence } from "./index.ts";

const byId = (results: CheckResult[], id: string): CheckResult => {
  const found = results.find((result) => result.id === id);
  assert.ok(found, `check ${id} is missing`);
  return found;
};

const applovin = networkById("applovin")!;
const meta = networkById("meta")!;
const mintegral = networkById("mintegral")!;
const google = networkById("google")!;

const CLEAN = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">
<script>function cta(){ mraid.open("https://play.google.com/store/apps/details?id=a.b"); }</script>
</head><body><img src="data:image/png;base64,AAAA"></body></html>`;

const evidence = (partial: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  loaded: true,
  loadMs: 400,
  pageErrors: [],
  consoleErrors: [],
  requests: [],
  adEvents: [],
  inputs: 3,
  firstInputAt: 2000,
  finalDominantRatio: 0.4,
  changeScore: 12,
  expectCta: false,
  ...partial,
});

test("guesses the network from an export file name", () => {
  assert.equal(guessNetwork("BUS_PL06_81_applovin_en.html")?.id, "applovin");
  assert.equal(guessNetwork("game_Facebook.html")?.id, "meta");
  assert.equal(guessNetwork("game.html"), undefined);
});

test("a clean single-file AppLovin build passes the file checks", () => {
  const results = runStaticChecks(CLEAN, applovin);
  assert.equal(overallStatus(results), "pass");
  assert.equal(byId(results, "store-links").details?.length, 1);
});

test("flags external and separate local files", () => {
  const html = `<html><head><script src="https://cdn.example.com/lib.js"></script>
<script src="main.js"></script><script src="mraid.js"></script>
<style>body{background:url(//cdn.example.com/bg.png)}</style></head></html>`;
  const results = runStaticChecks(html, applovin);
  assert.equal(byId(results, "external-refs").status, "fail");
  assert.deepEqual(byId(results, "external-refs").details, [
    "https://cdn.example.com/lib.js",
    "//cdn.example.com/bg.png",
  ]);
  assert.equal(byId(results, "single-file").status, "fail");
  assert.deepEqual(byId(results, "single-file").details, ["main.js"]);
  assert.equal(byId(results, "cta-source").status, "warn");
});

test("applies each network's size limit", () => {
  const big = `<html>${"x".repeat(3 * 1024 * 1024)}</html>`;
  assert.equal(byId(runStaticChecks(big, applovin), "size").status, "pass");
  // Over Meta's 2 MB bare-HTML limit, but still uploadable as a zip.
  assert.equal(byId(runStaticChecks(big, meta), "size").status, "warn");
  const huge = `<html>${"x".repeat(6 * 1024 * 1024)}</html>`;
  assert.equal(byId(runStaticChecks(huge, applovin), "size").status, "fail");
  assert.equal(byId(runStaticChecks(huge, meta), "size").status, "fail");
});

test("checks network-specific integration in source", () => {
  assert.equal(byId(runStaticChecks(CLEAN, meta), "discouraged-source").status, "warn");
  assert.equal(byId(runStaticChecks(CLEAN, mintegral), "required-source").status, "fail");
  const googleBuild = `<html><head><meta name="ad.orientation" content="portrait,landscape">
<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>
<script>ExitApi.exit()</script></head></html>`;
  const results = runStaticChecks(googleBuild, google);
  assert.equal(byId(results, "required-source").status, "pass");
  assert.equal(byId(results, "external-refs").status, "pass");
  assert.equal(byId(results, "cta-source").status, "pass");
});

test("a healthy replay with the right CTA passes", () => {
  const results = runRuntimeChecks(
    evidence({ adEvents: [{ t: 0, rt: 9000, kind: "cta", api: "mraid.open" }], expectCta: true }),
    applovin
  );
  assert.equal(overallStatus(results), "pass");
});

test("fails on a blank frame, an exception and a failed load", () => {
  assert.equal(byId(runRuntimeChecks(evidence({ finalDominantRatio: 1 })), "render").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ pageErrors: ["TypeError: x"] })), "js-errors").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ consoleErrors: ["oops"] })), "js-errors").status, "warn");
  assert.equal(byId(runRuntimeChecks(evidence({ loaded: false, loadError: "timeout" })), "load").status, "fail");
});

test("warns when input changes nothing on a screen", () => {
  assert.equal(byId(runRuntimeChecks(evidence({ changeScore: 0 })), "responds").status, "warn");
  assert.equal(byId(runRuntimeChecks(evidence({ inputs: 0 })), "responds").status, "skip");
});

test("judges the CTA against the network", () => {
  const fb = { t: 0, rt: 9000, kind: "cta" as const, api: "FbPlayableAd.onCTAClick" };
  assert.equal(byId(runRuntimeChecks(evidence({ adEvents: [fb] }), applovin), "cta").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ adEvents: [fb] }), meta), "cta").status, "pass");
  // Fired before the player touched anything: an automatic redirect.
  const auto = { t: 0, rt: 500, kind: "cta" as const, api: "mraid.open" };
  assert.equal(byId(runRuntimeChecks(evidence({ adEvents: [auto] }), applovin), "cta").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ expectCta: true }), applovin), "cta").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence(), applovin), "cta").status, "warn");
  assert.equal(byId(runRuntimeChecks(evidence({ inputs: 0, firstInputAt: undefined }), applovin), "cta").status, "skip");
});

test("external requests fail only where the network forbids them", () => {
  const requests = [{ url: "https://stats.example.com/ping", kind: "external" as const, resourceType: "xhr" }];
  assert.equal(byId(runRuntimeChecks(evidence({ requests }), applovin), "network").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ requests }), networkById("unity")), "network").status, "warn");
  const missing = [{ url: "/assets/a.png", kind: "missing-local" as const, resourceType: "image" }];
  assert.equal(byId(runRuntimeChecks(evidence({ requests: missing }), networkById("unity")), "network").status, "fail");
});

test("Mintegral needs gameReady, and gameEnd by the end", () => {
  const ready = { t: 0, rt: 100, kind: "lifecycle" as const, api: "gameReady" };
  assert.equal(byId(runRuntimeChecks(evidence(), mintegral), "lifecycle").status, "fail");
  assert.equal(byId(runRuntimeChecks(evidence({ adEvents: [ready] }), mintegral), "lifecycle").status, "warn");
});

test("rejects a trace recorded on a zero-size canvas", () => {
  const trace: SessionTrace = {
    version: 1,
    sessionId: "ses",
    playable: { id: "p", engine: "vanilla", name: "p.html", url: "/p" },
    orientationLock: "portrait",
    sourceViewport: {
      cssWidth: 407,
      cssHeight: 767,
      dpr: 3,
      orientation: "portrait",
      fit: "stretch",
      contentRect: { x: 0, y: 0, w: 1, h: 1 },
    },
    startedAt: 0,
    events: Array.from({ length: 10 }, (_, i) => ({
      t: i,
      kind: "touch" as const,
      phase: i === 0 ? ("down" as const) : ("move" as const),
      pointerId: 1,
      nx: 1,
      ny: 1,
      pressure: 1,
    })),
  };
  assert.equal(byId(runTraceChecks(trace), "trace-input").status, "fail");
  trace.sourceViewport.contentRect = { x: 0, y: 0, w: 407, h: 767 };
  trace.events[3].nx = 0.4;
  assert.equal(byId(runTraceChecks(trace), "trace-input").status, "pass");
});

test("summarises phone fps into zones, weighting by time", () => {
  const perf = [
    { at: 1000, rt: 0, fps: 60, worstFrameMs: 17 },
    { at: 2000, rt: 500, fps: 60, worstFrameMs: 17 },
    { at: 3000, rt: 1500, fps: 40, worstFrameMs: 40 },
    // one long frozen window: 3 s at 10 fps
    { at: 6000, rt: 4500, fps: 10, worstFrameMs: 900 },
  ];
  const summary = summarizeFps(perf)!;
  assert.equal(Math.round(summary.average), 32);
  assert.equal(summary.min, 10);
  assert.equal(summary.zone, "yellow");
  assert.deepEqual(
    [summary.share.green, summary.share.yellow, summary.share.red].map((value) => Math.round(value * 100)),
    [33, 17, 50]
  );
  assert.equal(runPerfChecks(perf)[0].status, "warn");
  assert.equal(runPerfChecks([{ at: 1000, rt: 0, fps: 58, worstFrameMs: 20 }])[0].status, "pass");
  assert.equal(runPerfChecks([{ at: 1000, rt: 0, fps: 20, worstFrameMs: 90 }])[0].status, "fail");
  assert.deepEqual(runPerfChecks(undefined), []);
  assert.equal(fpsZone(50), "green");
  assert.equal(fpsZone(30), "yellow");
  assert.equal(fpsZone(29.9), "red");
});

test("detects the network from a path, then from the install API", () => {
  assert.equal(detectNetwork("builds/AL/game_en.html", "").network?.id, "applovin");
  assert.equal(detectNetwork("game_fb_en.html", "").network?.id, "meta");
  assert.equal(detectNetwork("surfboard.html", "").network, undefined);
  assert.equal(detectNetwork("metal_slug_unity.html", "").network?.id, "unity");
  const byContent = detectNetwork("index.html", "<script>FbPlayableAd.onCTAClick()</script>");
  assert.equal(byContent.network?.id, "meta");
  assert.equal(byContent.by, "content");
  // MRAID is shared by several networks: no guess.
  assert.equal(detectNetwork("index.html", "<script>mraid.open(url)</script>").by, null);
});

test("checks a zipped build against the archive, not the bare HTML", () => {
  const html = `<html><head><meta name="viewport" content="width=device-width">
<meta name="ad.orientation" content="portrait,landscape">
<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>
<script src="js/main.js"></script><script>ExitApi.exit()</script></head><body><img src="img/bg.png"></body></html>`;
  const good = runStaticChecks(html, google, {
    zipBytes: 3 * 1024 * 1024,
    files: ["index.html", "js/main.js", "img/bg.png"],
    entry: "index.html",
  });
  assert.equal(overallStatus(good), "pass");
  const bad = runStaticChecks(html, google, {
    zipBytes: 6 * 1024 * 1024,
    files: ["build/index.html", "build/js/main.js"],
    entry: "build/index.html",
  });
  assert.equal(byId(bad, "size").status, "fail");
  assert.equal(byId(bad, "packaging").status, "fail");
  assert.deepEqual(byId(bad, "single-file").details, ["img/bg.png"]);
  // A single-HTML network handed a zip.
  assert.equal(
    byId(runStaticChecks(CLEAN, applovin, { zipBytes: 1000, files: ["index.html"], entry: "index.html" }), "packaging").status,
    "fail"
  );
  // A zip-only network handed a bare HTML.
  assert.equal(byId(runStaticChecks(html, google), "packaging").status, "warn");
});

test("knows the networks exporters name their files after", () => {
  for (const [file, id] of [
    ["Default Creative_aarki.zip", "aarki"],
    ["Default Creative_adcolony.html", "adcolony"],
    ["Default Creative_appreciate.zip", "appreciate"],
    ["game_ironsource.html", "ironsource"],
    ["game_iron-source_en.html", "ironsource"],
    ["game_moloco.html", "moloco"],
    ["game_vungle.zip", "vungle"],
    ["game_liftoff.zip", "liftoff"],
    ["game_unityads.html", "unity"],
    ["game_pangle.zip", "tiktok"],
  ] as const) {
    assert.equal(detectNetwork(file, "").network?.id, id, file);
  }
});

test("names an unprofiled network the way the file does", () => {
  assert.equal(networkNameFromFile("Default Creative_somedsp.html"), "Somedsp");
  assert.equal(networkNameFromFile("builds/BUS_PL06_81_newnet_en.html"), "Newnet");
  assert.equal(networkNameFromFile("index.html"), null);
  assert.equal(networkNameFromFile("build_v2_final.html"), null);
});

test("treats CDN assets, build-tool analytics and open install calls per network", () => {
  const adcolony = networkById("adcolony")!;
  const cdn = `<html><head><meta name="viewport" content="x"><script src="https://assets-1.lunalabs.io/cdn/a/scripts.js"></script><script>mraid.openStore(u)</script></head></html>`;
  assert.equal(byId(runStaticChecks(cdn, adcolony), "external-refs").status, "pass");
  assert.equal(byId(runStaticChecks(cdn, applovin), "external-refs").status, "fail");

  const assets = [{ url: "https://assets-1.lunalabs.io/cdn/a/1.png", kind: "external" as const, resourceType: "image" }];
  assert.equal(byId(runRuntimeChecks(evidence({ requests: assets }), adcolony), "network").status, "pass");

  // The exporter's own analytics never fails a build; a strict network gets a warning to confirm.
  const ping = [{ url: "https://collector.lunalabs.io/api/v1/stats/collect", kind: "telemetry" as const, resourceType: "fetch" }];
  assert.equal(byId(runRuntimeChecks(evidence({ requests: ping }), networkById("unity")), "network").status, "pass");
  assert.equal(byId(runRuntimeChecks(evidence({ requests: ping }), meta), "network").status, "warn");

  // No documented install call: any store call counts, and the source is not scanned for one.
  const snapchat = networkById("snapchat")!;
  const viaMraid = { t: 0, rt: 9000, kind: "cta" as const, api: "mraid.open" };
  assert.equal(byId(runRuntimeChecks(evidence({ adEvents: [viaMraid] }), snapchat), "cta").status, "pass");
  assert.equal(runStaticChecks(CLEAN, snapchat).some((check) => check.id === "cta-source"), false);

  // A fragment for the network's own page has no viewport tag of its own.
  assert.equal(
    runStaticChecks("<script>x</script>", networkById("appreciate")).some((check) => check.id === "viewport-meta"),
    false
  );
  // Load-only runs never reach the end of the game.
  const ready = { t: 0, rt: 100, kind: "lifecycle" as const, api: "gameReady" };
  assert.equal(
    byId(runRuntimeChecks(evidence({ adEvents: [ready], inputs: 0, firstInputAt: undefined }), mintegral), "lifecycle").status,
    "skip"
  );
});

test("restricted browser features: permissions fail, storage warns, none passes", () => {
  assert.equal(byId(runRuntimeChecks(evidence({ apiCalls: {} })), "browser-apis").status, "pass");
  assert.equal(byId(runRuntimeChecks(evidence({ apiCalls: { localStorage: 3 } })), "browser-apis").status, "warn");
  const asked = byId(runRuntimeChecks(evidence({ apiCalls: { geolocation: 1, vibrate: 2 } })), "browser-apis");
  assert.equal(asked.status, "fail");
  assert.match(asked.message, /location/);
  assert.match(asked.message, /vibrates the phone \(2 times\)/);
  assert.equal(runRuntimeChecks(evidence()).some((check) => check.id === "browser-apis"), false);
});

test("the install link must match the device's store and the app", () => {
  const cta = (detail: string) => [{ t: 0, rt: 1000, kind: "cta" as const, api: "mraid.open", detail }];
  const play = "https://play.google.com/store/apps/details?id=com.studio.game";
  assert.equal(storeLinkCheck(cta(play), "ios")?.status, "fail");
  assert.equal(storeLinkCheck(cta(play), "android", { android: "com.studio.game" })?.status, "pass");
  assert.equal(storeLinkCheck(cta(play), "android", { android: "com.other.game" })?.status, "fail");
  assert.equal(storeLinkCheck(cta(""), "android")?.status, "skip");
  assert.equal(storeLinkCheck([], "android"), null);
  assert.equal(expectedId("https://apps.apple.com/us/app/x/id1504361627", "ios"), "1504361627");
});

test("the weight breakdown finds base64 and base122 assets", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 7)]);
  const html = `<html><img src="data:image/png;base64,${png.toString("base64")}"><script>var a=1;</script></html>`;
  const report = analyseWeight(html);
  assert.equal(report.parts[0].kind, "images");
  assert.ok(report.top[0].label.includes("PNG"));
});

test("the link gate stops a check until the playable's links match the app", () => {
  const ios = "https://apps.apple.com/us/app/x/id1479305181";
  const play = "https://play.google.com/store/apps/details?id=com.blackout.word&hl=en";
  const apps = { ios: "1479305181", android: "com.blackout.word" };
  assert.equal(linkGate([ios, play], {}).verdict, "no-apps");
  assert.equal(linkGate([ios, play], apps).verdict, "ok");
  assert.equal(linkGate(["https://apps.apple.com/app/id999999999", play], apps).verdict, "mismatch");
  assert.equal(linkGate([ios], apps).verdict, "absent");
  assert.equal(linkGate([ios, play], { ios: "1479305181" }).verdict, "unknown-store");
  assert.equal(linkGate([], apps).verdict, "absent");
});
