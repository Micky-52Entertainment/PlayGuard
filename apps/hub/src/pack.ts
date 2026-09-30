import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ZipEntry } from "@playable-lab/zip";
import type { DeviceRun, RunReport } from "../../playwright-runner/src/report.ts";
import { summarize } from "../../playwright-runner/src/summary.ts";
import type { Answer } from "../../playwright-runner/src/summary.ts";
import type { Batch } from "./batches.ts";
import { brandMark } from "./brand.ts";
import type { Lang } from "./runner.ts";

/**
 * Everything a client asks for about a creative, in one archive: how it plays
 * (video), how it looks on every screen (pictures), and where it works
 * (networks). The page inside opens from the unpacked folder, offline.
 */

interface Texts {
  title: string;
  checked: (screens: number) => string;
  verdicts: Record<"pass" | "warn" | "fail", string>;
  videos: string;
  videoCaption: (screen: string, orientation: string) => string;
  screens: string;
  portrait: string;
  landscape: string;
  networks: string;
  network: string;
  build: string;
  status: string;
  noNetwork: string;
  didNotRun: string;
  checks: string;
  legend: Record<Answer, string>;
  files: string;
  made: string;
}

const TEXTS: Record<Lang, Texts> = {
  en: {
    title: "Playable",
    checked: (screens) => `Checked on ${screens} screens of phones, tablets and foldables`,
    verdicts: { pass: "Works everywhere it was checked", warn: "Works, with remarks", fail: "Has problems to fix" },
    videos: "How it plays",
    videoCaption: (screen, orientation) => `${screen}, ${orientation}`,
    screens: "How it looks on every screen",
    portrait: "portrait",
    landscape: "landscape",
    networks: "Ad networks",
    network: "Network",
    build: "Build",
    status: "Status",
    noNetwork: "No ad network was set for this check.",
    didNotRun: "Did not run",
    checks: "What was checked",
    legend: { yes: "fine", partly: "has remarks", no: "has to be fixed", unknown: "not tested" },
    files: "The videos and pictures are also in the folders next to this page.",
    made: "Made with PlayGuard",
  },
  ru: {
    title: "Плеебл",
    checked: (screens) => `Проверен на ${screens} экранах телефонов, планшетов и складных устройств`,
    verdicts: { pass: "Работает везде, где проверялся", warn: "Работает, есть замечания", fail: "Есть проблемы, которые нужно исправить" },
    videos: "Как играется",
    videoCaption: (screen, orientation) => `${screen}, ${orientation}`,
    screens: "Как выглядит на каждом экране",
    portrait: "вертикально",
    landscape: "горизонтально",
    networks: "Рекламные сети",
    network: "Сеть",
    build: "Сборка",
    status: "Состояние",
    noNetwork: "Рекламная сеть в этой проверке не выбиралась.",
    didNotRun: "Не запустилась",
    checks: "Что проверено",
    legend: { yes: "в порядке", partly: "есть замечания", no: "нужно исправить", unknown: "не проверялось" },
    files: "Видео и картинки также лежат в папках рядом с этой страницей.",
    made: "Сделано в PlayGuard",
  },
  fr: {
    title: "Playable",
    checked: (screens) => `Vérifié sur ${screens} écrans de téléphones, tablettes et appareils pliables`,
    verdicts: { pass: "Fonctionne partout où il a été vérifié", warn: "Fonctionne, avec des remarques", fail: "A des problèmes à corriger" },
    videos: "Comment il se joue",
    videoCaption: (screen, orientation) => `${screen}, ${orientation}`,
    screens: "Son apparence sur chaque écran",
    portrait: "portrait",
    landscape: "paysage",
    networks: "Réseaux publicitaires",
    network: "Réseau",
    build: "Build",
    status: "État",
    noNetwork: "Aucun réseau publicitaire n'a été choisi pour cette vérification.",
    didNotRun: "Non exécuté",
    checks: "Ce qui a été vérifié",
    legend: { yes: "correct", partly: "avec remarques", no: "à corriger", unknown: "non testé" },
    files: "Les vidéos et les images se trouvent aussi dans les dossiers à côté de cette page.",
    made: "Réalisé avec PlayGuard",
  },
};

