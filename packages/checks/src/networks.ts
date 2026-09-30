export type Packaging = "html" | "zip" | "html-or-zip";

export interface SourceRule {
  pattern: RegExp;
  message: string;
}

/**
 * What one ad network expects from a playable. Limits follow the networks'
 * public creative specs; they change, so `docs` points at the page to re-check.
 */
export interface AdNetworkProfile {
  id: string;
  name: string;
  packaging: Packaging;
  /** Limit for the uploaded file (the zip when `packaging` is "zip"). */
  maxBytes: number;
  /** Stricter limit when a bare HTML file is uploaded instead of a zip. */
  maxHtmlBytes?: number;
  /** `AdEvent.api` values this network accepts as the install click. */
  ctaApis: string[];
  /** How the CTA call is written in source, for humans and the static scan. */
  ctaCall: string;
  ctaSource: RegExp;
  /** Lifecycle calls the network's validator looks for. */
  requiredLifecycle: string[];
  expectedLifecycle: string[];
  /** "allowed": the network expects assets to come from a CDN. */
  externalRequests: "forbidden" | "discouraged" | "allowed";
  /** URLs the network itself tells you to load; the lab answers them so its own stand-in stays. */
  allowedExternal: string[];
  /** Parts of URLs that must really load, such as the network's own SDK. */
  passExternal?: string[];
  /** The HTML is a fragment for the network's page, not a whole document. */
  fragment?: boolean;
  requiredSource: SourceRule[];
  discouragedSource: SourceRule[];
  notes: string[];
  docs?: string;
}

const MB = 1024 * 1024;

