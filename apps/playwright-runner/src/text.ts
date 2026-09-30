import type { CheckResult } from "@playable-lab/checks";

/** One piece of text on screen, in CSS pixels of the page. */
export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Size of the letters on screen, CSS px; 0 when unknown. */
  px: number;
  /** The engine says the text does not fit its own box and was cut or shortened. */
  cut?: boolean;
  /** Wider than its own box, and drawn over whatever is next to it. */
  spill?: boolean;
  source: "unity" | "pixi" | "dom";
}

export interface TextSnapshot {
  /** Which picture of the run it was read with: "loaded", "final"... */
  label: string;
  /** That picture's file, under the report folder. */
  shot?: string;
  width: number;
  height: number;
  items: TextItem[];
}

/** Letters smaller than this (CSS px, about 1/16 inch) are hard to read on a phone held at arm's length. */
export const MIN_TEXT_PX = 9;

/**
 * Reads the text the game shows right now, from its own scene: Unity (Luna)
 * text components, Pixi text objects, and plain page text. Runs in the page.
 */
export const TEXT_PROBE_SOURCE = String.raw`
(function () {
  if (window.__labReadText) return;
  var MAX = 200;

  function list(l) {
    var n = l.length != null ? l.length : l.Count;
    var out = [];
    for (var i = 0; i < n; i += 1) out.push(l[i] !== undefined ? l[i] : l.getItem(i));
    return out;
  }

  // Luna keeps only part of Unity's API, so the text's place on screen is found
  // the way the game's own touch handling finds it: two screen points are turned
  // into the text box's local space, which gives the scale and offset between them.
  function unityItems(items) {
    var U = window.UnityEngine;
    if (!U || !U.Object || !U.Screen || !U.Vector2 || !U.Vector2.ctor || !U.RectTransformUtility) return false;
    var canvasEl = document.getElementById("application-canvas") || document.querySelector("canvas");
    if (!canvasEl) return false;
    var r = canvasEl.getBoundingClientRect();
    var sw = U.Screen.width, sh = U.Screen.height;
    if (!r.width || !r.height || !sw || !sh) return false;
    var kx = sw / r.width, ky = sh / r.height;
    var types = [];
    if (window.TMPro && window.TMPro.TMP_Text) types.push({ T: window.TMPro.TMP_Text, tmp: true });
    if (U.UI && U.UI.Text) types.push({ T: U.UI.Text, tmp: false });
    if (!types.length) return false;
    var toLocal = function (rt, cam, x, y) {
      var ref = { v: null };
      if (!U.RectTransformUtility.ScreenPointToLocalPointInRectangle(rt, new U.Vector2.ctor(x, y), cam, ref) || !ref.v) return null;
      return ref.v;
    };
    var found = false;
    types.forEach(function (kind) {
      var all;
      try { all = list(U.Object.FindObjectsOfType(kind.T)); } catch (_) { return; }
      all.forEach(function (t) {
        if (items.length >= MAX) return;
        try {
          if (t.enabled === false || !t.gameObject.activeInHierarchy) return;
          var text = String(t.text == null ? "" : t.text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (!text) return;
          if (t.color && t.color.a < 0.05) return;
          var canvas = t.canvas;
          var cam = canvas ? (canvas.renderMode !== 0 ? canvas.worldCamera || U.Camera.main : null) : U.Camera.main;
          var rt = t.rectTransform;
          var p0 = toLocal(rt, cam, 0, 0), p1 = toLocal(rt, cam, sw, sh);
          if (!p0 || !p1) return;
          var ax = (p1.x - p0.x) / sw, ay = (p1.y - p0.y) / sh;
          if (!ax || !ay) return;
          found = true;
          var box = rt.rect;
          var size = t.fontSize || 0;
          var width = typeof t.preferredWidth === "number" ? t.preferredWidth : box.width;
          var wraps = kind.tmp ? t.enableWordWrapping === true : t.horizontalOverflow === 0;
          var lines = text.split("\n").length;
          var glyphW = wraps ? Math.min(width, box.width) : width;
          var glyphH = wraps ? box.height : Math.min(box.height, size * 1.2 * lines) || box.height;
          // Where the letters sit inside the box, by its alignment.
          var h = 1, v = 1;
          if (kind.tmp) {
            var al = t.alignment || 0;
            h = al & 1 ? 0 : al & 4 ? 2 : 1;
            v = al & 256 ? 0 : al & 1024 ? 2 : 1;
          } else if (typeof t.alignment === "number") {
            h = t.alignment % 3;
            v = Math.floor(t.alignment / 3);
          }
          var left = h === 0 ? box.x : h === 2 ? box.x + box.width - glyphW : box.x + (box.width - glyphW) / 2;
          var topY = v === 0 ? box.y + box.height : v === 2 ? box.y + glyphH : box.y + (box.height + glyphH) / 2;
          var toClient = function (lx, ly) {
            var sx = (lx - p0.x) / ax, sy = (ly - p0.y) / ay;
            return { x: r.left + sx / kx, y: r.top + (sh - sy) / ky };
          };
          var a = toClient(left, topY), c = toClient(left + glyphW, topY - glyphH);
          var spill = !wraps && width > box.width + 1;
          items.push({
            text: text.slice(0, 120),
            x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
            w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y),
            px: Math.round((size / Math.abs(ay) / ky) * 10) / 10,
            // Wider than its box: cut off when the box clips, spilling over the rest otherwise.
            cut: spill && kind.tmp && t.overflowMode != null && t.overflowMode !== 0 ? true : undefined,
            spill: spill && !(kind.tmp && t.overflowMode != null && t.overflowMode !== 0) ? true : undefined,
            source: "unity"
          });
        } catch (_) {}
      });
    });
    return found;
  }

  function pixiItems(items) {
    var app = window.__PIXI_APP__;
    var stage = app && app.stage ? app.stage : window.__PIXI_STAGE__;
    var renderer = app && app.renderer ? app.renderer : window.__PIXI_RENDERER__;
    if (!stage || !renderer) return false;
    var screen = (app && app.screen) || renderer.screen;
    var view = (app && (app.view || app.canvas)) || renderer.view || renderer.canvas;
    if (!screen || !view) return false;
    var r = view.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var sx = screen.width / r.width, sy = screen.height / r.height;
    var found = false;
    var visit = function (node) {
      if (!node || items.length >= MAX || node.visible === false || node.worldAlpha === 0) return;
      if (typeof node.text === "string" && node.text.trim()) {
        try {
          var b = node.getBounds();
          var size = (node.style && parseFloat(node.style.fontSize)) || node.fontSize || 0;
          var scale = node.worldTransform ? Math.sqrt(node.worldTransform.c * node.worldTransform.c + node.worldTransform.d * node.worldTransform.d) : 1;
          found = true;
          items.push({
            text: node.text.replace(/\s+/g, " ").trim().slice(0, 120),
            x: r.left + b.x / sx, y: r.top + b.y / sy, w: b.width / sx, h: b.height / sy,
            px: Math.round(size * scale / sy * 10) / 10,
            source: "pixi"
          });
        } catch (_) {}
      }
      (node.children || []).forEach(visit);
    };
    visit(stage);
    return found;
  }

  function domItems(items) {
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode()) && items.length < MAX) {
      var text = node.nodeValue.replace(/\s+/g, " ").trim();
      var el = node.parentElement;
      if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      var style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) < 0.05) continue;
      var range = document.createRange();
      range.selectNodeContents(node);
      var b = range.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      var cut = false;
      for (var box = el, depth = 0; box && box !== document.body && depth < 4; box = box.parentElement, depth += 1) {
        var bs = getComputedStyle(box);
        if (bs.overflow !== "visible" || bs.textOverflow === "ellipsis") {
          if (box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1) cut = true;
          break;
        }
      }
      items.push({
        text: text.slice(0, 120), x: b.left, y: b.top, w: b.width, h: b.height,
        px: parseFloat(style.fontSize) || 0, cut: cut || undefined, source: "dom"
      });
    }
  }

  window.__labReadText = function () {
    var items = [];
    try { unityItems(items) || pixiItems(items); } catch (_) {}
    try { domItems(items); } catch (_) {}
    return { width: window.innerWidth, height: window.innerHeight, items: items };
  };
})();
`;