const GLYPH: Record<Answer, string> = { yes: "✓", partly: "!", no: "✕", unknown: "–" };
const ANSWER = { pass: "yes", warn: "partly", fail: "no" } as const;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeName = (value: string): string => value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "file";

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #f5f6f8; color: #16181d; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
header { margin-bottom: 28px; }
.eyebrow { margin: 0; color: #626a76; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
h1 { margin: 4px 0 6px; font-size: 28px; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
h2 { margin: 36px 0 14px; font-size: 18px; }
.lead { margin: 0; color: #626a76; }
.status { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; padding: 4px 14px 4px 6px; border-radius: 999px; font-weight: 600; }
.status.yes { color: #17794a; background: #e3f4ea; } .status.partly { color: #8a5a00; background: #fdf0d2; } .status.no { color: #b3261e; background: #fbe4e2; }
.mark { display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700; }
.mark.yes { color: #17794a; background: #e3f4ea; } .mark.partly { color: #8a5a00; background: #fdf0d2; }
.mark.no { color: #b3261e; background: #fbe4e2; } .mark.unknown { color: #626a76; background: #eceef1; }
.videos { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.videos figure { margin: 0; }
.videos video { display: block; max-height: 560px; max-width: 100%; border-radius: 14px; background: #000; box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
figcaption { margin-top: 8px; color: #626a76; font-size: 13px; }
.gallery { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; }
.gallery figure { margin: 0; }
.gallery img { display: block; height: 260px; width: auto; border-radius: 10px; border: 1px solid #dfe3e8; background: #000; }
.gallery.landscape img { height: 170px; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dfe3e8; border-radius: 12px; overflow: hidden; }
th, td { padding: 10px 14px; border-bottom: 1px solid #eceef1; text-align: left; vertical-align: middle; }
th { color: #626a76; font-size: 12px; font-weight: 600; }
td .file { display: block; color: #626a76; font-size: 12px; overflow-wrap: anywhere; }
td img { display: block; height: 120px; width: auto; border-radius: 6px; border: 1px solid #dfe3e8; }
.cell { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.checks { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.checks li { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 6px; border-radius: 999px; background: #fff; border: 1px solid #dfe3e8; font-size: 13px; }
footer { margin-top: 40px; color: #9aa2ae; font-size: 12px; }
`;

const page = (lang: Lang, title: string, body: string): string => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<footer>${escapeHtml(TEXTS[lang].files)} ${escapeHtml(TEXTS[lang].made)}</footer>
</main>
</body>
</html>
`;

/** The picture a screen ended on. */
const finalShot = (run: DeviceRun): string | null => {
  const shot = run.shots.find((item) => item.label === "final") || run.shots[run.shots.length - 1];
  return shot ? shot.file : null;
};

/**
 * MP4 plays everywhere a client may open it (QuickTime, PowerPoint, an
 * iPhone); the recorder writes WebM. Converted once and kept beside it, when
 * ffmpeg is on this computer; otherwise the WebM goes as it is.
 */
const playable = async (webm: string): Promise<{ file: string; ext: string }> => {
  const mp4 = webm.replace(/\.webm$/i, ".mp4");
  if (existsSync(mp4)) {
    return { file: mp4, ext: "mp4" };
  }
  const converted = await ffmpeg([
    "-i",
    webm,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);
  return converted && existsSync(mp4) ? { file: mp4, ext: "mp4" } : { file: webm, ext: "webm" };
};

const FFMPEG_ENV = { ...process.env, PATH: `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin` };

const ffmpeg = (args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("ffmpeg", ["-y", "-loglevel", "error", ...args], { timeout: 120000, env: FFMPEG_ENV }, (error) => resolve(!error));
  });

/** At most this many pixels on the long side: a picture for a client, not the phone's full resolution. */
const PICTURE_SIDE = 1200;

/**
 * Screenshots are taken at the phone's full resolution, several megabytes
 * each. A JPEG of the size a client looks at is made once and kept beside the
 * original; without ffmpeg the PNG goes as it is.
 */
const picture = async (png: string): Promise<{ data: Buffer; ext: string }> => {
  const jpg = png.replace(/\.png$/i, ".client.jpg");
  if (!existsSync(jpg)) {
    const fit = `scale=w=${PICTURE_SIDE}:h=${PICTURE_SIDE}:force_original_aspect_ratio=decrease`;
    await ffmpeg(["-i", png, "-vf", fit, "-q:v", "4", jpg]);
  }
  return existsSync(jpg) ? { data: await readFile(jpg), ext: "jpg" } : { data: await readFile(png), ext: "png" };
};

interface Collected {
  entries: ZipEntry[];
  add: (name: string, data: Buffer) => string;
}

const collector = (root: string): Collected => {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  return {
    entries,
    add: (name, data) => {
      let target = name;
      for (let i = 2; used.has(target); i += 1) {
        target = name.replace(/(\.\w+)$/, `-${i}$1`);
      }
      used.add(target);
      entries.push({ name: `${root}/${target}`, data });
      return target;
    },
  };
};

const readReport = async (reportsDir: string, dir: string): Promise<{ report: RunReport; folder: string }> => {
  const folder = path.join(reportsDir, path.basename(dir));
  return { report: JSON.parse(await readFile(path.join(folder, "report.json"), "utf8")) as RunReport, folder };
};

/** Videos: one phone screen per orientation that has one. */
const videoSection = async (texts: Texts, report: RunReport, folder: string, files: Collected): Promise<string> => {
  const figures: string[] = [];
  for (const orientation of ["portrait", "landscape"] as const) {
    const runs = report.runs.filter((run) => run.orientation === orientation && run.video);
    const run = runs.find((item) => item.device.group !== "tablet") || runs[0];
    if (!run || !run.video) {
      continue;
    }
    try {
      const video = await playable(path.join(folder, run.video));
      const name = files.add(`videos/${safeName(`${run.device.name}-${orientation}`)}.${video.ext}`, await readFile(video.file));
      // The last frame as the cover: a video that starts on a black loading screen looks broken before it plays.
      const cover = finalShot(run);
      let poster = "";
      if (cover) {
        const image = await picture(path.join(folder, cover));
        poster = files.add(`videos/${safeName(`${run.device.name}-${orientation}`)}-cover.${image.ext}`, image.data);
      }
      figures.push(`<figure><video controls playsinline preload="metadata" src="${escapeHtml(name)}"${poster ? ` poster="${escapeHtml(poster)}"` : ""}></video>
        <figcaption>${escapeHtml(texts.videoCaption(run.device.name, orientation === "portrait" ? texts.portrait : texts.landscape))}</figcaption></figure>`);
    } catch {
      continue;
    }
  }
  return figures.length > 0 ? `<h2>${escapeHtml(texts.videos)}</h2><div class="videos">${figures.join("")}</div>` : "";
};

/** Every screen's last picture, portrait and landscape apart. */
const gallerySection = async (texts: Texts, report: RunReport, folder: string, files: Collected): Promise<string> => {
  const blocks: string[] = [];
  for (const orientation of ["portrait", "landscape"] as const) {
    const figures: string[] = [];
    const runs = report.runs.filter((run) => run.orientation === orientation);
    for (let i = 0; i < runs.length; i += 1) {
      const shot = finalShot(runs[i]);
      if (!shot) {
        continue;
      }
      try {
        const image = await picture(path.join(folder, shot));
        const name = files.add(`screens/${safeName(`${runs[i].device.name}-${orientation}`)}.${image.ext}`, image.data);
        figures.push(`<figure><img src="${escapeHtml(name)}" alt="${escapeHtml(runs[i].device.name)}" />
          <figcaption>${escapeHtml(runs[i].device.name)} · ${runs[i].cssWidth}×${runs[i].cssHeight}</figcaption></figure>`);
      } catch {
        continue;
      }
    }
    if (figures.length > 0) {
      blocks.push(`<div class="gallery ${orientation}">${figures.join("")}</div>`);
    }
  }
  return blocks.length > 0 ? `<h2>${escapeHtml(texts.screens)}</h2>${blocks.join('<div style="height:18px"></div>')}` : "";
};

const checksSection = (texts: Texts, report: RunReport, lang: Lang): string => {
  const rows = summarize(report, lang).rows.filter((row) => row.answer !== "unknown");
  if (rows.length === 0) {
    return "";
  }
  return `<h2>${escapeHtml(texts.checks)}</h2><ul class="checks">${rows
    .map((row) => `<li><span class="mark ${row.answer}" title="${escapeHtml(row.text)}">${GLYPH[row.answer]}</span>${escapeHtml(row.question)}</li>`)
    .join("")}</ul>`;
};

/** The pack for one check of one playable. */
export const reportPack = async (reportsDir: string, dir: string, lang: Lang): Promise<{ name: string; entries: ZipEntry[] }> => {
  const texts = TEXTS[lang];
  const { report, folder } = await readReport(reportsDir, dir);
  const root = safeName(`${report.playable.name.replace(/\.html?$/i, "")}-client`);
  const files = collector(root);
  const answer = ANSWER[report.status];
  const networks = report.network
    ? `<h2>${escapeHtml(texts.networks)}</h2><table><thead><tr><th>${escapeHtml(texts.network)}</th><th>${escapeHtml(texts.status)}</th></tr></thead>
       <tbody><tr><td>${escapeHtml(report.network.name)}</td><td><span class="cell"><span class="mark ${answer}">${GLYPH[answer]}</span>${escapeHtml(texts.legend[answer])}</span></td></tr></tbody></table>`
    : `<h2>${escapeHtml(texts.networks)}</h2><p class="lead">${escapeHtml(texts.noNetwork)}</p>`;
  const body = `<header>
    <p class="eyebrow">${brandMark()} · ${escapeHtml(texts.title)}</p>
    <h1>${escapeHtml(report.playable.name)}</h1>
    <p class="lead">${escapeHtml(texts.checked(report.runs.length))} · ${escapeHtml(report.generatedAt)}</p>
    <div class="status ${answer}"><span class="mark ${answer}">${GLYPH[answer]}</span>${escapeHtml(texts.verdicts[report.status])}</div>
  </header>
  ${await videoSection(texts, report, folder, files)}
  ${await gallerySection(texts, report, folder, files)}
  ${networks}
  ${checksSection(texts, report, lang)}`;
  files.entries.unshift({ name: `${root}/index.html`, data: Buffer.from(page(lang, report.playable.name, body), "utf8") });
  return { name: root, entries: files.entries };
};

/**
 * The pack for a creative with a build per network: the table of networks,
 * each build's last frame, and the video and screens of the playthrough the
 * builds were checked with.
 */
export const batchPack = async (
  batch: Batch,
  reportsDir: string,
  lang: Lang,
  /** The report of the recording the builds replayed, where the video is. */
  playedReport: string | null,
  sheet: string
): Promise<{ name: string; entries: ZipEntry[] }> => {
  const texts = TEXTS[lang];
  const root = safeName(`${batch.name.replace(/\.zip$/i, "")}-client`);
  const files = collector(root);
  files.add("summary.html", Buffer.from(sheet, "utf8"));

  const rows: string[] = [];
  let screens = 0;
  let worst: "pass" | "warn" | "fail" = "pass";
  for (let i = 0; i < batch.builds.length; i += 1) {
    const build = batch.builds[i];
    let thumb = "";
    if (build.reportDir) {
      try {
        const { report, folder } = await readReport(reportsDir, build.reportDir);
        screens = Math.max(screens, report.runs.length);
        const phone = report.runs.find((run) => run.device.group !== "tablet" && run.orientation === "portrait") || report.runs[0];
        const shot = phone ? finalShot(phone) : null;
        if (shot) {
          const image = await picture(path.join(folder, shot));
          const name = files.add(`screens/${safeName(build.network ? build.network.name : build.name)}.${image.ext}`, image.data);
          thumb = `<img src="${escapeHtml(name)}" alt="" />`;
        }
      } catch {
        thumb = "";
      }
    }
    // A network turned off in Settings is left out of the client's page altogether.
    if (build.state === "skipped") {
      continue;
    }
    const done = build.state === "done" && build.verdict;
    if (!done || build.verdict === "fail") {
      worst = "fail";
    } else if (build.verdict === "warn" && worst === "pass") {
      worst = "warn";
    }
    const answer: Answer = done ? ANSWER[build.verdict!] : "no";
    rows.push(`<tr>
      <td><b>${escapeHtml(build.network ? build.network.name : build.name)}</b><span class="file">${escapeHtml(build.name)}</span></td>
      <td><span class="cell"><span class="mark ${answer}">${GLYPH[answer]}</span>${escapeHtml(done ? texts.legend[answer] : texts.didNotRun)}</span></td>
      <td>${thumb}</td>
    </tr>`);
  }

  let played = "";
  if (playedReport) {
    try {
      const { report, folder } = await readReport(reportsDir, playedReport);
      played = `${await videoSection(texts, report, folder, files)}${await gallerySection(texts, report, folder, files)}`;
    } catch {
      played = "";
    }
  }
  const answer = ANSWER[worst];
  const body = `<header>
    <p class="eyebrow">${brandMark()} · ${escapeHtml(texts.title)}</p>
    <h1>${escapeHtml(batch.name.replace(/\.zip$/i, ""))}</h1>
    <p class="lead">${escapeHtml(texts.checked(screens))}</p>
    <div class="status ${answer}"><span class="mark ${answer}">${GLYPH[answer]}</span>${escapeHtml(texts.verdicts[worst])}</div>
  </header>
  ${played}
  <h2>${escapeHtml(texts.networks)}</h2>
  <table><thead><tr><th>${escapeHtml(texts.network)}</th><th>${escapeHtml(texts.status)}</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  files.entries.unshift({ name: `${root}/index.html`, data: Buffer.from(page(lang, batch.name, body), "utf8") });
  return { name: root, entries: files.entries };
};
