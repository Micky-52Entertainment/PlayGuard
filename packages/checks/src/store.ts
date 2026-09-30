import type { AdEvent } from "@playable-lab/protocol";
import type { CheckResult } from "./types.ts";

export type Store = "ios" | "android";

/** The app a store address leads to: a numeric id in the App Store, a package name on Google Play. */
export interface StoreTarget {
  store: Store;
  id: string;
}

/** The app the playable advertises, as the operator entered it: a store link, or the bare id. */
export interface ExpectedApps {
  ios?: string;
  android?: string;
}

const STORE_NAME: Record<Store, string> = { ios: "the App Store", android: "Google Play" };
const DEVICE_NAME: Record<Store, string> = { ios: "an iPhone or iPad", android: "an Android device" };

export const parseStoreUrl = (url: string): StoreTarget | null => {
  const apple = /(?:apps|itunes)\.apple\.com\/[^\s"']*?\bid(\d{5,})/i.exec(url) || /^itms-apps?:\/\/[^\s"']*?\bid(\d{5,})/i.exec(url);
  if (apple) {
    return { store: "ios", id: apple[1] };
  }
  const google = /(?:play\.google\.com\/store\/apps\/details|market:\/\/details)[^\s"']*?[?&]id=([\w.]+)/i.exec(url);
  if (google) {
    return { store: "android", id: google[1] };
  }
  return null;
};

/** The id out of what the operator typed; null when it is neither a link to that store nor an id. */
export const expectedId = (input: string | undefined, store: Store): string | null => {
  const text = (input || "").trim();
  if (!text) {
    return null;
  }
  const parsed = parseStoreUrl(text);
  if (parsed) {
    return parsed.store === store ? parsed.id : null;
  }
  if (store === "ios") {
    const digits = /^(?:id)?(\d{5,})$/.exec(text);
    return digits ? digits[1] : null;
  }
  return /^[a-zA-Z]\w*(\.\w+)+$/.test(text) ? text : null;
};

const isAddress = (text: string): boolean => /^(?:https?:\/\/|market:\/\/|itms-apps?:\/\/)/i.test(text);

const RANK = { fail: 3, warn: 2, pass: 1, info: 0, skip: 0 } as const;

/**
 * Where the install button leads on this device: the right store, and the
 * right app when the operator said which one it should be.
 */
export const storeLinkCheck = (adEvents: AdEvent[], os: Store, apps: ExpectedApps = {}): CheckResult | null => {
  const ctas = adEvents.filter((event) => event.kind === "cta");
  if (ctas.length === 0) {
    return null;
  }
  const base = { id: "store-link", title: "Install link" };
  const urls = Array.from(new Set(ctas.map((event) => event.detail || "").filter(isAddress)));
  if (urls.length === 0) {
    return {
      ...base,
      status: "skip",
      message: `The store is opened through ${ctas[0].api}, which carries no address: the ad network supplies the link, so check it in the network's dashboard.`,
    };
  }

  const wanted = expectedId(apps[os], os);
  let worst: CheckResult = { ...base, status: "skip", message: "" };
  for (let i = 0; i < urls.length; i += 1) {
    const target = parseStoreUrl(urls[i]);
    let next: CheckResult;
    if (!target) {
      next = {
        ...base,
        status: "info",
        message: `Opens ${new URL(urls[i]).host || urls[i]}, not a store page: a tracking or redirect link. The lab cannot see which app it ends at; open it on a phone once.`,
      };
    } else if (target.store !== os) {
      next = {
        ...base,
        status: "fail",
        message: `On ${DEVICE_NAME[os]} the install button opens ${STORE_NAME[target.store]} (${target.id}). That store does not exist on this device.`,
      };
    } else if (!wanted) {
      next = {
        ...base,
        status: "info",
        message: `Opens ${STORE_NAME[os]}, app ${target.id}. Enter the app's store links before the check to have this compared automatically.`,
      };
    } else if (target.id !== wanted) {
      next = {
        ...base,
        status: "fail",
        message: `Opens another app in ${STORE_NAME[os]}: ${target.id} instead of ${wanted}.`,
      };
    } else {
      next = { ...base, status: "pass", message: `Opens the right app in ${STORE_NAME[os]} (${target.id}).` };
    }
    if (worst.message === "" || RANK[next.status] > RANK[worst.status]) {
      worst = next;
    }
  }
  return { ...worst, details: urls.slice(0, 4) };
};

/** Store addresses written into the source, against the app they should lead to. */
export const sourceLinkCheck = (storeUrls: string[], apps: ExpectedApps): CheckResult | null => {
  const expected: Record<Store, string | null> = { ios: expectedId(apps.ios, "ios"), android: expectedId(apps.android, "android") };
  if (!expected.ios && !expected.android) {
    return null;
  }
  const base = { id: "store-source", title: "Store links in source" };
  const targets = storeUrls.map(parseStoreUrl).filter((target): target is StoreTarget => target !== null);
  if (targets.length === 0) {
    return {
      ...base,
      status: "skip",
      message: "No store address is written into the file: the link comes from the ad network.",
    };
  }
  const wrong = targets.filter((target) => expected[target.store] && target.id !== expected[target.store]);
  if (wrong.length > 0) {
    return {
      ...base,
      status: "fail",
      message: `The file holds a link to another app: ${wrong[0].id} in ${STORE_NAME[wrong[0].store]}, instead of ${expected[wrong[0].store]}.`,
      details: storeUrls.slice(0, 6),
    };
  }
  const missing = (["ios", "android"] as Store[]).filter(
    (store) => expected[store] && !targets.some((target) => target.store === store)
  );
  if (missing.length > 0) {
    return {
      ...base,
      status: "warn",
      message: `The file has no link to ${missing.map((store) => STORE_NAME[store]).join(" or ")}, although the app is there: players on ${missing.map((store) => DEVICE_NAME[store]).join(" and ")} may be sent to the wrong store.`,
      details: storeUrls.slice(0, 6),
    };
  }
  return { ...base, status: "pass", message: "Every store link in the file leads to the right app.", details: storeUrls.slice(0, 6) };
};

export type LinkGate = "ok" | "no-apps" | "unknown-store" | "mismatch" | "absent";

export interface LinkGateResult {
  verdict: LinkGate;
  /** Store links written into the playable, with the app each leads to. */
  found: Array<{ url: string; store: Store; id: string }>;
  expected: Record<Store, string | null>;
  /** For "mismatch": the first link that leads elsewhere. For "absent" and "unknown-store": the store concerned. */
  store?: Store;
  wrongId?: string;
}

/**
 * Whether a playable may be checked yet: the store links written into it
 * must lead to the app the team said it advertises, in every store that app
 * is in. Run before anything else, so a missing or wrong link stops the
 * check instead of reaching the ad network.
 */
export const linkGate = (storeUrls: string[], apps: ExpectedApps): LinkGateResult => {
  const expected: Record<Store, string | null> = { ios: expectedId(apps.ios, "ios"), android: expectedId(apps.android, "android") };
  const found: LinkGateResult["found"] = [];
  for (const url of storeUrls) {
    const target = parseStoreUrl(url);
    if (target && !found.some((item) => item.store === target.store && item.id === target.id)) {
      found.push({ url, ...target });
    }
  }
  if (!expected.ios && !expected.android) {
    return { verdict: "no-apps", found, expected };
  }
  const wrong = found.find((item) => expected[item.store] && item.id !== expected[item.store]);
  if (wrong) {
    return { verdict: "mismatch", found, expected, store: wrong.store, wrongId: wrong.id };
  }
  // A link to a store the team has not named cannot be judged.
  const unnamed = found.find((item) => !expected[item.store]);
  if (unnamed) {
    return { verdict: "unknown-store", found, expected, store: unnamed.store };
  }
  const missing = (["ios", "android"] as Store[]).find((store) => expected[store] && !found.some((item) => item.store === store));
  if (missing) {
    return { verdict: "absent", found, expected, store: missing };
  }
  return { verdict: "ok", found, expected };
};
