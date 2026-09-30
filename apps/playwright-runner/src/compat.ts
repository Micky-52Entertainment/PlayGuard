import type { CheckResult } from "@playable-lab/checks";

/**
 * Old phones: iOS 13–14 and Android 8–9 are still in players' hands. Their
 * browsers cannot be run here, so a playable is judged two ways: its code is
 * read for language features those browsers do not have (the whole script
 * then fails to start), and it is played once more with the newer browser
 * features taken away (a call to one of them then throws, as it would there).
 */

export interface OldProfile {
  id: string;
  /** "iOS 13", "Android 8–9": what the reader knows. */
  name: string;
  /** The phone it runs on in the report. */
  device: string;
  /** Browser version it stands for: Safari for iOS, Chrome (WebView) for Android. */
  safari?: number;
  chrome?: number;
}

export const OLD_PROFILES: OldProfile[] = [
  { id: "ios13", name: "iOS 13", device: "iphone-se", safari: 13.0 },
  { id: "ios14", name: "iOS 14", device: "iphone-se", safari: 14.0 },
  { id: "android8", name: "Android 8–9", device: "galaxy-s7", chrome: 69 },
];

interface Feature {
  id: string;
  /** What it is, for the report. */
  label: string;
  kind: "syntax" | "api" | "media";
  chrome: number;
  safari: number;
}

/** When each browser learned it. Syntax a browser lacks stops the whole script; an API only the call. */
export const FEATURES: Feature[] = [
  { id: "optional-chaining", label: "optional chaining (a?.b)", kind: "syntax", chrome: 80, safari: 13.1 },
  { id: "nullish", label: "nullish coalescing (a ?? b)", kind: "syntax", chrome: 80, safari: 13.1 },
  { id: "logical-assign", label: "logical assignment (a ||= b)", kind: "syntax", chrome: 85, safari: 14 },
  { id: "numeric-separator", label: "numeric separators (1_000)", kind: "syntax", chrome: 75, safari: 13 },
  { id: "bigint", label: "BigInt literals (10n)", kind: "syntax", chrome: 67, safari: 14 },
  { id: "class-fields", label: "class fields", kind: "syntax", chrome: 72, safari: 14 },
  { id: "private-fields", label: "private class members (#x)", kind: "syntax", chrome: 74, safari: 14.1 },
  { id: "private-methods", label: "private class methods (#m())", kind: "syntax", chrome: 84, safari: 15 },
  { id: "static-block", label: "static class blocks", kind: "syntax", chrome: 94, safari: 16.4 },
  { id: "regex-lookbehind", label: "regular-expression lookbehind ((?<=…))", kind: "syntax", chrome: 62, safari: 16.4 },
  { id: "regex-d-flag", label: "regular-expression d flag", kind: "syntax", chrome: 90, safari: 15 },
  { id: "top-level-await", label: "top-level await", kind: "syntax", chrome: 89, safari: 15 },
  { id: "array-at", label: "Array/String .at()", kind: "api", chrome: 92, safari: 15.4 },
  { id: "find-last", label: "Array .findLast()", kind: "api", chrome: 97, safari: 15.4 },
  { id: "has-own", label: "Object.hasOwn()", kind: "api", chrome: 93, safari: 15.4 },
  { id: "structured-clone", label: "structuredClone()", kind: "api", chrome: 98, safari: 15.4 },
  { id: "replace-all", label: "String .replaceAll()", kind: "api", chrome: 85, safari: 13.1 },
  { id: "promise-any", label: "Promise.any()", kind: "api", chrome: 85, safari: 14 },
  { id: "weakref", label: "WeakRef", kind: "api", chrome: 84, safari: 14.1 },
  { id: "offscreen-canvas", label: "OffscreenCanvas", kind: "api", chrome: 69, safari: 16.4 },
  { id: "image-bitmap", label: "createImageBitmap()", kind: "api", chrome: 50, safari: 15 },
  { id: "idle-callback", label: "requestIdleCallback()", kind: "api", chrome: 47, safari: 99 },
  { id: "audio-context", label: "AudioContext without the webkitAudioContext fallback", kind: "api", chrome: 35, safari: 14.1 },
  { id: "webgl2", label: "WebGL 2 without a WebGL 1 fallback", kind: "api", chrome: 56, safari: 15 },
  { id: "flat", label: "Array .flat()/.flatMap()", kind: "api", chrome: 69, safari: 12 },
  { id: "from-entries", label: "Object.fromEntries()", kind: "api", chrome: 73, safari: 12.1 },
  { id: "webp", label: "WebP images", kind: "media", chrome: 32, safari: 14 },
];

