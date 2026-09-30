import { readFile } from "node:fs/promises";
import path from "node:path";
// The plain-language answers are the runner's; the sheet only lays them out.
import { summarize } from "../../playwright-runner/src/summary.ts";
import type { Answer, PlainSummary } from "../../playwright-runner/src/summary.ts";
import type { RunReport } from "../../playwright-runner/src/report.ts";
import type { Batch, BatchBuild, Verdict } from "./batches.ts";
import { LOGO_URI, brandMark } from "./brand.ts";
import type { Lang } from "./runner.ts";

/** One column per question a client asks about a build; ids are the summary's topics. */
const COLUMNS = [
  "size",
  "rules",
  "load",
  "crash",
  "render",
  "responds",
  "cta",
  "link",
  "apis",
  "sound",
  "rotate",
  "stability",
  "offline",
  "sdk",
] as const;

type Column = (typeof COLUMNS)[number];

interface Texts {
  title: string;
  creative: string;
  date: string;
  playthrough: string;
  played: string;
  notPlayed: string;
  network: string;
  build: string;
  verdict: string;
  unknownNetwork: string;
  verdicts: Record<Verdict, string>;
  didNotRun: string;
  skipped: string;
  running: string;
  total: (counts: Record<Verdict, number>, broken: number) => string;
  columns: Record<Column, string>;
  legend: Record<Answer, string>;
  table: string;
  remarks: string;
  noRemarks: string;
  screens: string;
  checkedBy: string;
  acceptedBy: string;
  signature: string;
  print: string;
  made: string;
}

const TEXTS: Record<Lang, Texts> = {
  en: {
    title: "Release summary",
    creative: "Creative",
    date: "Date",
    playthrough: "Playthrough",
    played: "one recorded playthrough, repeated on every build and every screen",
    notPlayed: "none: the builds were only opened, the install button was not pressed",
    network: "Ad network",
    build: "Build",
    verdict: "Verdict",
    unknownNetwork: "Unknown network",
    verdicts: { pass: "Ready", warn: "Needs a look", fail: "Not ready" },
    didNotRun: "Did not run",
    skipped: "Not checked: network turned off",
    running: "Still being checked",
    total: (counts, broken) =>
      `Ready: ${counts.pass} · needs a look: ${counts.warn} · not ready: ${counts.fail + broken}`,
    columns: {
      size: "Size",
      rules: "Network rules",
      load: "Opens",
      crash: "No errors",
      render: "Picture",
      responds: "Reacts to taps",
      cta: "Install button",
      link: "Install link",
      apis: "Browser permissions",
      sound: "Sound",
      rotate: "Rotation",
      stability: "Stability",
      offline: "Works offline",
      sdk: "Network calls",
    },
    legend: { yes: "fine", partly: "needs a look", no: "has to be fixed", unknown: "not tested" },
    table: "All networks, all checks",
    remarks: "Remarks",
    noRemarks: "No remarks: every build passed every check that was run.",
    screens: "Screens",
    checkedBy: "Checked by",
    acceptedBy: "Accepted by",
    signature: "name, signature, date",
    print: "Print or save as PDF",
    made: "Made with PlayGuard",
  },
  ru: {
    title: "Сводка по релизу",
    creative: "Креатив",
    date: "Дата",
    playthrough: "Прохождение",
    played: "одно записанное прохождение, повторённое на каждой сборке и каждом экране",
    notPlayed: "нет: сборки только открывались, кнопку установки не нажимали",
    network: "Рекламная сеть",
    build: "Сборка",
    verdict: "Итог",
    unknownNetwork: "Сеть не определена",
    verdicts: { pass: "Готов", warn: "Нужно посмотреть", fail: "Не готов" },
    didNotRun: "Не запустилась",
    skipped: "Не проверялась: сеть выключена",
    running: "Ещё проверяется",
    total: (counts, broken) =>
      `Готовы: ${counts.pass} · нужно посмотреть: ${counts.warn} · не готовы: ${counts.fail + broken}`,
    columns: {
      size: "Размер",
      rules: "Правила сети",
      load: "Запуск",
      crash: "Без ошибок",
      render: "Картинка",
      responds: "Реакция на касания",
      cta: "Кнопка установки",
      link: "Ссылка в магазин",
      apis: "Разрешения браузера",
      sound: "Звук",
      rotate: "Поворот",
      stability: "Устойчивость",
      offline: "Без интернета",
      sdk: "Вызовы сети",
    },
    legend: { yes: "в порядке", partly: "стоит посмотреть", no: "нужно исправить", unknown: "не проверялось" },
    table: "Все сети, все проверки",
    remarks: "Замечания",
    noRemarks: "Замечаний нет: все сборки прошли все проведённые проверки.",
    screens: "Экраны",
    checkedBy: "Проверил",
    acceptedBy: "Принял",
    signature: "ФИО, подпись, дата",
    print: "Печать или сохранить как PDF",
    made: "Сделано в PlayGuard",
  },
  fr: {
    title: "Synthèse de la version",
    creative: "Création",
    date: "Date",
    playthrough: "Partie jouée",
    played: "une partie enregistrée, rejouée sur chaque build et chaque écran",
    notPlayed: "aucune : les builds ont seulement été ouverts, le bouton d'installation n'a pas été pressé",
    network: "Réseau publicitaire",
    build: "Build",
    verdict: "Verdict",
    unknownNetwork: "Réseau inconnu",
    verdicts: { pass: "Prêt", warn: "À vérifier", fail: "Pas prêt" },
    didNotRun: "Non exécuté",
    skipped: "Non vérifié : réseau désactivé",
    running: "Vérification en cours",
    total: (counts, broken) =>
      `Prêts : ${counts.pass} · à vérifier : ${counts.warn} · pas prêts : ${counts.fail + broken}`,
    columns: {
      size: "Taille",
      rules: "Règles du réseau",
      load: "Ouverture",
      crash: "Sans erreur",
      render: "Image",
      responds: "Réaction au toucher",
      cta: "Bouton d'installation",
      link: "Lien du store",
      apis: "Autorisations du navigateur",
      sound: "Son",
      rotate: "Rotation",
      stability: "Stabilité",
      offline: "Hors ligne",
      sdk: "Appels du réseau",
    },
    legend: { yes: "correct", partly: "à vérifier", no: "à corriger", unknown: "non testé" },
    table: "Tous les réseaux, tous les contrôles",
    remarks: "Remarques",
    noRemarks: "Aucune remarque : tous les builds ont passé tous les contrôles effectués.",
    screens: "Écrans",
    checkedBy: "Vérifié par",
    acceptedBy: "Accepté par",
    signature: "nom, signature, date",
    print: "Imprimer ou enregistrer en PDF",
    made: "Réalisé avec PlayGuard",
  },
};

