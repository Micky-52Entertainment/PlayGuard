import type { SessionTrace } from "@playable-lab/protocol";
import { isTelemetry } from "./networks.ts";
import type { AdNetworkProfile } from "./networks.ts";
import { sourceLinkCheck } from "./store.ts";
import type { ExpectedApps } from "./store.ts";
import { formatBytes } from "./types.ts";
import type { CheckResult } from "./types.ts";
import { analyseWeight, weightCheck } from "./weight.ts";

const RESOURCE_TAG =
  /<(script|link|img|audio|video|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi;
const STORE_URL =
  /(?:https?:\/\/(?:apps|itunes)\.apple\.com\/[^\s"'\\<>)]+|https?:\/\/play\.google\.com\/store\/apps\/[^\s"'\\<>)]+|market:\/\/details[^\s"'\\<>)]+)/gi;

const isInline = (url: string): boolean =>
  /^(?:data:|blob:|javascript:|about:|#|$)/i.test(url);

const isAbsolute = (url: string): boolean => /^(?:https?:)?\/\//i.test(url);

const unique = (list: string[]): string[] => Array.from(new Set(list));

const clip = (text: string, max = 140): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export interface SourceRefs {
  external: string[];
  local: string[];
  storeUrls: string[];
}

/** Resources the HTML points at outside of itself. */
export const scanSourceRefs = (html: string): SourceRefs => {
  const external: string[] = [];
  const local: string[] = [];
  let match: RegExpExecArray | null;
  RESOURCE_TAG.lastIndex = 0;
  while ((match = RESOURCE_TAG.exec(html))) {
    const url = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!url || isInline(url)) {
      continue;
    }
    if (isAbsolute(url)) {
      external.push(url);
    } else if (!/[{}$+]|\\/.test(url)) {
      // Skip template fragments inside JS strings.
      local.push(url);
    }
  }
  CSS_URL.lastIndex = 0;
  while ((match = CSS_URL.exec(html))) {
    external.push(match[1]);
  }
  STORE_URL.lastIndex = 0;
  const storeUrls = html.match(STORE_URL) || [];
  return {
    external: unique(external),
    local: unique(local),
    storeUrls: unique(storeUrls),
  };
};

export const htmlByteSize = (html: string): number => new TextEncoder().encode(html).length;

/** A build that ships as an archive: its size and what is in it. */
export interface BundleInfo {
  /** Size of the archive as uploaded to the network. */
  zipBytes: number;
  /** Paths inside the archive. */
  files: string[];
  /** Path of the entry HTML inside the archive. */
  entry: string;
  /** Text of the archive's script files: the install call often lives there, not in the HTML. */
  scripts?: string;
  /** Size of each file in the archive, for the breakdown of what takes the space. */
  sizes?: Array<{ name: string; bytes: number }>;
}

