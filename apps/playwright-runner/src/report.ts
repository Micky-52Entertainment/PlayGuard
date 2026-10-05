import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckResult, CheckStatus, RuntimeEvidence, WeightReport } from "@playable-lab/checks";
import { FPS_ZONES, ZONE_LABEL, formatBytes, summarizeFps } from "@playable-lab/checks";
import type { FpsZone } from "@playable-lab/checks";
import type { DeviceProfile, Orientation, PerfSample } from "@playable-lab/protocol";
import type { AiRunInfo } from "./ai.ts";
import { SCENARIO_TITLE } from "./stress.ts";
import { LANGUAGE_NAMES } from "./text.ts";
import type { ScreenMarks } from "./text.ts";
import type { Scenario, StressResult } from "./stress.ts";
import { WORDS } from "./summary.ts";
import { langName, trCheck, trShot, trTitle, ui } from "./report-i18n.ts";
import type { Lang } from "./ai.ts";
import type { Answer, PlainSummary } from "./summary.ts";

export interface Shot {
  file: string;
  label: string;
}

export interface ConsoleLine {
  type: string;
  text: string;
}

export interface DeviceRun {
  id: string;
  /** The browser engine this screen ran in: iOS screens use WebKit when it is installed. */
  engine?: "chromium" | "webkit";
  /** Set for a stress run: the condition the playable was put under. */
  scenario?: Scenario;
  /** Set for a language run: the phone's language, as a code ("de"). */
  language?: string;
  /** Set for an old-phone run: which one it stands for ("iOS 13"). */
  old?: string;
  /** The words read on screen during the run, for comparing languages. */
  strings?: string[];
  /** What the report draws over the screen's picture. */
  marks?: ScreenMarks;
  /** What the scenario measured: time to the first picture, memory, the turns. */
  stressResult?: StressResult;
  device: DeviceProfile;
  orientation: Orientation;
  cssWidth: number;
  cssHeight: number;
  status: "pass" | "warn" | "fail";
  checks: CheckResult[];
  shots: Shot[];
  video?: string;
  evidence: RuntimeEvidence;
  console: ConsoleLine[];
  /** Present when the AI tester played on, or looked at, this screen. */
  ai?: AiRunInfo;
}

export interface RunReport {
  generatedAt: string;
  /** Who ran the check. */
  by?: string;
  status: "pass" | "warn" | "fail";
  playable: { name: string; bytes: number; engine: string };
  network?: { id: string; name: string; guessed: boolean; notes: string[]; docs?: string };
  trace?: {
    sessionId: string;
    /** The other orientation's recording, when both were played. */
    also?: string[];
    stepId?: string;
    inputs: number;
    durationMs: number;
    timing: string;
  };
  fileChecks: CheckResult[];
  /** What takes the space in the file: images, sound, code. */
  weight?: WeightReport;
  /** Frame rate recorded on the phone during the session. */
  perf?: PerfSample[];
  runs: DeviceRun[];
  /** Stress scenarios, each on one phone screen. */
  stress?: DeviceRun[];
  /** The same playable with the phone in other languages, on the narrowest phone. */
  languages?: DeviceRun[];
  /** Played as on old phones: iOS 13, iOS 14, Android 8–9. */
  oldPhones?: DeviceRun[];
  /** Quick (main screens only) or full (also stress, languages, old phones). */
  depth?: "quick" | "full";
  /** Set for an AI autoplay run: who played and what it cost. */
  ai?: {
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    budget: number;
  };
  summary?: PlainSummary;
}

/** The PlayGuard logo inside the page, so a report stays one folder that opens anywhere. */
const LOGO_URI = (() => {
  try {
    const root = process.env.PLAYGUARD_ROOT ? path.resolve(process.env.PLAYGUARD_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    return `data:image/png;base64,${readFileSync(path.join(root, "apps/lab-console/public/favicon.png")).toString("base64")}`;
  } catch {
    return "";
  }
})();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const GLYPH: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "!",
  fail: "✕",
  info: "i",
  skip: "–",
};

/** The language of the page being rendered: the reader's, as chosen for the summary. */
let L: Lang = "en";
const t = (key: string, vars?: Record<string, string | number>): string => ui(L, key, vars);

const LABEL = new Proxy({} as Record<CheckStatus, string>, { get: (_, status: string) => t(status) });