const lacks = (profile: OldProfile, feature: Feature): boolean =>
  profile.safari !== undefined ? profile.safari < feature.safari : (profile.chrome ?? 999) < feature.chrome;

type Node = { type?: string; [key: string]: unknown };

const walk = (node: unknown, visit: (node: Node, parent: Node | null) => void, parent: Node | null = null): void => {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit, parent);
    }
    return;
  }
  const current = node as Node;
  if (typeof current.type === "string") {
    visit(current, parent);
  }
  for (const key of Object.keys(current)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra" || key === "leadingComments" || key === "trailingComments") {
      continue;
    }
    const value = current[key];
    if (value && typeof value === "object") {
      walk(value, visit, typeof current.type === "string" ? current : parent);
    }
  }
};

const propertyName = (node: Node): string | null => {
  const property = node.property as Node | undefined;
  if (!property) return null;
  if (property.type === "Identifier" && !node.computed) return property.name as string;
  return null;
};

/** The features a set of scripts uses, found by reading them, with how often. */
export const scanFeatures = async (sources: string[], hasWebp: boolean): Promise<Map<string, number> | null> => {
  let parse: ((code: string, options: object) => unknown) | null = null;
  try {
    parse = ((await import("@babel/parser")) as { parse: (code: string, options: object) => unknown }).parse;
  } catch {
    return null;
  }
  const found = new Map<string, number>();
  const add = (id: string): void => {
    found.set(id, (found.get(id) || 0) + 1);
  };
  const all = sources.join("\n");
  const webkitAudio = /webkitAudioContext/.test(all);
  const webgl1 = /["'](?:experimental-)?webgl["']/.test(all);
  for (const code of sources) {
    let ast: unknown;
    try {
      ast = parse(code, { sourceType: "unambiguous", errorRecovery: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    } catch {
      continue;
    }
    walk((ast as { program: unknown }).program, (node) => {
      switch (node.type) {
        case "OptionalMemberExpression":
        case "OptionalCallExpression":
          add("optional-chaining");
          break;
        case "LogicalExpression":
          if (node.operator === "??") add("nullish");
          break;
        case "AssignmentExpression":
          if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") add("logical-assign");
          break;
        case "NumericLiteral": {
          const raw = (node.extra as { raw?: string } | undefined)?.raw || "";
          if (raw.includes("_")) add("numeric-separator");
          break;
        }
        case "BigIntLiteral":
          add("bigint");
          break;
        case "ClassProperty":
          add("class-fields");
          break;
        case "ClassPrivateProperty":
          add("private-fields");
          break;
        case "ClassPrivateMethod":
          add("private-methods");
          break;
        case "StaticBlock":
          add("static-block");
          break;
        case "RegExpLiteral": {
          const pattern = String(node.pattern || "");
          if (/\(\?<[=!]/.test(pattern)) add("regex-lookbehind");
          if (String(node.flags || "").includes("d")) add("regex-d-flag");
          break;
        }
        case "CallExpression": {
          const callee = node.callee as Node;
          if (callee?.type === "MemberExpression") {
            const name = propertyName(callee);
            const object = callee.object as Node;
            if (name === "at" && (node.arguments as unknown[]).length === 1) add("array-at");
            if (name === "findLast" || name === "findLastIndex") add("find-last");
            if (name === "replaceAll") add("replace-all");
            if (name === "flat" || name === "flatMap") add("flat");
            if (object?.type === "Identifier") {
              if (object.name === "Object" && name === "hasOwn") add("has-own");
              if (object.name === "Object" && name === "fromEntries") add("from-entries");
              if (object.name === "Promise" && name === "any") add("promise-any");
            }
            if (name === "getContext") {
              const first = (node.arguments as Node[])[0];
              if (first?.type === "StringLiteral" && first.value === "webgl2" && !webgl1) add("webgl2");
            }
          }
          if (callee?.type === "Identifier") {
            if (callee.name === "structuredClone") add("structured-clone");
            if (callee.name === "createImageBitmap") add("image-bitmap");
            if (callee.name === "requestIdleCallback") add("idle-callback");
          }
          break;
        }
        case "NewExpression": {
          const callee = node.callee as Node;
          const name = callee?.type === "Identifier" ? callee.name : callee?.type === "MemberExpression" ? propertyName(callee) : null;
          if (name === "WeakRef" || name === "FinalizationRegistry") add("weakref");
          if (name === "OffscreenCanvas") add("offscreen-canvas");
          if (name === "AudioContext" && !webkitAudio) add("audio-context");
          break;
        }
        default:
          break;
      }
    });
    // Top-level await: an await directly in the program body.
    const body = ((ast as { program: { body: Node[] } }).program?.body || []) as Node[];
    for (const statement of body) {
      const expression = statement.expression as Node | undefined;
      const declaration = (statement.declarations as Node[] | undefined)?.[0]?.init as Node | undefined;
      if (expression?.type === "AwaitExpression" || declaration?.type === "AwaitExpression") {
        add("top-level-await");
      }
    }
  }
  if (hasWebp) {
    add("webp");
  }
  return found;
};

/** What reading the code says about one old phone. */
export const oldCodeCheck = (profile: OldProfile, found: Map<string, number> | null): CheckResult => {
  if (!found) {
    return {
      id: "old-code",
      title: "Code for old browsers",
      status: "skip",
      message: "The code could not be read, so it was not checked against old browsers.",
    };
  }
  const missing = FEATURES.filter((feature) => found.has(feature.id) && lacks(profile, feature));
  const syntax = missing.filter((feature) => feature.kind === "syntax");
  const other = missing.filter((feature) => feature.kind !== "syntax");
  const version = profile.safari !== undefined ? `Safari ${profile.safari}` : `Chrome ${profile.chrome}`;
  const lines = missing.map(
    (feature) =>
      `${feature.label}${(found.get(feature.id) || 0) > 1 ? ` (${found.get(feature.id)} places)` : ""} — needs ${profile.safari !== undefined ? `Safari ${feature.safari >= 99 ? "—" : feature.safari}` : `Chrome ${feature.chrome}`}`
  );
  if (syntax.length > 0) {
    return {
      id: "old-code",
      title: "Code for old browsers",
      status: "fail",
      message: `On ${profile.name} (${version}) the code does not start: it is written with ${syntax.length === 1 ? "a feature" : "features"} that browser does not know. Build it for older browsers (Babel, or the engine's "legacy" target).`,
      details: lines,
    };
  }
  if (other.length > 0) {
    return {
      id: "old-code",
      title: "Code for old browsers",
      status: "warn",
      message: `On ${profile.name} (${version}) the code starts, but uses ${other.length === 1 ? "a feature" : "features"} that browser does not have: if it is reached, that part breaks.`,
      details: lines,
    };
  }
  return {
    id: "old-code",
    title: "Code for old browsers",
    status: "pass",
    message: `Nothing in the code is too new for ${profile.name} (${version}).`,
  };
};

/**
 * Runs before the playable: takes away what the old browser does not have, so
 * a call to it fails here as it would there.
 */
export const oldBrowserScript = (profile: OldProfile): string => {
  const gone = FEATURES.filter((feature) => feature.kind === "api" && lacks(profile, feature)).map((feature) => feature.id);
  return `(function () {
  var gone = ${JSON.stringify(gone)};
  function drop(owner, name) { try { delete owner[name]; } catch (_) {} try { if (name in owner) Object.defineProperty(owner, name, { value: undefined, configurable: true, writable: true }); } catch (_) {} }
  if (gone.indexOf("array-at") >= 0) { drop(Array.prototype, "at"); drop(String.prototype, "at"); }
  if (gone.indexOf("find-last") >= 0) { drop(Array.prototype, "findLast"); drop(Array.prototype, "findLastIndex"); }
  if (gone.indexOf("has-own") >= 0) drop(Object, "hasOwn");
  if (gone.indexOf("structured-clone") >= 0) drop(window, "structuredClone");
  if (gone.indexOf("replace-all") >= 0) drop(String.prototype, "replaceAll");
  if (gone.indexOf("promise-any") >= 0) { drop(Promise, "any"); drop(window, "AggregateError"); }
  if (gone.indexOf("weakref") >= 0) { drop(window, "WeakRef"); drop(window, "FinalizationRegistry"); }
  if (gone.indexOf("offscreen-canvas") >= 0) drop(window, "OffscreenCanvas");
  if (gone.indexOf("image-bitmap") >= 0) drop(window, "createImageBitmap");
  if (gone.indexOf("idle-callback") >= 0) { drop(window, "requestIdleCallback"); drop(window, "cancelIdleCallback"); }
  if (gone.indexOf("flat") >= 0) { drop(Array.prototype, "flat"); drop(Array.prototype, "flatMap"); }
  if (gone.indexOf("from-entries") >= 0) drop(Object, "fromEntries");
  if (gone.indexOf("audio-context") >= 0 && window.AudioContext) {
    // Old Safari has it only under its prefixed name.
    window.webkitAudioContext = window.webkitAudioContext || window.AudioContext;
    drop(window, "AudioContext");
  }
  if (gone.indexOf("webgl2") >= 0) {
    var getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === "webgl2") return null;
      return getContext.apply(this, arguments);
    };
  }
})();`;
};