const GLYPH: Record<Answer, string> = { yes: "✓", partly: "!", no: "✕", unknown: "–" };
const VERDICT_ANSWER: Record<Verdict, Answer> = { pass: "yes", warn: "partly", fail: "no" };

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const mark = (answer: Answer, label: string): string =>
  `<span class="mark ${answer}" title="${escapeHtml(label)}">${GLYPH[answer]}<span class="sr">${escapeHtml(label)}</span></span>`;

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #f3f4f6; color: #16181d; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1280px; margin: 24px auto; padding: 28px 32px 36px; background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; }
h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
h2 { margin: 28px 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #626a76; }
h3 { margin: 16px 0 4px; font-size: 14px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.top button { margin-left: auto; font: inherit; padding: 6px 12px; border: 1px solid #c9ced6; border-radius: 8px; background: #fff; cursor: pointer; }
.verdict { display: inline-flex; align-items: center; gap: 8px; padding: 3px 12px 3px 8px; border-radius: 999px; font-weight: 600; font-size: 12px; white-space: nowrap; }
.verdict.yes { color: #17794a; background: #e3f4ea; }
.verdict.partly { color: #8a5a00; background: #fdf0d2; }
.verdict.no { color: #b3261e; background: #fbe4e2; }
.verdict.unknown { color: #626a76; background: #eceef1; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; margin: 14px 0 0; }
.meta dt { color: #626a76; }
.meta dd { margin: 0; }
.mark { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; font-size: 12px; font-weight: 700; }
.mark.yes { color: #17794a; background: #e3f4ea; }
.mark.partly { color: #8a5a00; background: #fdf0d2; }
.mark.no { color: #b3261e; background: #fbe4e2; }
.mark.unknown { color: #626a76; background: #eceef1; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 7px 4px; border-bottom: 1px solid #dfe3e8; text-align: center; vertical-align: middle; }
thead th { font-size: 11px; font-weight: 600; color: #626a76; vertical-align: bottom; line-height: 1.25; }
th.left, td.left { text-align: left; }
td.left b { display: block; }
.dim { color: #626a76; }
.file { display: block; font-size: 11px; color: #626a76; overflow-wrap: anywhere; }
td.left:first-child { min-width: 170px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 10px; color: #626a76; font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.remarks ul { margin: 0; padding: 0; list-style: none; }
.remarks li { display: flex; gap: 8px; padding: 5px 0; border-top: 1px solid #eceef1; }
.remarks li:first-child { border-top: 0; }
.remarks .mark { flex: none; margin-top: 1px; }
.remarks .q { font-weight: 600; }
.remarks .items { margin: 2px 0 0; padding-left: 16px; list-style: disc; color: #626a76; font-size: 12px; }
.remarks .items li { display: list-item; border: 0; padding: 0; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 44px; }
.sign div { border-top: 1px solid #16181d; padding-top: 6px; }
.sign span { display: block; color: #626a76; font-size: 11px; }
footer { margin-top: 24px; color: #9aa2ae; font-size: 11px; }
/* Phones: full-width sheet; the big table scrolls sideways with the build's name pinned. */
@media (max-width: 600px) {
  body { background: #fff; font-size: 14px; -webkit-text-size-adjust: 100%; }
  main { margin: 0; padding: 16px 16px 28px; border: 0; border-radius: 0; }
  h1 { font-size: 20px; overflow-wrap: anywhere; }
  .top button { flex: 1 1 100%; margin-left: 0; min-height: 44px; }
  .meta { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .meta dt { margin-top: 6px; font-size: 12px; }
  .scroll { margin: 0 -16px; padding: 0 16px; -webkit-overflow-scrolling: touch; }
  td.left:first-child { min-width: 140px; max-width: 180px; }
  thead th.left:first-child, td.left:first-child { position: sticky; left: 0; z-index: 1; background: #fff; box-shadow: 1px 0 0 #dfe3e8; }
  .remarks li { padding: 8px 0; }
  .sign { grid-template-columns: minmax(0, 1fr); gap: 28px; margin-top: 32px; }
}
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body { background: #fff; }
  main { margin: 0; padding: 0; border: 0; max-width: none; }
  .top button { display: none; }
  .mark, .verdict { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .remarks section { break-inside: avoid; }
  .sign { break-inside: avoid; }
}
`;

interface Row {
  build: BatchBuild;
  summary: PlainSummary | null;
}

/** One printable page: every network's build of a creative against every question. */
export const renderSheet = async (batch: Batch, reportsDir: string, lang: Lang): Promise<string> => {
  const texts = TEXTS[lang];
  const rows: Row[] = [];
  for (let i = 0; i < batch.builds.length; i += 1) {
    const build = batch.builds[i];
    let summary: PlainSummary | null = null;
    if (build.state === "done" && build.reportDir) {
      try {
        const report = JSON.parse(
          await readFile(path.join(reportsDir, path.basename(build.reportDir), "report.json"), "utf8")
        ) as RunReport;
        summary = summarize(report, lang);
      } catch {
        summary = null;
      }
    }
    rows.push({ build, summary });
  }

  const counts: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0 };
  let broken = 0;
  let pending = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const build = rows[i].build;
    if (build.state === "done" && build.verdict) {
      counts[build.verdict] += 1;
    } else if (build.state === "queued" || build.state === "running") {
      pending += 1;
    } else if (build.state !== "skipped") {
      broken += 1;
    }
  }
  const overall: Answer =
    pending > 0 ? "unknown" : counts.fail + broken > 0 ? "no" : counts.warn > 0 ? "partly" : "yes";
  const overallText =
    pending > 0
      ? texts.running
      : texts.verdicts[overall === "no" ? "fail" : overall === "partly" ? "warn" : "pass"];

  const head = COLUMNS.map((column) => `<th>${escapeHtml(texts.columns[column])}</th>`).join("");
  const body = rows
    .map(({ build, summary }) => {
      const cells = COLUMNS.map((column) => {
        // The link is judged twice, on the screens and in the file: the worse answer is the one to show.
        const candidates = (summary?.rows || []).filter(
          (item) => item.id === column || (column === "link" && item.id === "linksource")
        );
        const row = candidates.find((item) => item.answer === "no") || candidates.find((item) => item.answer === "partly") || candidates[0];
        const answer: Answer = row ? row.answer : "unknown";
        return `<td>${mark(answer, row ? row.text : texts.legend.unknown)}</td>`;
      }).join("");
      const verdict =
        build.state === "done" && build.verdict
          ? `<span class="verdict ${VERDICT_ANSWER[build.verdict]}">${GLYPH[VERDICT_ANSWER[build.verdict]]} ${escapeHtml(texts.verdicts[build.verdict])}</span>`
          : `<span class="verdict ${build.state === "queued" || build.state === "running" || build.state === "skipped" ? "unknown" : "no"}">${escapeHtml(
              build.state === "queued" || build.state === "running"
                ? texts.running
                : build.state === "skipped"
                  ? texts.skipped
                  : texts.didNotRun
            )}</span>`;
      return `<tr>
        <td class="left"><b>${escapeHtml(build.network ? build.network.name : texts.unknownNetwork)}</b><span class="file">${escapeHtml(build.name)}</span></td>
        ${cells}
        <td class="left">${verdict}</td>
      </tr>`;
    })
    .join("");

  const remarks = rows
    .map(({ build, summary }) => {
      const items = (summary?.rows || []).filter((row) => row.answer === "no" || row.answer === "partly");
      if (!summary && build.state !== "queued" && build.state !== "running" && build.state !== "skipped") {
        return `<section>
        <h3>${escapeHtml(build.network ? build.network.name : texts.unknownNetwork)} <span class="dim">· ${escapeHtml(build.name)}</span></h3>
        <ul><li>${mark("no", texts.legend.no)}<div><span class="q">${escapeHtml(texts.didNotRun)}</span>${build.error ? ` <span class="dim">${escapeHtml(build.error)}</span>` : ""}</div></li></ul>
      </section>`;
      }
      if (items.length === 0) {
        return "";
      }
      return `<section>
        <h3>${escapeHtml(build.network ? build.network.name : texts.unknownNetwork)} <span class="dim">· ${escapeHtml(build.name)}</span></h3>
        <ul>${items
          .map(
            (row) => `<li>
            ${mark(row.answer, texts.legend[row.answer])}
            <div>
              <span class="q">${escapeHtml(row.question)}</span> ${escapeHtml(row.text)}
              ${row.where ? `<div class="dim">${escapeHtml(texts.screens)}: ${escapeHtml(row.where)}</div>` : ""}
              ${row.items ? `<ul class="items">${row.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
            </div>
          </li>`
          )
          .join("")}</ul>
      </section>`;
    })
    .join("");

  const legend = (["yes", "partly", "no", "unknown"] as Answer[])
    .map((answer) => `<span>${mark(answer, texts.legend[answer])} ${escapeHtml(texts.legend[answer])}</span>`)
    .join("");
  const date = new Date(batch.runStartedAt || batch.createdAt).toLocaleDateString(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(texts.title)} · ${escapeHtml(batch.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="top">
    <h1>${LOGO_URI ? `<img src="${LOGO_URI}" alt="PlayGuard" width="30" height="30" style="vertical-align:-6px;margin-right:8px" />` : ""}${escapeHtml(texts.title)}</h1>
    <span class="verdict ${overall}">${GLYPH[overall]} ${escapeHtml(overallText)}</span>
    <button type="button" onclick="window.print()">${escapeHtml(texts.print)}</button>
  </div>
  <dl class="meta">
    <dt>${escapeHtml(texts.creative)}</dt><dd><b>${escapeHtml(batch.name)}</b></dd>
    <dt>${escapeHtml(texts.date)}</dt><dd>${escapeHtml(date)}</dd>
    <dt>${escapeHtml(texts.playthrough)}</dt><dd>${escapeHtml(batch.traceId ? texts.played : texts.notPlayed)}</dd>
    <dt>${escapeHtml(texts.verdict)}</dt><dd>${escapeHtml(texts.total(counts, broken))}</dd>
  </dl>

  <h2>${escapeHtml(texts.table)}</h2>
  <div class="scroll"><table>
    <thead><tr><th class="left">${escapeHtml(texts.network)}</th>${head}<th class="left">${escapeHtml(texts.verdict)}</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <div class="legend">${legend}</div>

  <h2>${escapeHtml(texts.remarks)}</h2>
  <div class="remarks">${remarks || `<p>${escapeHtml(texts.noRemarks)}</p>`}</div>

  <div class="sign">
    <div>${escapeHtml(texts.checkedBy)}<span>${escapeHtml(texts.signature)}</span></div>
    <div>${escapeHtml(texts.acceptedBy)}<span>${escapeHtml(texts.signature)}</span></div>
  </div>
  <footer>${brandMark(16)}</footer>
</main>
</body>
</html>
`;
};