const badge = (status: CheckStatus, text?: string): string =>
  `<span class="badge ${status}"><span class="glyph" aria-hidden="true">${GLYPH[status]}</span>${escapeHtml(text ?? LABEL[status])}</span>`;

const checkList = (checks: CheckResult[]): string =>
  `<ul class="checks">${checks
    .map((original) => trCheck(L, original))
    .map(
      (check) => `<li class="check">
        <span class="mark ${check.status}" title="${LABEL[check.status]}">${GLYPH[check.status]}<span class="sr">${LABEL[check.status]}</span></span>
        <div>
          <div class="check-title">${escapeHtml(check.title)}</div>
          <div class="check-message">${escapeHtml(check.message)}</div>
          ${
            check.details && check.details.length
              ? `<ul class="details">${check.details.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
              : ""
          }
        </div>
      </li>`
    )
    .join("")}</ul>`;

const matrix = (runs: DeviceRun[]): string => {
  const rows: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = 0; j < runs[i].checks.length; j += 1) {
      const check = runs[i].checks[j];
      if (check.status !== "info" && !rows.some((row) => row.id === check.id)) {
        rows.push({ id: check.id, title: trTitle(L, check) });
      }
    }
  }
  const head = runs
    .map(
      (run) =>
        `<th scope="col"><a href="#${escapeHtml(run.id)}">${escapeHtml(run.device.name)}</a><span class="dim">${run.cssWidth}×${run.cssHeight}${run.engine === "webkit" ? " · WebKit" : ""}</span></th>`
    )
    .join("");
  const body = rows
    .map((row) => {
      const cells = runs
        .map((run) => {
          const check = run.checks.find((item) => item.id === row.id);
          if (!check) {
            return "<td></td>";
          }
          return `<td><span class="mark ${check.status}" title="${escapeHtml(trCheck(L, check).message)}">${GLYPH[check.status]}<span class="sr">${LABEL[check.status]}</span></span></td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(row.title)}</th>${cells}</tr>`;
    })
    .join("");
  const verdicts = runs.map((run) => `<td>${badge(run.status)}</td>`).join("");
  return `<div class="scroll"><table class="matrix">
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">${t("verdict")}</th>${verdicts}</tr></tfoot>
  </table></div>`;
};

const ANSWER_STATUS: Record<Answer, CheckStatus> = { yes: "pass", partly: "warn", no: "fail", unknown: "skip" };

const summarySection = (summary: PlainSummary | undefined): string => {
  if (!summary) {
    return "";
  }
  const words = WORDS[summary.lang];
  const groups = (["no", "partly", "unknown", "yes"] as Answer[])
    .map((answer) => {
      const rows = summary.rows.filter((row) => row.answer === answer);
      if (rows.length === 0) {
        return "";
      }
      return `<h3 class="group ${ANSWER_STATUS[answer]}">${escapeHtml(words.group[answer])} <span class="dim">${rows.length}</span></h3>
      <ul class="answers">${rows
        .map(
          (row) => `<li>
          <span class="mark ${ANSWER_STATUS[answer]}">${GLYPH[ANSWER_STATUS[answer]]}<span class="sr">${escapeHtml(words.answer[answer])}</span></span>
          <div>
            <div class="check-title">${escapeHtml(row.question)}</div>
            <div class="answer-text">${escapeHtml(row.text)}</div>
            ${row.where ? `<div class="where">${escapeHtml(row.where)}</div>` : ""}
            ${row.items ? `<ul class="items">${row.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
          </div>
        </li>`
        )
        .join("")}</ul>`;
    })
    .join("");
  const status: CheckStatus = summary.verdict === "fix" ? "fail" : summary.verdict === "check" ? "warn" : "pass";
  return `<section class="summary ${status}" lang="${summary.lang}">
    <div class="verdict"><span class="mark ${status}" aria-hidden="true">${GLYPH[status]}</span>${escapeHtml(summary.headline)}</div>
    <div class="orientations">${summary.orientations.map((item) => badge(item.status, item.label)).join("")}</div>
    ${groups}
  </section>`;
};

