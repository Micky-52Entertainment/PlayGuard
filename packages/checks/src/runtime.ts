import type { AdEvent } from "@playable-lab/protocol";
import type { AdNetworkProfile } from "./networks.ts";
import { storeLinkCheck } from "./store.ts";
import type { ExpectedApps, Store } from "./store.ts";
import type { CheckResult } from "./types.ts";

/** "telemetry": the build tool's own analytics, not something the author added. */
export type RequestKind = "external" | "allowed" | "missing-local" | "telemetry";

export interface ObservedRequest {
  url: string;
  kind: RequestKind;
  resourceType: string;
}

/** Everything one replay on one device observed. Pure data: no browser handles. */
export interface RuntimeEvidence {
  loaded: boolean;
  loadError?: string;
  loadMs?: number;
  pageErrors: string[];
  consoleErrors: string[];
  requests: ObservedRequest[];
  adEvents: AdEvent[];
  /** Touches / clicks / key presses actually dispatched. */
  inputs: number;
  /** Replay time of the first dispatched input, ms since load. */
  firstInputAt?: number;
  /** Share of the final frame covered by its most common colour, 0..1. */
  finalDominantRatio?: number;
  /** Mean per-pixel difference between the loaded and the final frame, 0..255. */
  changeScore?: number;
  fps?: number;
  longestFrameMs?: number;
  /** A CTA is mandatory: the source recording hit one, or the operator asked. */
  expectCta: boolean;
  /** What the page's sound output measured; absent when the probe could not run. */
  audio?: AudioEvidence;
  /** Restricted browser features the playable called, with how many times; absent when not watched. */
  apiCalls?: Record<string, number>;
}

/**
 * Browser features an ad may not use. Asking the player for a permission is
 * refused everywhere; the rest is refused by some networks and is unreliable
 * inside the WebView that shows the ad.
 */
export const RESTRICTED_APIS: Record<string, { does: string; status: "fail" | "warn" }> = {
  geolocation: { does: "asks for the player's location", status: "fail" },
  camera: { does: "asks for the camera or microphone", status: "fail" },
  notifications: { does: "asks to show notifications", status: "fail" },
  dialog: { does: "opens a browser dialog (alert, confirm or prompt)", status: "fail" },
  vibrate: { does: "vibrates the phone", status: "warn" },
  clipboard: { does: "writes to the clipboard", status: "warn" },
  share: { does: "opens the share sheet", status: "warn" },
  localStorage: { does: "writes to localStorage", status: "warn" },
  sessionStorage: { does: "writes to sessionStorage", status: "warn" },
  indexedDB: { does: "opens an IndexedDB database", status: "warn" },
  cookies: { does: "sets cookies", status: "warn" },
};

/** Loudest output (0..1 of full scale) in each part of the run. */
export interface AudioEvidence {
  /** From page load to the first touch; the whole run when nobody touched it. */
  beforeInput: number;
  afterInput: number;
  /** While the ad was hidden; undefined when that was not tried (nothing was playing). */
  hidden?: number;
}

/** Below this the output is silence, not sound: rounding noise of a muted mix. */
export const AUDIBLE_PEAK = 0.003;

