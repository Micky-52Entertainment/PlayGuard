import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { formatBytes, summarizeFps } from "@playable-lab/checks";
import type { RunReport } from "../../playwright-runner/src/report.ts";
import { summarize } from "../../playwright-runner/src/summary.ts";
import type { Answer } from "../../playwright-runner/src/summary.ts";
import { brandMark } from "./brand.ts";
import type { Lang } from "./runner.ts";

/** A video larger than this is left out: the page has to travel through a messenger. */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

interface Texts {
  title: string;
  verdicts: Record<"pass" | "warn" | "fail", string>;
  video: (screen: string) => string;
  touch: string;
  store: string;
  noVideo: (screen: string) => string;
  numbers: string;
  answers: string;
  fine: string;
  made: string;
  stat: {
    screens: string;
    screensValue: (clean: number, total: number) => string;
    played: string;
    playedTrace: (touches: number, seconds: string) => string;
    playedAi: (name: string) => string;
    playedNone: string;
    firstTouch: string;
    store: string;
    storeNever: string;
    storeNotTried: string;
    seconds: (value: string) => string;
    phoneFps: string;
    fpsValue: (fps: string) => string;
    size: string;
    weight: string;
    kinds: Record<"images" | "audio" | "video" | "fonts" | "code" | "data", string>;
    download: string;
    downloadValue: (slow: string, fast: string) => string;
    memory: string;
    memoryValue: (mb: string, growth: string) => string;
    errors: string;
    errorsNone: string;
    errorsValue: (count: number) => string;
    network: string;
    networkNone: string;
    date: string;
  };
  legend: Record<Answer, string>;
}

const TEXTS: Record<Lang, Texts> = {
  en: {
    title: "Playable check",
    verdicts: { pass: "Ready", warn: "Needs a look", fail: "Not ready" },
    video: (screen) => `The playthrough on ${screen}`,
    touch: "a touch (click to jump to it)",
    store: "the store opens",
    noVideo: (screen) => `The last frame on ${screen} (no video was recorded in this check)`,
    numbers: "In numbers",
    answers: "What was checked",
    fine: "Fine",
    made: "Made with PlayGuard",
    stat: {
      screens: "Screens without remarks",
      screensValue: (clean, total) => `${clean} of ${total}`,
      played: "Playthrough",
      playedTrace: (touches, seconds) => `${touches} ${touches === 1 ? "touch" : "touches"}, ${seconds} s`,
      playedAi: (name) => `by the AI tester (${name})`,
      playedNone: "none: only opened",
      firstTouch: "First touch after",
      store: "Store opened after",
      storeNever: "never opened",
      storeNotTried: "not pressed",
      seconds: (value) => `${value} s`,
      phoneFps: "Smoothness on the phone",
      fpsValue: (fps) => `${fps} frames a second`,
      size: "File size",
      weight: "What the file is made of",
      kinds: { images: "images", audio: "sound", video: "video", fonts: "fonts", code: "code", data: "packed data" },
      download: "Download time",
      downloadValue: (slow, fast) => `${slow} on 3G · ${fast} on 4G`,
      memory: "Memory when left idle",
      memoryValue: (mb, growth) => `${mb} MB (${growth})`,
      errors: "Errors in the console",
      errorsNone: "none",
      errorsValue: (count) => `${count}`,
      network: "Ad network",
      networkNone: "not set",
      date: "Checked",
    },
    legend: { yes: "fine", partly: "needs a look", no: "has to be fixed", unknown: "not tested" },
  },
  ru: {
    title: "Проверка плеебла",
    verdicts: { pass: "Готов", warn: "Нужно посмотреть", fail: "Не готов" },
    video: (screen) => `Прохождение на экране ${screen}`,
    touch: "касание (нажмите, чтобы перейти к нему)",
    store: "открытие магазина",
    noVideo: (screen) => `Последний кадр на экране ${screen} (видео в этой проверке не записывалось)`,
    numbers: "В цифрах",
    answers: "Что проверено",
    fine: "В порядке",
    made: "Сделано в PlayGuard",
    stat: {
      screens: "Экранов без замечаний",
      screensValue: (clean, total) => `${clean} из ${total}`,
      played: "Прохождение",
      playedTrace: (touches, seconds) => `касаний: ${touches}, ${seconds} с`,
      playedAi: (name) => `AI-тестер (${name})`,
      playedNone: "нет: только запуск",
      firstTouch: "Первое касание через",
      store: "Магазин открылся через",
      storeNever: "не открылся",
      storeNotTried: "кнопку не нажимали",
      seconds: (value) => `${value} с`,
      phoneFps: "Плавность на телефоне",
      fpsValue: (fps) => `${fps} кадров в секунду`,
      size: "Размер файла",
      weight: "Из чего состоит файл",
      kinds: { images: "картинки", audio: "звук", video: "видео", fonts: "шрифты", code: "код", data: "упакованные данные" },
      download: "Время загрузки",
      downloadValue: (slow, fast) => `${slow} на 3G · ${fast} на 4G`,
      memory: "Память без касаний",
      memoryValue: (mb, growth) => `${mb} МБ (${growth})`,
      errors: "Ошибки в консоли",
      errorsNone: "нет",
      errorsValue: (count) => `${count}`,
      network: "Рекламная сеть",
      networkNone: "не выбрана",
      date: "Проверено",
    },
    legend: { yes: "в порядке", partly: "стоит посмотреть", no: "нужно исправить", unknown: "не проверялось" },
  },
  fr: {
    title: "Vérification du playable",
    verdicts: { pass: "Prêt", warn: "À vérifier", fail: "Pas prêt" },
    video: (screen) => `La partie sur ${screen}`,
    touch: "un toucher (cliquez pour y aller)",
    store: "ouverture du store",
    noVideo: (screen) => `La dernière image sur ${screen} (aucune vidéo n'a été enregistrée)`,
    numbers: "En chiffres",
    answers: "Ce qui a été vérifié",
    fine: "Correct",
    made: "Réalisé avec PlayGuard",
    stat: {
      screens: "Écrans sans remarque",
      screensValue: (clean, total) => `${clean} sur ${total}`,
      played: "Partie jouée",
      playedTrace: (touches, seconds) => `${touches} toucher${touches === 1 ? "" : "s"}, ${seconds} s`,
      playedAi: (name) => `par le testeur IA (${name})`,
      playedNone: "aucune : ouverture seule",
      firstTouch: "Premier toucher après",
      store: "Store ouvert après",
      storeNever: "jamais ouvert",
      storeNotTried: "bouton non pressé",
      seconds: (value) => `${value} s`,
      phoneFps: "Fluidité sur le téléphone",
      fpsValue: (fps) => `${fps} images par seconde`,
      size: "Taille du fichier",
      weight: "Composition du fichier",
      kinds: { images: "images", audio: "son", video: "vidéo", fonts: "polices", code: "code", data: "données compressées" },
      download: "Temps de téléchargement",
      downloadValue: (slow, fast) => `${slow} en 3G · ${fast} en 4G`,
      memory: "Mémoire au repos",
      memoryValue: (mb, growth) => `${mb} Mo (${growth})`,
      errors: "Erreurs dans la console",
      errorsNone: "aucune",
      errorsValue: (count) => `${count}`,
      network: "Réseau publicitaire",
      networkNone: "non défini",
      date: "Vérifié",
    },
    legend: { yes: "correct", partly: "à vérifier", no: "à corriger", unknown: "non testé" },
  },
};