const aiSection = (run: DeviceRun): string => {
  const ai = run.ai;
  if (!ai || ai.turns.length === 0) {
    return "";
  }
  return `<details><summary>${t("aiDid", { n: ai.turns.length })}</summary><pre>${ai.turns
    .map((turn) =>
      escapeHtml(
        `${String(turn.turn).padStart(2)}. ${(turn.at / 1000).toFixed(1).padStart(5)}s  ${turn.see}\n      ${turn.actions.join("; ") || t("noInput")}${turn.changed === false ? `   ${t("unchanged")}` : ""}`
      )
    )
    .join("\n")}</pre></details>`;
};

/** A screen's name as the reader knows it: a device, a stress condition, or a phone language. */
const runTitle = (run: DeviceRun): string =>
  run.scenario
    ? trTitle(L, { id: run.scenario, title: SCENARIO_TITLE[run.scenario] })
    : run.language
      ? t("phoneIn", { lang: L === "en" ? LANGUAGE_NAMES[run.language] || run.language : langName(L, run.language) })
      : run.old
        ? t("oldPhone", { name: run.old })
        : run.device.name;

/**
 * The screens as cards, first thing on the page: each picture with frames
 * round text that has a problem and numbered dots where the playthrough
 * tapped, and the remarks of that screen under it.
 */
const glanceSection = (report: RunReport): string => {
  const all = [...report.runs, ...(report.stress || []), ...(report.languages || []), ...(report.oldPhones || [])];
  if (all.length === 0) {
    return "";
  }
  const cards = all
    .map((run) => {
      const shot = run.marks?.shot || (run.shots.find((item) => item.label === "final") || run.shots[run.shots.length - 1])?.file;
      const remarks = run.checks
        .filter((check) => check.status === "fail" || check.status === "warn")
        .map((check) => trCheck(L, check));
      const boxes = (run.marks?.boxes || [])
        .map(
          (box) =>
            `<span class="mk-box ${box.issue}" style="left:${(box.x * 100).toFixed(1)}%;top:${(box.y * 100).toFixed(1)}%;width:${(box.w * 100).toFixed(1)}%;height:${(box.h * 100).toFixed(1)}%" title="${escapeHtml(box.text)}"></span>`
        )
        .join("");
      const taps = (run.marks?.taps || [])
        .map(
          (tap, index) =>
            `<span class="mk-tap" style="left:${(tap.x * 100).toFixed(1)}%;top:${(tap.y * 100).toFixed(1)}%">${index + 1}</span>`
        )
        .join("");
      return `<a class="glance ${run.status}" href="#${escapeHtml(run.id)}">
        <span class="glance-shot" style="aspect-ratio:${run.cssWidth} / ${run.cssHeight};width:min(100%, ${Math.round((300 * run.cssWidth) / run.cssHeight)}px)">
          ${shot ? `<img loading="lazy" src="${escapeHtml(shot)}" alt="" />` : ""}
          ${boxes}${taps}
        </span>
        <span class="glance-body">
          <span class="glance-head"><b>${escapeHtml(runTitle(run))}</b>${badge(run.status)}</span>
          <span class="dim">${run.scenario || run.language || run.old ? `${escapeHtml(run.device.name)} · ` : ""}${run.cssWidth}×${run.cssHeight} · ${t(run.orientation)}</span>
          ${
            remarks.length > 0
              ? `<ul class="glance-notes">${remarks
                  .slice(0, 3)
                  .map((check) => `<li><span class="mark ${check.status}">${GLYPH[check.status]}</span>${escapeHtml(check.title)}</li>`)
                  .join("")}${remarks.length > 3 ? `<li class="dim">+${remarks.length - 3} ${t("more")}</li>` : ""}</ul>`
              : `<span class="glance-ok">${t("noIssues")}</span>`
          }
        </span>
      </a>`;
    })
    .join("");
  return `<h2>${t("glance")}</h2>
  <p class="dim glance-hint">${t("glanceHint")}</p>
  <div class="glances">${cards}</div>`;
};