export const BLANK_DOMINANT_RATIO = 0.995;
export const MIN_CHANGE_SCORE = 0.6;

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const clip = (text: string, max = 200): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export const runRuntimeChecks = (
  evidence: RuntimeEvidence,
  network?: AdNetworkProfile,
  /** The device the screen stands for, and the app the install button should lead to. */
  device?: { os: Store; apps?: ExpectedApps }
): CheckResult[] => {
  const results: CheckResult[] = [];

  results.push({
    id: "load",
    title: "Loads",
    status: evidence.loaded ? "pass" : "fail",
    message: evidence.loaded
      ? `Loaded in ${Math.round(evidence.loadMs ?? 0)} ms.`
      : `Did not finish loading: ${evidence.loadError || "timeout"}.`,
  });

  results.push({
    id: "js-errors",
    title: "No JavaScript errors",
    status:
      evidence.pageErrors.length > 0
        ? "fail"
        : evidence.consoleErrors.length > 0
          ? "warn"
          : "pass",
    message:
      evidence.pageErrors.length > 0
        ? `${plural(evidence.pageErrors.length, "uncaught exception")}.`
        : evidence.consoleErrors.length > 0
          ? `${plural(evidence.consoleErrors.length, "console.error message")}.`
          : "Console is clean.",
    details: [...evidence.pageErrors, ...evidence.consoleErrors].slice(0, 12).map((line) => clip(line)),
  });

  if (evidence.finalDominantRatio === undefined) {
    results.push({
      id: "render",
      title: "Renders something",
      status: "skip",
      message: "No frame was captured.",
    });
  } else {
    const blank = evidence.finalDominantRatio >= BLANK_DOMINANT_RATIO;
    results.push({
      id: "render",
      title: "Renders something",
      status: blank ? "fail" : "pass",
      message: blank
        ? `The final frame is a single flat colour (${(evidence.finalDominantRatio * 100).toFixed(1)}% of pixels): blank or white screen.`
        : "The final frame has content.",
    });
  }

  if (evidence.inputs === 0 || evidence.changeScore === undefined) {
    results.push({
      id: "responds",
      title: "Reacts to input",
      status: "skip",
      message: "No input was replayed.",
    });
  } else {
    const still = evidence.changeScore < MIN_CHANGE_SCORE;
    results.push({
      id: "responds",
      title: "Reacts to input",
      status: still ? "warn" : "pass",
      message: still
        ? `The screen is the same before and after ${plural(evidence.inputs, "input")}: taps may be missing their targets on this screen size.`
        : `The screen changed after ${plural(evidence.inputs, "input")}.`,
    });
  }

  const external = evidence.requests.filter((request) => request.kind === "external");
  const missing = evidence.requests.filter((request) => request.kind === "missing-local");
  const telemetry = evidence.requests.filter((request) => request.kind === "telemetry");
  const forbids = network?.externalRequests === "forbidden";
  const cdnExpected = network?.externalRequests === "allowed";
  const clean = (external.length === 0 || cdnExpected) && missing.length === 0;
  const telemetryNote =
    telemetry.length > 0
      ? ` ${plural(telemetry.length, "analytics request")} from the build tool itself, not counted.`
      : "";
  results.push({
    id: "network",
    title: "No network requests",
    status: clean ? (telemetry.length > 0 && forbids ? "warn" : "pass") : missing.length > 0 || forbids ? "fail" : "warn",
    message: clean
      ? telemetry.length > 0 && forbids
        ? `${plural(telemetry.length, "analytics request")} from the build tool itself (${new URL(telemetry[0].url).host}); ${network!.name} forbids requests, so confirm the network accepts them.`
        : external.length > 0
          ? `${plural(external.length, "request")} for assets on a CDN, as ${network!.name} builds do.${telemetryNote}`
          : `The playable ran without touching the network.${telemetryNote}`
      : [
            external.length > 0
              ? `${plural(external.length, "request")} to other hosts${network ? ` (${network.name} ${forbids ? "forbids" : "discourages"} them)` : ""}`
              : "",
            missing.length > 0
              ? `${plural(missing.length, "request")} for files that are not part of the HTML`
              : "",
          ]
            .filter(Boolean)
            .join("; ") + `.${telemetryNote}`,
    details: [...missing, ...external].slice(0, 20).map((request) => clip(`${request.resourceType} ${request.url}`)),
  });

  const ctas = evidence.adEvents.filter((event) => event.kind === "cta");
  if (ctas.length === 0) {
    results.push({
      id: "cta",
      title: "CTA opens the store",
      status: evidence.expectCta ? "fail" : evidence.inputs === 0 ? "skip" : "warn",
      message: evidence.expectCta
        ? "A store call is expected, but none happened on this device."
        : evidence.inputs === 0
          ? "No input was replayed, so the CTA was never pressed."
          : "The replay never reached a CTA. Record a session that ends with the install tap to cover it.",
    });
  } else {
    const automatic = ctas.filter(
      (event) => evidence.firstInputAt === undefined || event.rt < evidence.firstInputAt
    );
    const apis = Array.from(new Set(ctas.map((event) => event.api)));
    // A profile without a documented install call accepts any.
    const strict = network && network.ctaApis.length > 0 ? network : undefined;
    const wrong = strict ? apis.filter((api) => !strict.ctaApis.includes(api)) : [];
    const right = strict ? apis.filter((api) => strict.ctaApis.includes(api)) : apis;
    let status: CheckResult["status"] = "pass";
    let message = `Store call through ${apis.join(", ")}.`;
    if (automatic.length > 0) {
      status = "fail";
      message = `${automatic[0].api} fired before any user input: networks reject automatic redirects.`;
    } else if (strict && right.length === 0) {
      status = "fail";
      message = `CTA went through ${wrong.join(", ")}, but ${strict.name} expects ${strict.ctaCall}.`;
    } else if (strict && wrong.length > 0) {
      status = "warn";
      message = `${strict.ctaCall} was called, together with ${wrong.join(", ")} which ${strict.name} does not provide.`;
    }
    results.push({
      id: "cta",
      title: "CTA opens the store",
      status,
      message,
      details: ctas
        .slice(0, 8)
        .map((event) => clip(`${(event.rt / 1000).toFixed(1)}s ${event.api}${event.detail ? ` → ${event.detail}` : ""}`)),
    });
  }

  const link = device ? storeLinkCheck(evidence.adEvents, device.os, device.apps) : null;
  if (link) {
    results.push(link);
  }

  if (network && (network.requiredLifecycle.length > 0 || network.expectedLifecycle.length > 0)) {
    const seen = new Set(evidence.adEvents.map((event) => event.api));
    const missingRequired = network.requiredLifecycle.filter((api) => !seen.has(api));
    const missingExpected = network.expectedLifecycle.filter((api) => !seen.has(api));
    results.push({
      id: "lifecycle",
      title: `${network.name} lifecycle calls`,
      // A run without input never reaches the end of the game.
      status:
        missingRequired.length > 0
          ? "fail"
          : missingExpected.length > 0
            ? evidence.inputs === 0
              ? "skip"
              : "warn"
            : "pass",
      message:
        missingRequired.length > 0
          ? `Never called: ${missingRequired.join(", ")}.`
          : missingExpected.length > 0
            ? `${missingExpected.join(", ")} was not called in this replay; it must fire when the game ends.`
            : "All lifecycle calls were made.",
    });
  }

  if (evidence.audio) {
    const audio = evidence.audio;
    const early = audio.beforeInput > AUDIBLE_PEAK;
    const heard = early || audio.afterInput > AUDIBLE_PEAK;
    results.push({
      id: "sound-start",
      title: "Silent until the first touch",
      status: early ? "warn" : "pass",
      message: early
        ? evidence.inputs === 0
          ? "Sound played although nobody touched the ad. Ad networks require silence until the first touch."
          : "Sound started before the first touch. Ad networks require silence until the player touches the ad."
        : heard
          ? "Silent until the first touch; sound started after it."
          : "No sound was heard in this run.",
    });
    results.push({
      id: "sound-hidden",
      title: "Silent when hidden",
      status: audio.hidden === undefined ? "skip" : audio.hidden > AUDIBLE_PEAK ? "warn" : "pass",
      message:
        audio.hidden === undefined
          ? "No sound was playing, so there was nothing to stop."
          : audio.hidden > AUDIBLE_PEAK
            ? "Sound kept playing after the ad was hidden (app switched, screen locked). It must pause."
            : "Sound stopped when the ad was hidden.",
    });
  }

  if (evidence.apiCalls) {
    const used = Object.keys(evidence.apiCalls).filter((api) => RESTRICTED_APIS[api] && evidence.apiCalls![api] > 0);
    const failing = used.filter((api) => RESTRICTED_APIS[api].status === "fail");
    const times = (api: string): string => {
      const count = evidence.apiCalls![api];
      return count === 1 ? "" : ` (${count} times)`;
    };
    results.push({
      id: "browser-apis",
      title: "Restricted browser features",
      status: failing.length > 0 ? "fail" : used.length > 0 ? "warn" : "pass",
      message:
        used.length === 0
          ? "Uses none of them: no location, camera, notifications, dialogs, vibration, clipboard or browser storage."
          : failing.length > 0
            ? `The playable ${failing.map((api) => RESTRICTED_APIS[api].does + times(api)).join(", ")}. Ads may not ask the player for permissions or open dialogs: networks and stores reject this.${
                used.length > failing.length
                  ? ` It also ${used
                      .filter((api) => !failing.includes(api))
                      .map((api) => RESTRICTED_APIS[api].does + times(api))
                      .join(", ")}.`
                  : ""
              }`
            : `The playable ${used.map((api) => RESTRICTED_APIS[api].does + times(api)).join(", ")}. Several ad networks forbid this, and inside an ad's WebView it may not work at all: check the network's rules.`,
      details: used.map((api) => `${api}: ${evidence.apiCalls![api]}`),
    });
  }

  if (evidence.fps !== undefined) {
    results.push({
      id: "performance",
      title: "Performance",
      status: "info",
      message: `${evidence.fps.toFixed(0)} fps average, longest frame ${Math.round(evidence.longestFrameMs ?? 0)} ms (desktop Chromium, not a device measurement).`,
    });
  }

  return results;
};