const bundleChecks = (refs: SourceRefs, bundle: BundleInfo, network?: AdNetworkProfile): CheckResult[] => {
  const results: CheckResult[] = [];
  const limit = network?.maxBytes ?? 5 * 1024 * 1024;
  results.push({
    id: "size",
    title: "File size",
    status: bundle.zipBytes > limit ? (network ? "fail" : "warn") : network ? "pass" : "info",
    message:
      bundle.zipBytes > limit
        ? `The zip is ${formatBytes(bundle.zipBytes)}, over the ${formatBytes(limit)} limit${network ? ` of ${network.name}` : " most networks use"} by ${formatBytes(bundle.zipBytes - limit)}.`
        : `The zip is ${formatBytes(bundle.zipBytes)}${network ? `, under the ${formatBytes(limit)} limit of ${network.name}` : ""}.`,
  });

  const problems: string[] = [];
  if (network?.packaging === "html") {
    problems.push(`${network.name} takes a single HTML file, not a zip.`);
  }
  if (bundle.entry.includes("/")) {
    problems.push(`The HTML is at ${bundle.entry}; networks look for it in the root of the zip.`);
  } else if (
    network &&
    network.packaging !== "html" &&
    network.id !== "mintegral" &&
    !network.fragment &&
    bundle.entry !== "index.html"
  ) {
    problems.push(`The HTML is named ${bundle.entry}; ${network.name} expects index.html.`);
  }
  if (network?.id === "google" && bundle.files.length > 512) {
    problems.push(`${bundle.files.length} files in the zip; Google allows 512.`);
  }
  if (network?.id === "tiktok" && !bundle.files.includes("config.json")) {
    problems.push("config.json is missing from the root of the zip.");
  }
  results.push({
    id: "packaging",
    title: "Packaging",
    status: problems.length === 0 ? "pass" : "fail",
    message:
      problems.length === 0
        ? `Zip with ${bundle.files.length} file${bundle.files.length === 1 ? "" : "s"}, ${bundle.entry} at the root.`
        : `${problems.length} problem${problems.length === 1 ? "" : "s"} with the archive.`,
    details: problems,
  });

  const base = bundle.entry.includes("/") ? bundle.entry.slice(0, bundle.entry.lastIndexOf("/") + 1) : "";
  const missing = refs.local
    .filter((url) => !/(^|\/)mraid\.js$/i.test(url))
    .filter((url) => !bundle.files.includes(base + url.replace(/^\.\//, "").split(/[?#]/)[0]));
  results.push({
    id: "single-file",
    title: "Self-contained file",
    status: missing.length === 0 ? "pass" : "fail",
    message:
      missing.length === 0
        ? "Every file the HTML refers to is in the zip."
        : `${missing.length} file${missing.length === 1 ? "" : "s"} the HTML refers to ${missing.length === 1 ? "is" : "are"} not in the zip.`,
    details: missing.slice(0, 20).map((url) => clip(url)),
  });
  return results;
};

/** Checks that need only the file: size, packaging, references, required APIs. */
export const runStaticChecks = (
  html: string,
  network?: AdNetworkProfile,
  bundle?: BundleInfo,
  options: { apps?: ExpectedApps } = {}
): CheckResult[] => {
  const results: CheckResult[] = [];
  const bytes = htmlByteSize(html);
  const refs = scanSourceRefs(html);
  if (bundle?.scripts) {
    // Engines keep the store address in their scripts as often as in the page.
    STORE_URL.lastIndex = 0;
    refs.storeUrls = unique([...refs.storeUrls, ...(bundle.scripts.match(STORE_URL) || [])]);
  }

  if (bundle) {
    results.push(...bundleChecks(refs, bundle, network));
  }

  // Size
  if (bundle) {
    // Reported above, against the archive.
  } else if (!network) {
    results.push({
      id: "size",
      title: "File size",
      status: bytes > 5 * 1024 * 1024 ? "warn" : "info",
      message:
        bytes > 5 * 1024 * 1024
          ? `${formatBytes(bytes)} — over the 5 MB limit most networks use.`
          : `${formatBytes(bytes)}. Pick a network to check it against a limit.`,
    });
  } else if (network.packaging === "zip") {
    results.push({
      id: "size",
      title: "File size",
      status: bytes > network.maxBytes ? "warn" : "pass",
      message:
        bytes > network.maxBytes
          ? `HTML is ${formatBytes(bytes)}; ${network.name} limits the zip to ${formatBytes(network.maxBytes)}. It only fits if compression wins enough.`
          : `HTML is ${formatBytes(bytes)}, under the ${formatBytes(network.maxBytes)} zip limit of ${network.name}.`,
    });
  } else {
    const htmlLimit = network.maxHtmlBytes ?? network.maxBytes;
    const fitsHtml = bytes <= htmlLimit;
    const fitsZip = network.packaging === "html-or-zip" && bytes <= network.maxBytes;
    results.push({
      id: "size",
      title: "File size",
      status: fitsHtml ? "pass" : fitsZip ? "warn" : "fail",
      message: fitsHtml
        ? `${formatBytes(bytes)}, under the ${formatBytes(htmlLimit)} limit of ${network.name}.`
        : fitsZip
          ? `${formatBytes(bytes)} is over the ${formatBytes(htmlLimit)} limit for a bare HTML; upload it to ${network.name} as a zip (${formatBytes(network.maxBytes)} max).`
          : `${formatBytes(bytes)} is over the ${formatBytes(htmlLimit)} limit of ${network.name} by ${formatBytes(bytes - htmlLimit)}.`,
    });
  }

  // External references
  const allowed = network?.allowedExternal ?? [];
  const passed = network?.passExternal ?? [];
  const external = refs.external.filter(
    (url) =>
      !allowed.some((prefix) => url.includes(prefix)) &&
      !passed.some((part) => url.includes(part)) &&
      !isTelemetry(url)
  );
  const cdnExpected = network?.externalRequests === "allowed";
  results.push({
    id: "external-refs",
    title: "External resources in source",
    status:
      external.length === 0 || cdnExpected
        ? "pass"
        : network?.externalRequests === "forbidden"
          ? "fail"
          : "warn",
    message:
      external.length === 0
        ? "No external script, style or media URLs."
        : cdnExpected
          ? `${external.length} external URL${external.length === 1 ? "" : "s"}; ${network!.name} builds load their assets from a CDN.`
          : `${external.length} external URL${external.length === 1 ? "" : "s"} referenced${network ? `; ${network.name} ${network.externalRequests === "forbidden" ? "forbids" : "discourages"} them` : ""}.`,
    details: external.slice(0, 20).map((url) => clip(url)),
  });

  // Separate local files
  const local = refs.local.filter((url) => !/(^|\/)mraid\.js$/i.test(url));
  const singleFile = !network || network.packaging !== "zip";
  if (!bundle) results.push({
    id: "single-file",
    title: "Self-contained file",
    status: local.length === 0 ? "pass" : singleFile ? "fail" : "warn",
    message:
      local.length === 0
        ? "No references to separate local files."
        : `${local.length} reference${local.length === 1 ? "" : "s"} to separate files; ${singleFile ? "they will not exist once the HTML is uploaded on its own" : "make sure they are inside the zip"}.`,
    details: local.slice(0, 20).map((url) => clip(url)),
  });

  const code = bundle?.scripts ? `${html}\n${bundle.scripts}` : html;
  if (network) {
    // CTA call
    const hasCta = network.ctaSource.test(code);
    if (network.ctaApis.length > 0) results.push({
      id: "cta-source",
      title: "CTA call in source",
      status: hasCta ? "pass" : "warn",
      message: hasCta
        ? `${network.ctaCall} is present.`
        : `${network.ctaCall} was not found in the source. If the name is built at runtime the replay check decides.`,
    });

    const missing = network.requiredSource.filter((rule) => !rule.pattern.test(code));
    if (network.requiredSource.length > 0) {
      results.push({
        id: "required-source",
        title: `${network.name} integration`,
        status: missing.length === 0 ? "pass" : "fail",
        message:
          missing.length === 0
            ? "Required tags and calls are present."
            : `${missing.length} required item${missing.length === 1 ? " is" : "s are"} missing.`,
        details: missing.map((rule) => rule.message),
      });
    }

    const discouraged = network.discouragedSource.filter((rule) => rule.pattern.test(code));
    if (network.discouragedSource.length > 0) {
      results.push({
        id: "discouraged-source",
        title: `${network.name} restrictions`,
        status: discouraged.length === 0 ? "pass" : "warn",
        message:
          discouraged.length === 0
            ? "Nothing the network restricts was found."
            : `${discouraged.length} restricted pattern${discouraged.length === 1 ? "" : "s"} found.`,
        details: discouraged.map((rule) => rule.message),
      });
    }

    if (network.packaging === "zip" && !bundle) {
      results.push({
        id: "packaging",
        title: "Packaging",
        status: "warn",
        message: `${network.name} takes a zip, not a bare HTML: pack it before upload.`,
        details: network.notes,
      });
    }
  }

  const hasViewport = /<meta[^>]+name\s*=\s*["']?viewport/i.test(html);
  if (!network?.fragment) results.push({
    id: "viewport-meta",
    title: "Viewport meta tag",
    status: hasViewport ? "pass" : "warn",
    message: hasViewport
      ? "Present."
      : "No viewport meta tag: the playable will render at desktop width in a bare WebView.",
  });

  results.push({
    id: "store-links",
    title: "Store links",
    status: "info",
    message:
      refs.storeUrls.length === 0
        ? "No hard-coded App Store / Google Play URL."
        : `${refs.storeUrls.length} store URL${refs.storeUrls.length === 1 ? "" : "s"} in source.`,
    details: refs.storeUrls.slice(0, 6).map((url) => clip(url)),
  });

  const links = options.apps ? sourceLinkCheck(refs.storeUrls, options.apps) : null;
  if (links) {
    results.push(links);
  }

  results.push(
    weightCheck(
      analyseWeight(
        html,
        bundle && bundle.sizes ? { files: bundle.sizes, entry: bundle.entry, scripts: bundle.scripts } : undefined
      )
    )
  );

  return results;
};

/** Is the recording itself usable as replay input? */
export const runTraceChecks = (trace: SessionTrace): CheckResult[] => {
  const results: CheckResult[] = [];
  const pointers = trace.events.filter((event) => (event.type || "pointer") === "pointer");

  if (trace.abort) {
    results.push({
      id: "trace-complete",
      title: "Recording finished cleanly",
      status: "warn",
      message: `Session was aborted (${trace.abort.code}): ${trace.abort.reason}`,
    });
  }

  if (pointers.length === 0) {
    results.push({
      id: "trace-input",
      title: "Recorded input",
      status: "warn",
      message: "The trace has no pointer events; the replay only loads the playable.",
    });
    return results;
  }

  let spread = 0;
  for (let i = 1; i < pointers.length; i += 1) {
    spread = Math.max(
      spread,
      Math.abs(pointers[i].nx - pointers[0].nx),
      Math.abs(pointers[i].ny - pointers[0].ny)
    );
  }
  const rect = trace.sourceViewport.contentRect;
  const collapsed = rect.w <= 1 || rect.h <= 1 || (pointers.length > 5 && spread === 0);
  const downs = pointers.filter((event) => event.phase === "down").length;
  results.push({
    id: "trace-input",
    title: "Recorded input",
    status: collapsed ? "fail" : "pass",
    message: collapsed
      ? "Every recorded point sits on the same coordinate: the source measured a zero-size canvas. Record this step again."
      : `${downs} touch${downs === 1 ? "" : "es"}, ${pointers.length} pointer samples.`,
  });

  return results;
};