const deviceSection = (run: DeviceRun): string => {
  const shots = run.shots
    .map(
      (shot) => `<figure>
        <a href="${escapeHtml(shot.file)}"><img loading="lazy" src="${escapeHtml(shot.file)}" alt="${escapeHtml(`${run.device.name}: ${trShot(L, shot.label)}`)}" /></a>
        <figcaption>${escapeHtml(trShot(L, shot.label))}</figcaption>
      </figure>`
    )
    .join("");
  const requests = run.evidence.requests;
  const logs = run.console;
  return `<section class="device" id="${escapeHtml(run.id)}">
    <header>
      <h3>${escapeHtml(runTitle(run))}</h3>
      ${run.ai?.mode === "play" ? `<span class="tag">${t("aiPlayed")}</span>` : ""}
      ${run.engine === "webkit" ? `<span class="tag">${t("safari")}</span>` : ""}
      ${run.scenario || run.language || run.old ? `<span class="dim">${escapeHtml(run.device.name)}</span>` : ""}
      <span class="dim">${run.cssWidth}×${run.cssHeight} · @${run.device.dpr}x · ${t(run.orientation)}</span>
      ${badge(run.status)}
    </header>
    <div class="shots">${shots}</div>
    ${checkList(run.checks)}
    ${aiSection(run)}
    ${
      run.video
        ? `<details><summary>${run.ai?.mode === "play" ? t("videoAi") : t("video")}</summary><video controls preload="none" src="${escapeHtml(run.video)}"></video></details>`
        : ""
    }
    ${
      run.evidence.adEvents.length
        ? `<details><summary>${t("adCalls")} (${run.evidence.adEvents.length})</summary><pre>${run.evidence.adEvents
            .map((event) =>
              escapeHtml(`${(event.rt / 1000).toFixed(2).padStart(7)}s  ${event.kind.padEnd(9)} ${event.api}${event.detail ? `  ${event.detail}` : ""}`)
            )
            .join("\n")}</pre></details>`
        : ""
    }
    ${
      requests.length
        ? `<details><summary>${t("requests")} (${requests.length})</summary><pre>${requests
            .map((request) => escapeHtml(`${request.kind.padEnd(13)} ${request.resourceType.padEnd(10)} ${request.url}`))
            .join("\n")}</pre></details>`
        : ""
    }
    ${
      logs.length
        ? `<details><summary>${t("console")} (${logs.length})</summary><pre>${logs
            .map((line) => escapeHtml(`[${line.type}] ${line.text}`))
            .join("\n")}</pre></details>`
        : ""
    }
  </section>`;
};

const ZONE_STATUS: Record<FpsZone, CheckStatus> = { green: "pass", yellow: "warn", red: "fail" };

