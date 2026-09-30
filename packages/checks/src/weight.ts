import { formatBytes } from "./types.ts";
import type { CheckResult } from "./types.ts";

export type WeightKind = "images" | "audio" | "video" | "fonts" | "code" | "data";

export interface WeightItem {
  /** What it is, e.g. "JPEG image" or a file's path in the archive. */
  label: string;
  kind: WeightKind;
  bytes: number;
}

export interface WeightReport {
  /** Sum of the parts: the HTML's own size, or the unpacked size of an archive. */
  total: number;
  parts: Array<{ kind: WeightKind; bytes: number; count: number }>;
  /** The heaviest single resources, largest first. */
  top: WeightItem[];
}

const KIND_LABEL: Record<WeightKind, string> = {
  images: "images",
  audio: "audio",
  video: "video",
  fonts: "fonts",
  code: "code and markup",
  data: "other packed data",
};

/** Shorter runs of base64 characters are words and identifiers, not resources. */
const MIN_EMBEDDED = 2000;
/** A packed asset is at least this long; shorter strings with odd characters are texts of the game. */
const MIN_PACKED = 8000;
const DATA_PREFIX = /data:([\w.+-]+\/[\w.+-]+)(?:;[\w=.+-]+)*;base64,$/;

const BASE64 = new Uint8Array(128);
for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") {
  BASE64[char.charCodeAt(0)] = 1;
}

const EXTENSION_KIND: Array<[RegExp, WeightKind]> = [
  [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ktx2?|basis|astc|pvr)$/i, "images"],
  [/\.(mp3|ogg|wav|m4a|aac|opus)$/i, "audio"],
  [/\.(mp4|webm|mov)$/i, "video"],
  [/\.(woff2?|ttf|otf|eot)$/i, "fonts"],
  [/\.(m?js|html?|css|wasm)$/i, "code"],
];

const fromMime = (mime: string): { kind: WeightKind; label: string } => {
  const [type, subtype] = mime.toLowerCase().split("/");
  const name = subtype.replace(/^x-/, "").replace(/\+xml$/, "").toUpperCase();
  if (type === "image") {
    return { kind: "images", label: `${name} image` };
  }
  if (type === "audio") {
    return { kind: "audio", label: `${name} sound` };
  }
  if (type === "video") {
    return { kind: "video", label: `${name} video` };
  }
  if (type === "font" || /font|woff|truetype|opentype/.test(subtype)) {
    return { kind: "fonts", label: `${name} font` };
  }
  return { kind: "data", label: `embedded data (${mime})` };
};

/** What a base64 blob holds, read from its first bytes. */
const sniff = (base64: string): { kind: WeightKind; label: string } => {
  try {
    return sniffBytes(Buffer.from(base64.slice(0, 24), "base64"));
  } catch {
    return { kind: "data", label: "embedded data" };
  }
};

/** Characters base122 cannot put into a string as they are; it escapes them into two-byte characters. */
const BASE122_ILLEGAL = [0, 10, 13, 34, 38, 92];

/**
 * The first bytes of a base122 string, the denser encoding Luna and other
 * exporters pack assets with: seven bits to a character.
 */
const base122Head = (text: string, wanted: number): Buffer => {
  const out: number[] = [];
  let current = 0;
  let filled = 0;
  const push = (seven: number): void => {
    for (let bit = 6; bit >= 0; bit -= 1) {
      current = (current << 1) | ((seven >> bit) & 1);
      filled += 1;
      if (filled === 8) {
        out.push(current);
        current = 0;
        filled = 0;
      }
    }
  };
  for (let i = 0; i < text.length && out.length < wanted; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      push(code);
      continue;
    }
    const illegal = (code >> 8) & 7;
    if (illegal !== 7) {
      push(BASE122_ILLEGAL[illegal] ?? 0);
    }
    push((((code >> 6) & 1) << 6) | (code & 63));
  }
  return Buffer.from(out);
};

const sniffBytes = (head: Buffer): { kind: WeightKind; label: string } => {
  const ascii = head.toString("latin1");
  if (ascii.startsWith("\x89PNG")) {
    return { kind: "images", label: "PNG image" };
  }
  if (head[0] === 0xff && head[1] === 0xd8) {
    return { kind: "images", label: "JPEG image" };
  }
  if (ascii.startsWith("GIF8")) {
    return { kind: "images", label: "GIF image" };
  }
  if (ascii.startsWith("RIFF")) {
    const form = ascii.slice(8, 12);
    return form === "WEBP"
      ? { kind: "images", label: "WebP image" }
      : form === "WAVE"
        ? { kind: "audio", label: "WAV sound" }
        : { kind: "data", label: "embedded data" };
  }
  if (ascii.startsWith("<svg") || ascii.startsWith("<?xml")) {
    return { kind: "images", label: "SVG image" };
  }
  if (ascii.startsWith("OggS")) {
    return { kind: "audio", label: "OGG sound" };
  }
  if (ascii.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
    return { kind: "audio", label: "MP3 sound" };
  }
  if (ascii.slice(4, 8) === "ftyp") {
    return /M4A/.test(ascii.slice(8, 12)) ? { kind: "audio", label: "M4A sound" } : { kind: "video", label: "MP4 video" };
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { kind: "video", label: "WebM video" };
  }
  if (ascii.startsWith("wOFF") || ascii.startsWith("wOF2")) {
    return { kind: "fonts", label: "WOFF font" };
  }
  if (ascii.startsWith("OTTO") || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)) {
    return { kind: "fonts", label: "font" };
  }
  return { kind: "data", label: "embedded data" };
};