const GLYPH: Record<Answer, string> = { yes: "✓", partly: "!", no: "✕", unknown: "–" };
const VERDICT_ANSWER = { pass: "yes", warn: "partly", fail: "no" } as const;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; color: #16181d; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 40px; }
.card { background: #fff; border: 1px solid #dfe3e8; border-radius: 12px; padding: 20px 22px; margin-bottom: 14px; }
.eyebrow { margin: 0 0 4px; color: #626a76; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
h1 { margin: 0; font-size: 22px; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere; }
h2 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #626a76; }
.verdict { display: flex; align-items: center; gap: 12px; margin-top: 14px; font-size: 20px; font-weight: 700; }
.verdict.yes { color: #17794a; } .verdict.partly { color: #8a5a00; } .verdict.no { color: #b3261e; }
.mark { display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700; }
.verdict .mark { width: 36px; height: 36px; font-size: 19px; }
.mark.yes { color: #17794a; background: #e3f4ea; } .mark.partly { color: #8a5a00; background: #fdf0d2; }
.mark.no { color: #b3261e; background: #fbe4e2; } .mark.unknown { color: #626a76; background: #eceef1; }
.headline { margin: 6px 0 0; color: #626a76; }
.cols { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
.cols.wide { grid-template-columns: 1fr; }
video, .shot { display: block; width: 100%; max-height: 560px; object-fit: contain; border-radius: 8px; background: #000; }
figure { margin: 0; } figcaption { margin-top: 8px; color: #626a76; font-size: 12px; }
dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px 18px; margin: 0; }
dt { color: #626a76; font-size: 12px; } dd { margin: 0; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
ul { margin: 0; padding: 0; list-style: none; }
.rows li { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid #eceef1; }
.rows li:first-child { border-top: 0; }
.rows .q { font-weight: 600; } .rows .where { color: #626a76; font-size: 12px; }
.fine { display: flex; flex-wrap: wrap; gap: 6px 8px; margin-top: 12px; }
.fine span { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 4px; border-radius: 999px; background: #f3f4f6; font-size: 12px; }
.fine .mark { width: 18px; height: 18px; font-size: 10px; }
footer { color: #9aa2ae; font-size: 11px; text-align: center; }
.player { position: relative; }
.touch { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #fff; background: rgba(30, 91, 255, 0.45); box-shadow: 0 0 0 3px rgba(30, 91, 255, 0.5); pointer-events: none; animation: touch 0.45s ease-out both; }
@keyframes touch { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.3); opacity: 0; } }
.timeline { position: relative; height: 16px; margin: 10px 4px 0; border-radius: 8px; background: #eceef1; }
.timeline button { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; padding: 0; border: 2px solid #fff; border-radius: 50%; background: #1e5bff; cursor: pointer; }
.timeline button.diamond { width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 2px; background: #22c55e; transform: rotate(45deg); }
.legend { display: flex; gap: 14px; margin-top: 6px; color: #626a76; font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend .dot { width: 9px; height: 9px; border-radius: 50%; background: #1e5bff; }
.legend .diamond { width: 9px; height: 9px; border-radius: 2px; background: #22c55e; transform: rotate(45deg); }
@media (max-width: 680px) { .cols { grid-template-columns: 1fr; } }
/* Phones: the manager opens this from a chat link, so it reads in one comfortable column. */
@media (max-width: 600px) {
  body { font-size: 15px; -webkit-text-size-adjust: 100%; }
  main { padding: 12px 12px 32px; }
  .card { padding: 16px; border-radius: 12px; margin-bottom: 12px; }
  h1 { font-size: 20px; }
  .verdict { font-size: 18px; align-items: flex-start; }
  .verdict .mark { width: 32px; height: 32px; font-size: 17px; }
  video, .shot { max-height: 70vh; }
  dl { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
  dd { font-size: 15px; }
  .rows li { padding: 10px 0; }
  .legend { flex-wrap: wrap; gap: 6px 14px; }
  .timeline { height: 20px; }
  .timeline button::before { content: ""; position: absolute; inset: -12px; }
}
@media (max-width: 340px) { dl { grid-template-columns: minmax(0, 1fr); } }
@media print { body { background: #fff; } .card { break-inside: avoid; } }
`;

/**
 * Where the player touched, and when the store opened, in seconds of the
 * screen's video. The video starts as the page starts loading, so times
 * measured from load are moved by the load time.
 */
const touchMarks = async (
  report: RunReport,
  run: RunReport["runs"][number],
  tracesDir: string
): Promise<{ touches: Array<{ t: number; x: number; y: number }>; store: number | null }> => {
  const offset = (run.evidence.loadMs || 0) / 1000;
  const touches: Array<{ t: number; x: number; y: number }> = [];
  if (report.trace) {
    try {
      const trace = JSON.parse(await readFile(path.join(tracesDir, `${path.basename(report.trace.sessionId)}.json`), "utf8")) as {
        events: Array<{ type?: string; phase: string; rt?: number; nx: number; ny: number }>;
      };
      for (const event of trace.events) {
        if ((event.type || "pointer") === "pointer" && event.phase === "down" && typeof event.rt === "number") {
          touches.push({ t: offset + event.rt / 1000, x: event.nx, y: event.ny });
        }
      }
    } catch {
      // The recording is gone; the store mark still says a lot.
    }
  } else if (run.ai) {
    for (const turn of run.ai.turns) {
      for (const action of turn.actions) {
        const tap = /^tap\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/.exec(action);
        if (tap) {
          touches.push({ t: offset + turn.at / 1000, x: Number(tap[1]) / 100, y: Number(tap[2]) / 100 });
        }
      }
    }
  }
  const cta = run.evidence.adEvents.find((event) => event.kind === "cta");
  return { touches: touches.slice(0, 200), store: cta ? offset + cta.rt / 1000 : null };
};

/** Draws the marks under the video, jumps to them, and flashes each touch where it landed. */
const PLAYER_SCRIPT = `
(function () {
  var line = document.querySelector(".timeline");
  var video = document.querySelector(".player video");
  var touch = document.querySelector(".player .touch");
  if (!line || !video) return;
  var marks = JSON.parse(line.getAttribute("data-marks"));
  function place() {
    var d = video.duration;
    if (!d || !isFinite(d)) return;
    line.innerHTML = "";
    marks.touches.forEach(function (m) { add("dot", m.t); });
    if (marks.store !== null) add("diamond", marks.store);
    function add(kind, t) {
      var b = document.createElement("button");
      b.className = kind;
      b.style.left = Math.min(100, (t / d) * 100) + "%";
      b.title = t.toFixed(1) + " s";
      b.onclick = function () { video.currentTime = Math.max(0, t - 0.4); video.play(); };
      line.appendChild(b);
    }
  }
  video.addEventListener("loadedmetadata", place);
  if (video.readyState > 0) place();
  video.addEventListener("timeupdate", function () {
    var now = video.currentTime;
    var hit = null;
    for (var i = 0; i < marks.touches.length; i++) {
      if (now >= marks.touches[i].t && now - marks.touches[i].t < 0.45) hit = marks.touches[i];
    }
    if (!hit) { touch.hidden = true; return; }
    // The picture is fitted inside the element: find where it is drawn.
    var box = video.getBoundingClientRect();
    var scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    var w = video.videoWidth * scale, h = video.videoHeight * scale;
    touch.style.left = ((box.width - w) / 2 + hit.x * w) + "px";
    touch.style.top = ((box.height - h) / 2 + hit.y * h) + "px";
    if (touch.hidden) { touch.hidden = false; touch.style.animation = "none"; void touch.offsetWidth; touch.style.animation = ""; }
  });
})();
`;

const dataUri = async (file: string, mime: string): Promise<string> =>
  `data:${mime};base64,${(await readFile(file)).toString("base64")}`;

/**
 * One self-contained page for someone who will not open the full report: the
 * verdict, the video of the playthrough, the numbers, and the answers in plain
 * words. Everything is inside the file, so it can be sent as it is.
 */
export const renderBrief = async (reportsDir: string, dir: string, lang: Lang): Promise<string> => {
  const folder = path.join(reportsDir, path.basename(dir));
  const report = JSON.parse(await readFile(path.join(folder, "report.json"), "utf8")) as RunReport;
  const texts = TEXTS[lang];
  const summary = summarize(report, lang);
  const answer = VERDICT_ANSWER[report.status];

  // The screen to show: a phone with a video, else the first screen.
  const shown =
    report.runs.find((run) => run.video && run.device.group !== "tablet") ||
    report.runs.find((run) => run.video) ||
    report.runs[0];
  let media = "";
  if (shown) {
    const screen = `${shown.device.name} (${shown.cssWidth}×${shown.cssHeight})`;
    let video = "";
    if (shown.video) {
      try {
        const file = path.join(folder, shown.video);
        if ((await stat(file)).size <= MAX_VIDEO_BYTES) {
          video = await dataUri(file, "video/webm");
        }
      } catch {
        video = "";
      }
    }
    const last = shown.shots[shown.shots.length - 1];
    let poster = "";
    if (last) {
      try {
        poster = await dataUri(path.join(folder, last.file), "image/png");
      } catch {
        poster = "";
      }
    }
    const marks = video ? await touchMarks(report, shown, path.join(reportsDir, "..", "traces")) : null;
    media = video
      ? `<figure><div class="player"><video controls playsinline preload="metadata" src="${video}"${poster ? ` poster="${poster}"` : ""}></video><span class="touch" hidden></span></div>${
          marks && (marks.touches.length > 0 || marks.store !== null)
            ? `<div class="timeline" data-marks='${escapeHtml(JSON.stringify(marks))}'></div><div class="legend"><span><i class="dot"></i>${escapeHtml(texts.touch)}</span>${marks.store !== null ? `<span><i class="diamond"></i>${escapeHtml(texts.store)}</span>` : ""}</div>`
            : ""
        }<figcaption>${escapeHtml(texts.video(screen))}</figcaption></figure>`
      : poster
        ? `<figure><img class="shot" src="${poster}" alt="" /><figcaption>${escapeHtml(texts.noVideo(screen))}</figcaption></figure>`
        : "";
  }

  const stats: Array<[string, string]> = [];
  const seconds = (ms: number): string => (ms / 1000).toFixed(1);
  const clean = report.runs.filter((run) => run.status === "pass").length;
  stats.push([texts.stat.screens, texts.stat.screensValue(clean, report.runs.length)]);
  stats.push([
    texts.stat.played,
    report.trace
      ? texts.stat.playedTrace(report.trace.inputs, seconds(report.trace.durationMs))
      : report.ai
        ? texts.stat.playedAi(report.ai.provider)
        : texts.stat.playedNone,
  ]);
  const played = report.runs.filter((run) => run.evidence.inputs > 0);
  const firstTouch = played.map((run) => run.evidence.firstInputAt).find((value) => typeof value === "number");
  if (typeof firstTouch === "number") {
    stats.push([texts.stat.firstTouch, texts.stat.seconds(seconds(firstTouch))]);
  }
  const storeAt = report.runs
    .flatMap((run) => run.evidence.adEvents.filter((event) => event.kind === "cta").map((event) => event.rt))
    .sort((a, b) => a - b)[0];
  stats.push([
    texts.stat.store,
    storeAt !== undefined
      ? texts.stat.seconds(seconds(storeAt))
      : played.length > 0
        ? texts.stat.storeNever
        : texts.stat.storeNotTried,
  ]);
  const fps = summarizeFps(report.perf || []);
  if (fps) {
    stats.push([texts.stat.phoneFps, texts.stat.fpsValue(fps.average.toFixed(0))]);
  }
  if (report.playable.bytes > 0) {
    const time = (bitsPerSecond: number): string => {
      const value = (report.playable.bytes * 8) / bitsPerSecond;
      return value < 1 ? "<1 s" : `${Math.round(value)} s`;
    };
    stats.push([texts.stat.size, formatBytes(report.playable.bytes)]);
    stats.push([texts.stat.download, texts.stat.downloadValue(time(1_600_000), time(12_000_000))]);
  }
  if (report.weight && report.weight.parts.length > 0) {
    stats.push([
      texts.stat.weight,
      report.weight.parts
        .slice(0, 3)
        .map((part) => `${texts.stat.kinds[part.kind]} ${Math.round((part.bytes / (report.weight!.total || 1)) * 100)}%`)
        .join(" · "),
    ]);
  }
  const stress = report.stress || [];
  const idle = stress.find((run) => run.scenario === "idle")?.stressResult;
  if (idle?.heapStart !== undefined && idle.heapEnd !== undefined) {
    const mb = 1024 * 1024;
    const growth = Math.round((idle.heapEnd - idle.heapStart) / mb);
    stats.push([
      texts.stat.memory,
      texts.stat.memoryValue((idle.heapEnd / mb).toFixed(0), `${growth >= 0 ? "+" : ""}${growth}`),
    ]);
  }
  const errors = [...report.runs, ...stress].reduce(
    (total, run) => total + run.evidence.pageErrors.length + run.evidence.consoleErrors.length,
    0
  );
  stats.push([texts.stat.errors, errors === 0 ? texts.stat.errorsNone : texts.stat.errorsValue(errors)]);
  stats.push([texts.stat.network, report.network ? report.network.name : texts.stat.networkNone]);
  stats.push([texts.stat.date, report.generatedAt]);

  const open = summary.rows.filter((row) => row.answer !== "yes");
  const fine = summary.rows.filter((row) => row.answer === "yes");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.playable.name)} · ${escapeHtml(texts.verdicts[report.status])}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="card">
    <p class="eyebrow">${brandMark()} · ${escapeHtml(texts.title)}</p>
    <h1>${escapeHtml(report.playable.name)}</h1>
    <div class="verdict ${answer}"><span class="mark ${answer}">${GLYPH[answer]}</span>${escapeHtml(texts.verdicts[report.status])}</div>
    <p class="headline">${escapeHtml(summary.headline)}</p>
  </div>
  <div class="cols${media ? "" : " wide"}">
    ${media ? `<div class="card">${media}</div>` : ""}
    <div>
      <div class="card">
        <h2>${escapeHtml(texts.numbers)}</h2>
        <dl>${stats.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>
      <div class="card">
        <h2>${escapeHtml(texts.answers)}</h2>
        <ul class="rows">${open
          .map(
            (row) => `<li><span class="mark ${row.answer}" title="${escapeHtml(texts.legend[row.answer])}">${GLYPH[row.answer]}</span>
            <div><span class="q">${escapeHtml(row.question)}</span> ${escapeHtml(row.text)}${row.where ? `<div class="where">${escapeHtml(row.where)}</div>` : ""}</div></li>`
          )
          .join("")}</ul>
        ${
          fine.length > 0
            ? `<div class="fine">${fine.map((row) => `<span><span class="mark yes">✓</span>${escapeHtml(row.question)}</span>`).join("")}</div>`
            : ""
        }
      </div>
    </div>
  </div>
  <footer>${escapeHtml(texts.made)}</footer>
<script>${PLAYER_SCRIPT}</script>
</main>
</body>
</html>
`;
};