const clock = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const fpsSection = (perf: PerfSample[] | undefined): string => {
  const summary = summarizeFps(perf || []);
  if (!perf || !summary) {
    return "";
  }
  const width = 1100;
  const height = 190;
  const margin = { top: 10, right: 12, bottom: 24, left: 34 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const yMax = Math.max(60, Math.ceil(summary.max / 30) * 30);
  const xMax = Math.max(10000, perf[perf.length - 1].at);
  const x = (at: number): number => margin.left + (at / xMax) * plotW;
  const y = (fps: number): number => margin.top + (1 - Math.min(fps, yMax) / yMax) * plotH;
  const bands: Array<{ zone: FpsZone; from: number; to: number }> = [
    { zone: "green", from: yMax, to: FPS_ZONES.green },
    { zone: "yellow", from: FPS_ZONES.green, to: FPS_ZONES.yellow },
    { zone: "red", from: FPS_ZONES.yellow, to: 0 },
  ];
  const step = xMax <= 60000 ? 10000 : xMax <= 180000 ? 30000 : 60000;
  const ticks: number[] = [];
  for (let at = 0; at <= xMax; at += step) {
    ticks.push(at);
  }
  const loaded = perf.find((sample) => sample.rt > 0);
  const loadAt = loaded ? loaded.at - loaded.rt : 0;
  const path = perf
    .map((sample, index) => `${index === 0 ? "M" : "L"}${x(sample.at).toFixed(1)},${y(sample.fps).toFixed(1)}`)
    .join("");
  const zones: FpsZone[] = ["green", "yellow", "red"];
  return `<h2>${t("fps")}</h2>
  <div class="card">
    <div class="fps-head">
      ${badge(ZONE_STATUS[summary.zone], t("fpsAvg", { n: summary.average.toFixed(0) }))}
      <span class="dim">${t("fpsWorst")} <b>${summary.min.toFixed(0)} fps</b> · ${t("fpsRecorded", { time: clock(summary.durationMs) })}</span>
      <span class="fps-zones">${zones
        .map(
          (zone) =>
            `<span><span class="mark ${ZONE_STATUS[zone]}">${GLYPH[ZONE_STATUS[zone]]}</span> ${escapeHtml(t(`zone.${zone}`) === `zone.${zone}` ? ZONE_LABEL[zone] : t(`zone.${zone}`))} <b>${Math.round(summary.share[zone] * 100)}%</b></span>`
        )
        .join("")}</span>
    </div>
    <div class="scroll"><svg class="fps" viewBox="0 0 ${width} ${height}" role="img" aria-label="Phone frame rate over the session, ${summary.average.toFixed(0)} fps average">
      ${bands
        .map(
          (band) =>
            `<rect class="band ${band.zone}" x="${margin.left}" y="${y(band.from).toFixed(1)}" width="${plotW}" height="${Math.max(0, y(band.to) - y(band.from) - 2).toFixed(1)}" />`
        )
        .join("")}
      ${[0, FPS_ZONES.yellow, FPS_ZONES.green, yMax]
        .map((value) => `<text class="tick" x="${margin.left - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${value}</text>`)
        .join("")}
      ${ticks
        .map((at) => `<text class="tick" x="${x(at).toFixed(1)}" y="${height - 6}" text-anchor="${at === 0 ? "start" : "middle"}">${clock(at)}</text>`)
        .join("")}
      ${
        loadAt > 0
          ? `<line class="rule" x1="${x(loadAt).toFixed(1)}" x2="${x(loadAt).toFixed(1)}" y1="${margin.top}" y2="${margin.top + plotH}" /><text class="tick" x="${(x(loadAt) + 4).toFixed(1)}" y="${margin.top + 11}">${t("fpsLoaded")}</text>`
          : ""
      }
      <path class="line" d="${path}" />
      ${perf
        .map(
          (sample) =>
            `<circle class="hit" cx="${x(sample.at).toFixed(1)}" cy="${y(sample.fps).toFixed(1)}" r="7"><title>${sample.fps.toFixed(0)} fps at ${clock(sample.at)} · longest frame ${sample.worstFrameMs} ms</title></circle>`
        )
        .join("")}
    </svg></div>
  </div>`;
};

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --card: #ffffff; --text: #16181d; --dim: #626a76; --line: #dfe3e8;
  --pass: #17794a; --pass-bg: #e3f4ea; --warn: #8a5a00; --warn-bg: #fdf0d2;
  --fail: #b3261e; --fail-bg: #fbe4e2; --info: #2c5a9e; --info-bg: #e4edf9; --skip: #626a76; --skip-bg: #eceef1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111317; --card: #1a1d23; --text: #e8eaee; --dim: #9aa2ae; --line: #2c313a;
    --pass: #6fd39b; --pass-bg: #163524; --warn: #f0c060; --warn-bg: #3a2c0c;
    --fail: #ff8a80; --fail-bg: #40191a; --info: #8db8f5; --info-bg: #182a44; --skip: #9aa2ae; --skip-bg: #262a31;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin: 36px 0 12px; font-weight: 600; }
h3 { font-size: 16px; margin: 0; }
a { color: inherit; }
.dim { color: var(--dim); }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 10px; color: var(--dim); }
.meta b { color: var(--text); font-weight: 600; }
.card, .device { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.device { margin-bottom: 16px; }
.device header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.device header .badge { margin-left: auto; }
.badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px 2px 4px; font-weight: 600; font-size: 12px; white-space: nowrap; }
.badge .glyph, .mark { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-weight: 700; flex: none; }
.badge.pass, .mark.pass { color: var(--pass); background: var(--pass-bg); }
.badge.warn, .mark.warn { color: var(--warn); background: var(--warn-bg); }
.badge.fail, .mark.fail { color: var(--fail); background: var(--fail-bg); }
.badge.info, .mark.info { color: var(--info); background: var(--info-bg); }
.badge.skip, .mark.skip { color: var(--skip); background: var(--skip-bg); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.scroll { overflow-x: auto; }
table.matrix { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.matrix th, .matrix td { padding: 8px 12px; border-bottom: 1px solid var(--line); text-align: center; }
.matrix th[scope=row] { text-align: left; font-weight: 500; white-space: nowrap; }
.matrix thead th { font-weight: 600; font-size: 12px; vertical-align: bottom; }
.matrix thead .dim { display: block; font-weight: 400; font-variant-numeric: tabular-nums; }
.matrix tfoot th, .matrix tfoot td { border-bottom: 0; }
.checks { list-style: none; margin: 0; padding: 0; }
.check { display: flex; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); }
.check:first-child { border-top: 0; }
.check .mark { margin-top: 1px; }
.check-title { font-weight: 600; }
.check-message { color: var(--dim); }
.details { margin: 4px 0 0; padding-left: 18px; color: var(--dim); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.shots { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 10px; }
.shots figure { margin: 0; flex: none; }
.shots img { display: block; height: 240px; width: auto; border: 1px solid var(--line); border-radius: 6px; background: #000; }
.shots figcaption { font-size: 12px; color: var(--dim); margin-top: 4px; }
details { border-top: 1px solid var(--line); padding: 8px 0 0; margin-top: 8px; }
summary { cursor: pointer; font-weight: 600; }
pre { overflow-x: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dim); margin: 8px 0 0; white-space: pre-wrap; word-break: break-all; }
video { display: block; max-height: 480px; max-width: 100%; margin-top: 8px; border-radius: 6px; background: #000; }
.fps-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 8px; }
.fps-head b { color: var(--text); }
.fps-zones { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-left: auto; color: var(--dim); }
.fps-zones span { display: inline-flex; align-items: center; gap: 6px; }
svg.fps { display: block; width: 100%; min-width: 560px; height: auto; }
svg.fps .band.green { fill: #0ca30c; fill-opacity: 0.14; }
svg.fps .band.yellow { fill: #fab219; fill-opacity: 0.16; }
svg.fps .band.red { fill: #d03b3b; fill-opacity: 0.14; }
svg.fps .line { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
svg.fps .tick { fill: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums; }
svg.fps .rule { stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 3; }
svg.fps .hit { fill: transparent; }
svg.fps .hit:hover { fill: var(--text); }
.notes { margin: 8px 0 0; padding-left: 18px; color: var(--dim); }
.tag { font-size: 12px; font-weight: 600; color: var(--info); background: var(--info-bg); border-radius: 999px; padding: 1px 9px; }
.summary { background: var(--card); border: 1px solid var(--line); border-left: 6px solid var(--skip); border-radius: 10px; padding: 20px 22px; margin-top: 22px; }
.summary.pass { border-left-color: var(--pass); }
.summary.warn { border-left-color: var(--warn); }
.summary.fail { border-left-color: var(--fail); }
.verdict { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; }
.verdict .mark { width: 34px; height: 34px; font-size: 18px; }
.orientations { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.summary h3.group { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin: 20px 0 4px; }
.summary h3.group.fail { color: var(--fail); }
.summary h3.group.warn { color: var(--warn); }
.summary h3.group.pass { color: var(--pass); }
.summary h3.group.skip { color: var(--skip); }
.summary h3.group .dim { font-weight: 400; }
.answers { list-style: none; margin: 0; padding: 0; }
.answers > li { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 15px; }
.answers > li:first-child { border-top: 0; }
.answers .mark { margin-top: 2px; }
.where { color: var(--dim); font-size: 13px; margin-top: 2px; }
.items { margin: 4px 0 0; padding-left: 18px; }
.glance-hint { margin: -4px 0 12px; }
.glances { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.glance { display: flex; flex-direction: column; gap: 10px; background: var(--card); border: 1px solid var(--line); border-top: 4px solid var(--skip); border-radius: 12px; padding: 12px; color: inherit; text-decoration: none; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.glance:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); }
.glance.pass { border-top-color: var(--pass); }
.glance.warn { border-top-color: var(--warn); }
.glance.fail { border-top-color: var(--fail); }
.glance-shot { position: relative; display: block; margin: 0 auto; border-radius: 8px; overflow: hidden; background: #000; }
.glance-shot img { display: block; width: 100%; height: 100%; object-fit: contain; }
.glance-body { display: flex; flex-direction: column; gap: 4px; }
.glance-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; }
.glance { min-width: 0; overflow: hidden; }
.glance-notes { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.glance-notes li { display: flex; gap: 6px; align-items: flex-start; }
.glance-ok { color: var(--pass); font-size: 13px; }
.mk-box { position: absolute; border: 2px solid #ff3b30; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); }
.mk-box.small { border-color: #ff9f0a; }
.mk-tap { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: rgba(30, 91, 255, 0.85); border: 2px solid #fff; color: #fff; font: 700 9px/14px sans-serif; text-align: center; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5); }
@media (max-width: 640px) {
  main { padding: 18px 14px 48px; }
  h1 { font-size: 20px; }
  .top { flex-wrap: wrap; }
  .glances { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .glance { padding: 8px; }
  .shots img { height: 180px; }
  .verdict { font-size: 19px; }
  .summary { padding: 16px; }
  .device header { gap: 6px; }
  .device header .badge { margin-left: 0; }
  .check { font-size: 13px; }
}
`;

export const renderReport = (report: RunReport): string => {
  L = report.summary?.lang || "en";
  const failed = report.runs.filter((run) => run.status === "fail").length;
  const warned = report.runs.filter((run) => run.status === "warn").length;
  const n = report.runs.length;
  const summary =
    report.status === "pass"
      ? t("allPassed", { n })
      : report.status === "fail"
        ? `${t("failed", { f: failed, n })}${report.fileChecks.some((check) => check.status === "fail") ? t("fileFailed") : ""}`
        : `${t("warned")}${warned ? t("warnedOn", { w: warned, n }) : ""}`;
  const notes = report.network ? report.network.notes.map((note) => trCheck(L, { id: "", title: "", status: "info", message: note }).message) : [];

  return `<!DOCTYPE html>
<html lang="${L}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.playable.name)} · ${t("title")}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="top">
    ${LOGO_URI ? `<img src="${LOGO_URI}" alt="PlayGuard" width="34" height="34" />` : ""}
    <h1>${escapeHtml(report.playable.name)}</h1>
    ${badge(report.status, summary)}
  </div>
  <div class="meta">
    <span><b>${formatBytes(report.playable.bytes)}</b> · ${escapeHtml(report.playable.engine)}</span>
    <span>${t("network")}: <b>${report.network ? escapeHtml(report.network.name) : t("notSet")}</b>${report.network?.guessed ? ` ${t("guessed")}` : ""}</span>
    ${
      report.trace
        ? `<span>${t("trace")}: <b>${escapeHtml(report.trace.sessionId)}</b>${report.trace.stepId ? ` · ${escapeHtml(report.trace.stepId)}` : ""} · ${report.trace.inputs} ${t("inputs")} · ${(report.trace.durationMs / 1000).toFixed(1)} s</span>`
        : report.ai
          ? `<span>${t("aiAutoplay")}: <b>${escapeHtml(report.ai.provider)}</b> · ${escapeHtml(report.ai.model)} · ${report.ai.calls} ${t("calls")} · ${(report.ai.inputTokens + report.ai.outputTokens).toLocaleString(L)} ${t("tokens")}</span>`
          : `<span>${t("smoke")}</span>`
    }
    <span>${escapeHtml(report.generatedAt)}</span>
  </div>

  ${glanceSection(report)}

  ${summarySection(report.summary)}

  <h2>${t("screens")}</h2>
  ${matrix(report.runs)}

  ${fpsSection(report.perf)}

  <h2>${t("file")}</h2>
  <div class="card">
    ${checkList(report.fileChecks)}
    ${
      report.network
        ? `<details><summary>${escapeHtml(report.network.name)}: ${t("requirements")}</summary>
            <ul class="notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
            ${report.network.docs ? `<p class="dim">${t("spec")}: <a href="${escapeHtml(report.network.docs)}">${escapeHtml(report.network.docs)}</a></p>` : ""}
          </details>`
        : ""
    }
  </div>

  ${
    report.stress && report.stress.length > 0
      ? `<h2>${t("stress")}</h2>\n${report.stress.map(deviceSection).join("\n")}`
      : ""
  }

  ${
    report.languages && report.languages.length > 0
      ? `<h2>${t("languages")}</h2>\n${report.languages.map(deviceSection).join("\n")}`
      : ""
  }

  ${
    report.oldPhones && report.oldPhones.length > 0
      ? `<h2>${t("oldPhones")}</h2>\n<p class="dim">${t("oldPhonesHint")}</p>\n${report.oldPhones.map(deviceSection).join("\n")}`
      : ""
  }

  <h2>${t("perScreen")}</h2>
  ${report.runs.map(deviceSection).join("\n")}
</main>
</body>
</html>
`;
};