/** Splits a text file into what is embedded in it and the code around that. */
const scanText = (text: string, where: string): { items: WeightItem[]; embedded: number } => {
  const items: WeightItem[] = [];
  let embedded = 0;
  const inside = (label: string): string => (where ? `${label} inside ${where}` : label);

  // Base122 and its kin: a long string, dense with characters outside ASCII.
  let open = text.indexOf('"');
  while (open !== -1) {
    const close = text.indexOf('"', open + 1);
    if (close === -1) {
      break;
    }
    if (close - open - 1 >= MIN_PACKED) {
      const sample = text.slice(open + 1, open + 1 + 4000);
      let beyond = 0;
      for (let i = 0; i < sample.length; i += 1) {
        if (sample.charCodeAt(i) > 127) {
          beyond += 1;
        }
      }
      if (beyond > sample.length * 0.03) {
        const what = sniffBytes(base122Head(sample, 16));
        const bytes = Buffer.byteLength(text.slice(open + 1, close), "utf8");
        items.push({ label: inside(what.kind === "data" ? "packed data" : what.label), kind: what.kind, bytes });
        embedded += bytes;
      }
    }
    open = close;
  }

  // Walked by hand: a build holds megabytes of base64 in one run, more than a regular expression can take.
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const code = i < text.length ? text.charCodeAt(i) : 0;
    if (code < 128 && BASE64[code] === 1) {
      if (start === -1) {
        start = i;
      }
      continue;
    }
    if (start !== -1 && i - start >= MIN_EMBEDDED) {
      const prefix = DATA_PREFIX.exec(text.slice(Math.max(0, start - 120), start));
      const what = prefix ? fromMime(prefix[1]) : sniff(text.slice(start, start + 24));
      const bytes = i - start + (prefix ? prefix[0].length : 0);
      items.push({ label: inside(what.label), kind: what.kind, bytes });
      embedded += bytes;
    }
    start = -1;
  }
  return { items, embedded };
};

/**
 * What takes the space: images, sound, code. `files` are the other files of a
 * build that ships as an archive; `scripts` is their script text, where
 * engines keep assets too.
 */
export const analyseWeight = (
  html: string,
  bundle?: { files: Array<{ name: string; bytes: number }>; entry: string; scripts?: string }
): WeightReport => {
  const items: WeightItem[] = [];
  const htmlBytes = new TextEncoder().encode(html).length;
  const inHtml = scanText(html, bundle ? bundle.entry : "");
  items.push(...inHtml.items);
  items.push({ label: bundle ? `${bundle.entry} (code and markup)` : "Code and markup", kind: "code", bytes: Math.max(0, htmlBytes - inHtml.embedded) });

  if (bundle) {
    const inScripts = bundle.scripts ? scanText(bundle.scripts, "the scripts") : { items: [], embedded: 0 };
    items.push(...inScripts.items);
    let scriptBytes = 0;
    for (let i = 0; i < bundle.files.length; i += 1) {
      const file = bundle.files[i];
      if (file.name === bundle.entry) {
        continue;
      }
      if (/\.m?js$/i.test(file.name)) {
        scriptBytes += file.bytes;
        continue;
      }
      const known = EXTENSION_KIND.find(([pattern]) => pattern.test(file.name));
      items.push({ label: file.name, kind: known ? known[1] : "data", bytes: file.bytes });
    }
    if (scriptBytes > 0) {
      items.push({ label: "Scripts (code)", kind: "code", bytes: Math.max(0, scriptBytes - inScripts.embedded) });
    }
  }

  const parts = new Map<WeightKind, { bytes: number; count: number }>();
  let total = 0;
  for (let i = 0; i < items.length; i += 1) {
    const part = parts.get(items[i].kind) || { bytes: 0, count: 0 };
    part.bytes += items[i].bytes;
    part.count += 1;
    parts.set(items[i].kind, part);
    total += items[i].bytes;
  }
  return {
    total,
    parts: Array.from(parts.entries())
      .map(([kind, part]) => ({ kind, ...part }))
      .filter((part) => part.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes),
    top: items
      .filter((item) => item.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
  };
};

const share = (bytes: number, total: number): string => `${Math.round((bytes / (total || 1)) * 100)}%`;

/** The breakdown as a check: never a verdict, always the first thing to read when the size is over the limit. */
export const weightCheck = (report: WeightReport): CheckResult => ({
  id: "weight",
  title: "What the file is made of",
  status: "info",
  message: `${report.parts
    .map((part) => `${KIND_LABEL[part.kind]} ${formatBytes(part.bytes)} (${share(part.bytes, report.total)})`)
    .join(" · ")}. To make the file smaller, start with the largest items below.`,
  details: report.top.map((item) => `${formatBytes(item.bytes)} · ${item.label}`),
});