export const AD_NETWORKS: AdNetworkProfile[] = [
  {
    id: "applovin",
    name: "AppLovin",
    packaging: "html",
    maxBytes: 5 * MB,
    ctaApis: ["mraid.open"],
    ctaCall: "mraid.open()",
    ctaSource: /mraid\s*\.\s*open\b/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "forbidden",
    allowedExternal: [],
    requiredSource: [],
    discouragedSource: [],
    notes: [
      "Single HTML file, all images, fonts, JS and CSS inlined (base64).",
      "MRAID 2.0: wait for the ready event before calling MRAID APIs.",
      "Must work in both portrait and landscape.",
      "Audio stays muted until the first user interaction.",
    ],
    docs: "https://support.applovin.com/en/growth/promoting-your-apps/creatives/best-practices-and-guidelines",
  },
  {
    id: "unity",
    name: "Unity Ads",
    packaging: "html",
    maxBytes: 5 * MB,
    ctaApis: ["mraid.open"],
    ctaCall: "mraid.open(url)",
    ctaSource: /mraid\s*\.\s*open\b/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "discouraged",
    allowedExternal: [],
    requiredSource: [],
    discouragedSource: [],
    notes: [
      "Single inlined, minified HTML file with no links to other files.",
      "MRAID 3.0: start the content on the viewableChange event.",
      "The CTA links straight to the store through mraid.open, per platform.",
      "No network requests are needed; only privacy-safe analytics may be tolerated.",
      "Must support both portrait and landscape and never cover the close button.",
    ],
    docs: "https://docs.unity.com/grow/acquire/creatives/playable/specifications",
  },
  {
    id: "meta",
    name: "Meta (Facebook / Audience Network)",
    packaging: "html-or-zip",
    maxBytes: 5 * MB,
    maxHtmlBytes: 2 * MB,
    ctaApis: ["FbPlayableAd.onCTAClick"],
    ctaCall: "FbPlayableAd.onCTAClick()",
    ctaSource: /FbPlayableAd\s*\.\s*onCTAClick\b/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "forbidden",
    allowedExternal: [],
    requiredSource: [],
    discouragedSource: [
      {
        pattern: /XMLHttpRequest/,
        message: "Source mentions XMLHttpRequest; Meta does not permit HTTP requests from a playable.",
      },
      {
        pattern: /\bmraid\s*\.\s*open\b/,
        message: "Source calls mraid.open; Meta has no MRAID, the CTA must be FbPlayableAd.onCTAClick().",
      },
    ],
    notes: [
      "A single HTML file up to 2 MB, or a zip up to 5 MB with index.html at the root.",
      "No HTTP requests, no JavaScript redirects, no external resources.",
      "Assets are inlined as data URIs.",
    ],
  },
  {
    id: "mintegral",
    name: "Mintegral",
    packaging: "html-or-zip",
    maxBytes: 5 * MB,
    ctaApis: ["install"],
    ctaCall: "window.install && window.install()",
    ctaSource: /\binstall\s*(?:&&|\(|\?\.)/,
    requiredLifecycle: ["gameReady"],
    expectedLifecycle: ["gameEnd"],
    externalRequests: "discouraged",
    allowedExternal: [],
    requiredSource: [
      { pattern: /\bgameReady\b/, message: "window.gameReady() is never referenced." },
      { pattern: /\bgameEnd\b/, message: "window.gameEnd() is never referenced." },
    ],
    discouragedSource: [],
    notes: [
      "Zip with one HTML file (or a bare HTML), 5 MB max.",
      "Call window.gameReady() when loaded and window.gameEnd() when the game is over.",
      "The playable defines gameStart() and gameClose(); the container calls them.",
    ],
  },
  {
    id: "google",
    name: "Google Ads (App campaigns)",
    packaging: "zip",
    maxBytes: 5 * MB,
    ctaApis: ["ExitApi.exit"],
    ctaCall: "ExitApi.exit()",
    ctaSource: /ExitApi\s*\.\s*(?:exit|delayedExit)\b/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "forbidden",
    allowedExternal: ["https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"],
    requiredSource: [
      {
        pattern: /tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi\.js/,
        message: "exitapi.js is not included in <head>.",
      },
      {
        pattern: /<meta[^>]+name\s*=\s*["']?ad\.orientation/i,
        message: 'No <meta name="ad.orientation" content="portrait,landscape"> tag.',
      },
    ],
    discouragedSource: [],
    notes: [
      "Upload a zip, 5 MB max, at most 512 files.",
      "Include exitapi.js in <head> and call ExitApi.exit() on the CTA.",
    ],
    docs: "https://support.google.com/google-ads/answer/9981650",
  },
  {
    id: "tiktok",
    name: "TikTok / Pangle",
    packaging: "zip",
    maxBytes: 5 * MB,
    ctaApis: ["playableSDK.openAppStore", "openAppStore"],
    ctaCall: "window.playableSDK.openAppStore()",
    ctaSource: /\bopenAppStore\b/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "forbidden",
    allowedExternal: [],
    requiredSource: [],
    discouragedSource: [],
    notes: [
      "Zip under 5 MB with index.html and config.json in the first-level directory.",
      'config.json carries the orientation: 0 both, 1 portrait only, 2 landscape only.',
    ],
    docs: "https://ads.tiktok.com/help/article/playable-ads",
  },
  {
    id: "liftoff",
    name: "Liftoff",
    packaging: "html-or-zip",
    maxBytes: 5 * MB,
    ctaApis: ["mraid.open", "parent.postMessage(download)"],
    ctaCall: "mraid.open() or parent.postMessage('download', '*')",
    ctaSource: /mraid\s*\.\s*open\b|postMessage\s*\(\s*["']download["']/,
    requiredLifecycle: [],
    expectedLifecycle: [],
    externalRequests: "discouraged",
    allowedExternal: [],
    requiredSource: [],
    discouragedSource: [],
    notes: ["Single HTML or zip, 5 MB max."],
  },
];


// Networks below are described from exporter documentation (Unity Playworks /
// Luna, Playturbo). Where only the format and size are documented the install
// call is left open: any store call counts.
const basic = (
  id: string,
  name: string,
  packaging: Packaging,
  maxBytes: number,
  extra: Partial<AdNetworkProfile> = {}
): AdNetworkProfile => ({
  id,
  name,
  packaging,
  maxBytes,
  ctaApis: [],
  ctaCall: "a store call",
  ctaSource: /(?:)/,
  requiredLifecycle: [],
  expectedLifecycle: [],
  externalRequests: "discouraged",
  allowedExternal: [],
  requiredSource: [],
  discouragedSource: [],
  notes: [],
  ...extra,
});

const MRAID_OPEN = {
  ctaApis: ["mraid.open"],
  ctaCall: "mraid.open(url)",
  ctaSource: /mraid\s*\.\s*open\b/,
};

AD_NETWORKS.push(
  basic("ironsource", "ironSource", "html", 5 * MB, {
    ctaApis: ["mraid.open", "dapi.openStoreUrl"],
    ctaCall: "mraid.open(url) or dapi.openStoreUrl()",
    ctaSource: /mraid\s*\.\s*open\b|dapi\s*\.\s*openStoreUrl\b/,
    notes: ["Single HTML file, 5 MB max.", "MRAID or the older DAPI; the CTA goes through one of them."],
  }),
  basic("vungle", "Vungle", "html-or-zip", 5 * MB, {
    ctaApis: ["parent.postMessage(download)", "mraid.open"],
    ctaCall: "parent.postMessage('download', '*')",
    ctaSource: /postMessage\s*\(\s*["']download["']|mraid\s*\.\s*open\b/,
    expectedLifecycle: ["parent.postMessage(complete)"],
    notes: [
      "HTML or zip, 5 MB max; the main file is named ad.html.",
      "Send 'complete' to the parent when the game ends.",
    ],
  }),
  basic("moloco", "Moloco", "html-or-zip", 5 * MB, {
    maxHtmlBytes: 2 * MB,
    ctaApis: ["FbPlayableAd.onCTAClick"],
    ctaCall: "FbPlayableAd.onCTAClick()",
    ctaSource: /FbPlayableAd\s*\.\s*onCTAClick\b/,
    notes: ["A single HTML up to 2 MB, or a zip up to 5 MB."],
  }),
  basic("adcolony", "AdColony", "html", 2 * MB, {
    ctaApis: ["mraid.openStore", "mraid.open"],
    ctaCall: "mraid.openStore(url)",
    ctaSource: /mraid\s*\.\s*open(?:Store)?\b/,
    // 2 MB does not hold a game: exporters keep the assets on a CDN.
    externalRequests: "allowed",
    notes: ["Single HTML file, 2 MB max.", "Assets are usually loaded from a CDN to fit the limit."],
  }),
  basic("aarki", "Aarki", "html-or-zip", 5 * MB, {
    notes: ["Single HTML file, 5 MB max."],
  }),
  basic("appreciate", "Appreciate", "zip", 4 * MB, {
    passExternal: ["z.tpbid.com/"],
    fragment: true,
    notes: [
      "Zip with resources, 4 MB max.",
      "The HTML is a snippet placed into Appreciate's own page, and it loads their SDK.",
    ],
  }),
  basic("snapchat", "Snapchat", "html", 5 * MB, { notes: ["Single HTML file, up to 5 MB."] }),
  basic("inmobi", "InMobi", "html-or-zip", 5 * MB, { ...MRAID_OPEN, notes: ["HTML or zip, 5 MB max."] }),
  basic("chartboost", "Chartboost", "html-or-zip", 3 * MB, { ...MRAID_OPEN, notes: ["3 MB max."] }),
  basic("tapjoy", "Tapjoy", "html-or-zip", Math.round(1.9 * MB), {
    ctaApis: ["TJ_API.click"],
    ctaCall: "TJ_API.click()",
    ctaSource: /TJ_API\s*\.\s*click\b/,
    notes: ["1.9 MB max."],
  }),
  basic("mytarget", "myTarget", "html-or-zip", 2 * MB, {
    ctaApis: ["MTRG.onCTAClick"],
    ctaCall: "MTRG.onCTAClick()",
    ctaSource: /MTRG\s*\.\s*onCTAClick\b/,
    notes: ["2 MB max."],
  }),
  basic("bigo", "Bigo Ads", "html-or-zip", 5 * MB, {
    ctaApis: ["BGY_MRAID.open"],
    ctaCall: "BGY_MRAID.open()",
    ctaSource: /BGY_MRAID\s*\.\s*open\b/,
    notes: ["5 MB max."],
  }),
  basic("kwai", "Kwai", "html-or-zip", 5 * MB, { notes: ["5 MB max."] }),
  basic("smadex", "Smadex", "html-or-zip", 5 * MB, { ...MRAID_OPEN, notes: ["5 MB max."] }),
  basic("adikteev", "Adikteev", "html", 5 * MB, { ...MRAID_OPEN, notes: ["Single HTML file, 5 MB max."] }),
  basic("bigabid", "BigaBid", "html", 5 * MB, { ...MRAID_OPEN, notes: ["Single HTML file, 5 MB max."] }),
  basic("kayzen", "Kayzen", "html-or-zip", 5 * MB, { ...MRAID_OPEN, notes: ["MRAID creative."] }),
  basic("remerge", "Remerge", "zip", 5 * MB, { notes: ["Zip with resources, 5 MB max."] }),
  basic("tencent", "Tencent", "zip", 3 * MB, { notes: ["Zip with resources, 3 MB max."] }),
  basic("youappi", "YouAppi", "html-or-zip", 10 * MB, {
    maxHtmlBytes: 5 * MB,
    notes: ["A single HTML up to 5 MB, or a zip up to 10 MB."],
  })
);

/** Hosts build tools call on their own; the playable's author did not add them. */
export const TELEMETRY_HOSTS = ["collector.lunalabs.io"];

export const isTelemetry = (url: string): boolean =>
  TELEMETRY_HOSTS.some((host) => url.includes(`//${host}/`) || url.endsWith(`//${host}`));

export const networkById = (id: string | undefined): AdNetworkProfile | undefined => {
  if (!id) {
    return undefined;
  }
  const wanted = id.toLowerCase();
  return AD_NETWORKS.find((network) => network.id === wanted);
};

/** Best guess from an export file name such as `BUS_PL06_81_applovin_en.html`. */
export const guessNetwork = (fileName: string): AdNetworkProfile | undefined => {
  const lower = fileName.toLowerCase();
  for (let i = 0; i < NAME_ALIASES.length; i += 1) {
    if (NAME_ALIASES[i][0].test(lower)) {
      return networkById(NAME_ALIASES[i][1]);
    }
  }
  return undefined;
};

// Short codes only count as a whole token: "fb" in "fb_en", not in "surfboard".
const token = (code: string): RegExp => new RegExp(`(^|[^a-z0-9])${code}([^a-z0-9]|$)`);

const NAME_ALIASES: Array<[RegExp, string]> = [
  [/iron[_-]?source/, "ironsource"],
  [/moloco/, "moloco"],
  [/adcolony/, "adcolony"],
  [/aarki/, "aarki"],
  [/appreciate/, "appreciate"],
  [/snapchat/, "snapchat"],
  [token("snap"), "snapchat"],
  [/inmobi/, "inmobi"],
  [/chartboost/, "chartboost"],
  [/tapjoy/, "tapjoy"],
  [/my[_-]?target/, "mytarget"],
  [/bigo/, "bigo"],
  [/kwai/, "kwai"],
  [/smadex/, "smadex"],
  [/adikteev/, "adikteev"],
  [/bigabid/, "bigabid"],
  [/kayzen/, "kayzen"],
  [/remerge/, "remerge"],
  [/tencent/, "tencent"],
  [/youappi/, "youappi"],
  [/vungle/, "vungle"],
  [/applovin/, "applovin"],
  [token("al"), "applovin"],
  [/unity/, "unity"],
  [/facebook|meta(?!l)/, "meta"],
  [token("fb"), "meta"],
  [/mintegral/, "mintegral"],
  [token("mtg"), "mintegral"],
  [/google|adwords/, "google"],
  [token("gads"), "google"],
  [/tiktok|pangle/, "tiktok"],
  [token("tt"), "tiktok"],
  [/liftoff/, "liftoff"],
];

const GENERIC_WORDS = new Set([
  "index", "html", "build", "builds", "creative", "default", "defaultcreative", "playable", "final",
  "portrait", "landscape", "release", "prod", "test", "source", "game", "main", "dist", "export",
]);

/**
 * The network as the file itself names it, for builds no profile matches:
 * "Default Creative_somenetwork.html" is a build for "Somenetwork".
 */
export const networkNameFromFile = (name: string): string | null => {
  const base = name.replace(/\\/g, "/").split("/").pop() || "";
  const parts = base
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const word = parts[i];
    // Skip language codes, versions and words every build has.
    if (word.length < 3 || /^\d+$/.test(word) || /^v?\d/.test(word) || GENERIC_WORDS.has(word.toLowerCase())) {
      continue;
    }
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
};

export interface DetectedNetwork {
  network?: AdNetworkProfile;
  /** What gave it away; "content" means the file name said nothing. */
  by: "name" | "content" | null;
}

/**
 * Which network a build is for: from its path first, then from the install API
 * it calls. MRAID alone is shared by several networks and proves nothing.
 */
export const detectNetwork = (name: string, html: string): DetectedNetwork => {
  const named = guessNetwork(name);
  if (named) {
    return { network: named, by: "name" };
  }
  const bySource: Array<[RegExp, string]> = [
    [/FbPlayableAd\s*\.\s*onCTAClick/, "meta"],
    [/ExitApi\s*\.\s*(?:exit|delayedExit)/, "google"],
    [/playableSDK|\bopenAppStore\b/, "tiktok"],
    [/\bgameReady\b[\s\S]*\binstall\b|\binstall\b[\s\S]*\bgameReady\b/, "mintegral"],
  ];
  for (let i = 0; i < bySource.length; i += 1) {
    if (bySource[i][0].test(html)) {
      return { network: networkById(bySource[i][1]), by: "content" };
    }
  }
  return { by: null };
};