const quote = (text: string): string => `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;

/** Which edges of the screen a piece of text crosses; empty when it is inside, or wholly outside (off by design). */
const edgesCrossed = (item: TextItem, width: number, height: number): string[] => {
  const tolerance = 2;
  if (item.x + item.w < 0 || item.x > width || item.y + item.h < 0 || item.y > height) {
    return [];
  }
  const edges: string[] = [];
  if (item.x < -tolerance) edges.push("left");
  if (item.x + item.w > width + tolerance) edges.push("right");
  if (item.y < -tolerance) edges.push("top");
  if (item.y + item.h > height + tolerance) edges.push("bottom");
  return edges;
};

export type TextIssue = "edge" | "cut" | "spill" | "small";

/** What is wrong with one piece of text on a screen of this size. */
export const itemIssues = (item: TextItem, width: number, height: number): TextIssue[] => {
  const issues: TextIssue[] = [];
  if (item.cut) {
    issues.push("cut");
  } else if (edgesCrossed(item, width, height).length > 0) {
    issues.push("edge");
  }
  if (item.spill) {
    issues.push("spill");
  }
  if (item.px > 0 && item.px < MIN_TEXT_PX && /[\p{L}\p{N}]/u.test(item.text)) {
    issues.push("small");
  }
  return issues;
};

/** What the report draws over a screen's picture: frames round text with a problem, dots where it was tapped. */
export interface ScreenMarks {
  shot: string;
  /** Fractions of the screen, 0..1. */
  boxes: Array<{ x: number; y: number; w: number; h: number; issue: TextIssue; text: string }>;
  taps: Array<{ x: number; y: number }>;
}

const fraction = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/**
 * The picture that tells the screen's story best: the first one with a text
 * problem, else the last one; with every tap of the run on it.
 */
export const screenMarks = (
  snapshots: TextSnapshot[],
  finalShot: string | undefined,
  taps: Array<{ x: number; y: number }>,
  width: number,
  height: number
): ScreenMarks | undefined => {
  const troubled = snapshots.find(
    (snapshot) => snapshot.shot && snapshot.items.some((item) => itemIssues(item, snapshot.width, snapshot.height).length > 0)
  );
  const shot = troubled?.shot || finalShot;
  if (!shot) {
    return undefined;
  }
  const boxes: ScreenMarks["boxes"] = [];
  for (const item of troubled?.items || []) {
    const issues = itemIssues(item, troubled!.width, troubled!.height);
    if (issues.length === 0) {
      continue;
    }
    const left = fraction(item.x / width);
    const top = fraction(item.y / height);
    boxes.push({
      x: left,
      y: top,
      w: Math.max(0.02, fraction((item.x + item.w) / width) - left),
      h: Math.max(0.015, fraction((item.y + item.h) / height) - top),
      issue: issues[0],
      text: item.text,
    });
  }
  return {
    shot,
    boxes: boxes.slice(0, 12),
    taps: taps.slice(0, 40).map((tap) => ({ x: fraction(tap.x / width), y: fraction(tap.y / height) })),
  };
};

/** Everything wrong with the text read over one run: past an edge, cut in its box, too small. */
export const textProblems = (snapshots: TextSnapshot[]): { details: string[]; texts: number; smallest: number } => {
  const details: string[] = [];
  const seen = new Set<string>();
  const texts = new Set<string>();
  let smallest = Number.POSITIVE_INFINITY;
  const add = (key: string, line: string): void => {
    if (!seen.has(key)) {
      seen.add(key);
      details.push(line);
    }
  };
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      texts.add(item.text);
      const edges = edgesCrossed(item, snapshot.width, snapshot.height);
      // A text cut off inside its box is reported as cut, not also as past the edge.
      if (edges.length > 0 && !item.cut) {
        add(`edge:${item.text}`, `${quote(item.text)} goes past the ${edges.join(" and ")} edge of the screen`);
      }
      if (item.cut) {
        add(`cut:${item.text}`, `${quote(item.text)} does not fit its box and is cut off`);
      }
      if (item.spill) {
        add(`spill:${item.text}`, `${quote(item.text)} is wider than its box and runs over what is next to it`);
      }
      // Only letters and digits count: a lone "×" or "•" is a glyph, not reading matter.
      if (item.px > 0 && /[\p{L}\p{N}]/u.test(item.text)) {
        smallest = Math.min(smallest, item.px);
        if (item.px < MIN_TEXT_PX) {
          add(`small:${item.text}`, `${quote(item.text)} is ${item.px.toFixed(1)} px high: too small to read on this screen`);
        }
      }
    }
  }
  return { details, texts: texts.size, smallest };
};

export const textFitCheck = (snapshots: TextSnapshot[]): CheckResult => {
  const { details, texts, smallest } = textProblems(snapshots);
  if (texts === 0) {
    return {
      id: "text-fit",
      title: "Text fits and is readable",
      status: "skip",
      message: "No text could be read from the game: it may be drawn as pictures. Check the text by eye on the screenshots.",
    };
  }
  return {
    id: "text-fit",
    title: "Text fits and is readable",
    status: details.length > 0 ? "warn" : "pass",
    message:
      details.length > 0
        ? `${details.length} ${details.length === 1 ? "text has" : "texts have"} a problem on this screen.`
        : `${texts} ${texts === 1 ? "text" : "texts"}, all inside the screen and whole${Number.isFinite(smallest) ? `; the smallest is ${smallest.toFixed(0)} px high` : ""}.`,
    details: details.slice(0, 12),
  };
};

/** The words a player reads: at least two letters, not just a number or a clock. */
export const readableStrings = (snapshots: TextSnapshot[]): string[] => {
  const out = new Set<string>();
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      const text = item.text.trim();
      if ((text.match(/\p{L}/gu) || []).length >= 2) {
        out.add(text);
      }
    }
  }
  return Array.from(out);
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  ru: "Russian",
  uk: "Ukrainian",
  pl: "Polish",
  tr: "Turkish",
  nl: "Dutch",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese",
};

/** The phone language each code stands for, as the browser reports it. */
export const LOCALES: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  pt: "pt-BR",
  it: "it-IT",
  ru: "ru-RU",
  uk: "uk-UA",
  pl: "pl-PL",
  tr: "tr-TR",
  nl: "nl-NL",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  ar: "ar-SA",
  hi: "hi-IN",
  id: "id-ID",
  th: "th-TH",
  vi: "vi-VN",
};

export interface LanguageTexts {
  code: string;
  strings: string[];
}

/**
 * Compares what the game says with the phone in each language against English.
 * A language that shows exactly the English words is not translated; one that
 * shows some English words among its own is translated only in part. When no
 * language differs from English, the ad simply has one language: not a defect.
 */
export const languageChecks = (english: LanguageTexts, others: LanguageTexts[]): Map<string, CheckResult> => {
  const results = new Map<string, CheckResult>();
  const base = new Set(english.strings);
  const translated = others.filter((other) => other.strings.some((text) => !base.has(text)));
  const oneLanguage = english.strings.length > 0 && translated.length === 0;
  results.set(english.code, {
    id: "language",
    title: "Language",
    status: english.strings.length === 0 ? "skip" : "info",
    message:
      english.strings.length === 0
        ? "No text could be read from the game, so the languages could not be compared."
        : oneLanguage
          ? "The ad shows the same text whatever the phone's language: it has one language."
          : `The reference: ${english.strings.length} texts in English.`,
    details: english.strings.slice(0, 12).map((text) => quote(text)),
  });
  for (const other of others) {
    const name = LANGUAGE_NAMES[other.code] || other.code;
    const own = other.strings.filter((text) => !base.has(text));
    const same = other.strings.filter((text) => base.has(text));
    let check: CheckResult;
    if (english.strings.length === 0 && other.strings.length === 0) {
      check = { id: "language", title: "Language", status: "skip", message: "No text could be read from the game." };
    } else if (oneLanguage) {
      check = {
        id: "language",
        title: "Language",
        status: "info",
        message: `With the phone in ${name} the ad stays in English, like every other language checked.`,
      };
    } else if (own.length === 0) {
      check = {
        id: "language",
        title: "Language",
        status: "warn",
        message: `Not translated: with the phone in ${name} the ad shows the English text, while other languages are translated.`,
        details: same.slice(0, 8).map((text) => quote(text)),
      };
    } else if (same.length > 0) {
      check = {
        id: "language",
        title: "Language",
        status: "warn",
        message: `Partly translated: ${same.length} of ${other.strings.length} texts are still in English. Names and brands may stay as they are: check the rest.`,
        details: same.slice(0, 8).map((text) => quote(text)),
      };
    } else {
      check = {
        id: "language",
        title: "Language",
        status: "pass",
        message: `Translated: ${own.length} ${own.length === 1 ? "text differs" : "texts differ"} from English.`,
        details: own.slice(0, 8).map((text) => quote(text)),
      };
    }
    results.set(other.code, check);
  }
  return results;
};
