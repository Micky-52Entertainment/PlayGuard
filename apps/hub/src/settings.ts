import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AD_NETWORKS, expectedId } from "@playable-lab/checks";
import { PLATFORMS } from "@playable-lab/device-catalog";
import type { Platform } from "@playable-lab/device-catalog";
import type { Depth } from "./runner.ts";

type Orientation = "portrait" | "landscape";

export type AiProviderId = "claude" | "gpt" | "monkey";

const PROVIDERS: AiProviderId[] = ["claude", "gpt", "monkey"];
const KEY_ENV: Record<"claude" | "gpt", string> = { claude: "ANTHROPIC_API_KEY", gpt: "OPENAI_API_KEY" };

interface Stored {
  /** Stress scenarios (idle, random taps, rotation) on every check. Off only when set to false. */
  stress?: boolean;
  /** iPhone and iPad screens in WebKit, Safari's engine, when it is installed. Off only when set to false. */
  safari?: boolean;
  /** How long the playable is left untouched, in seconds. */
  idleSeconds?: number;
  /** Kinds of device turned off; everything else is checked. */
  platformsOff?: Platform[];
  /** An orientation turned off; never both. */
  orientationOff?: Orientation;
  /** Ad networks whose builds in an archive are skipped. */
  networksOff?: string[];
  /** Languages the phone is set to, to see the ad's translations; English is always the reference. */
  languages?: string[];
  /** The language runs; on unless set to false. */
  languagesOn?: boolean;
  /** Played as on old phones (iOS 13–14, Android 8–9); on unless set to false. */
  oldPhones?: boolean;
  /** The depth a check starts with unless chosen otherwise: quick unless set to full. */
  depth?: Depth;
  /** The advertised app, as typed: a store link or a bare id for each store. */
  apps?: { ios?: string; android?: string };
  provider?: AiProviderId;
  keys?: { claude?: string; gpt?: string };
}

export const IDLE_CHOICES = [30, 120, 300];

/** Languages that can be checked, English first; the rest as a team is likely to ship them. */
export const LANGUAGE_CHOICES = ["en", "de", "fr", "es", "pt", "it", "ru", "uk", "pl", "tr", "nl", "ja", "ko", "zh", "ar", "hi", "id", "th", "vi"];
const DEFAULT_LANGUAGES = ["de", "fr", "es", "pt", "ru", "ja", "zh"];

export interface KeyStatus {
  configured: boolean;
  /** Where the key comes from: typed into the console, or the hub's environment. */
  source: "saved" | "env" | null;
  /** The last characters of a saved key, to tell keys apart. */
  hint: string | null;
}

export interface PublicSettings {
  stress: boolean;
  safari: boolean;
  idleSeconds: number;
  platforms: Record<Platform, boolean>;
  orientations: Record<Orientation, boolean>;
  /** Network ids turned off. */
  networksOff: string[];
  /** The phone languages the ad is opened in, besides English. */
  languages: { on: boolean; chosen: string[]; all: string[] };
  oldPhones: boolean;
  /** Quick: the main screens only. Full: also stress, languages and old phones, as set here. */
  depth: Depth;
  /** What was typed for each store, and the app id read out of it (null: not understood). */
  apps: Record<"ios" | "android", { text: string; id: string | null }>;
  provider: AiProviderId;
  keys: Record<"claude" | "gpt", KeyStatus>;
}

export const isProvider = (value: unknown): value is AiProviderId =>
  typeof value === "string" && (PROVIDERS as string[]).includes(value);

/**
 * What the operator set in the console. API keys stay on this computer: they
 * are written to a private file and handed to the runner, never sent back.
 */
export class Settings {
  private _stored: Stored = {};
  private readonly _file: string;

  public constructor(root: string) {
    this._file = path.join(root, ".playable-lab", "settings.json");
  }

  public async load(): Promise<void> {
    try {
      this._stored = JSON.parse(await readFile(this._file, "utf8")) as Stored;
    } catch {
      this._stored = {};
    }
  }

  public get provider(): AiProviderId {
    return isProvider(this._stored.provider) ? this._stored.provider : "claude";
  }

  public hasKey(provider: AiProviderId): boolean {
    return provider === "monkey" || Boolean(this._key(provider));
  }

  /** Environment for a runner that plays with `provider`. */
  public env(provider: AiProviderId): NodeJS.ProcessEnv {
    if (provider === "monkey") {
      return {};
    }
    const key = this._key(provider);
    return key ? { [KEY_ENV[provider]]: key } : {};
  }

  public view(): PublicSettings {
    const status = (provider: "claude" | "gpt"): KeyStatus => {
      const saved = this._stored.keys?.[provider];
      if (saved) {
        return { configured: true, source: "saved", hint: saved.slice(-4) };
      }
      return process.env[KEY_ENV[provider]]
        ? { configured: true, source: "env", hint: null }
        : { configured: false, source: null, hint: null };
    };
    return {
      stress: this._stored.stress !== false,
      safari: this._stored.safari !== false,
      idleSeconds: this._idleSeconds(),
      platforms: Object.fromEntries(PLATFORMS.map((item) => [item, !this._platformsOff().includes(item)])) as Record<Platform, boolean>,
      orientations: {
        portrait: this._stored.orientationOff !== "portrait",
        landscape: this._stored.orientationOff !== "landscape",
      },
      networksOff: this.networksOff,
      oldPhones: this._stored.oldPhones !== false,
      depth: this._stored.depth === "full" ? "full" : "quick",
      languages: { on: this._stored.languagesOn !== false, chosen: this._languages(), all: LANGUAGE_CHOICES.filter((code) => code !== "en") },
      apps: {
        ios: { text: this._stored.apps?.ios || "", id: expectedId(this._stored.apps?.ios, "ios") },
        android: { text: this._stored.apps?.android || "", id: expectedId(this._stored.apps?.android, "android") },
      },
      provider: this.provider,
      keys: { claude: status("claude"), gpt: status("gpt") },
    };
  }

  /** Runner options that follow from the settings. */
  public runnerArgs(depth?: Depth): string[] {
    const chosen: Depth = depth || (this._stored.depth === "full" ? "full" : "quick");
    const full = chosen === "full";
    const args: string[] = ["--depth", chosen];
    // The long parts only go into a full check: stress, old phones, languages.
    if (full && this._stored.stress !== false) {
      args.push("--stress", "--idle", String(this._idleSeconds() * 1000));
    }
    if (this._stored.safari === false) {
      args.push("--no-webkit");
    }
    const off = this._platformsOff();
    if (off.length > 0) {
      args.push("--platforms", PLATFORMS.filter((item) => !off.includes(item)).join(","));
    }
    if (this._stored.orientationOff) {
      args.push("--orientation", this._stored.orientationOff === "portrait" ? "landscape" : "portrait");
    }
    if (full && this._stored.oldPhones !== false) {
      args.push("--old-phones", "all");
    }
    if (full && this._stored.languagesOn !== false && this._languages().length > 0) {
      args.push("--languages", this._languages().join(","));
    }
    const ios = expectedId(this._stored.apps?.ios, "ios");
    const android = expectedId(this._stored.apps?.android, "android");
    if (ios) {
      args.push("--store-ios", ios);
    }
    if (android) {
      args.push("--store-android", android);
    }
    return args;
  }

  /** An empty key removes the saved one. */
  public async update(change: {
    provider?: unknown;
    stress?: unknown;
    safari?: unknown;
    idleSeconds?: unknown;
    platforms?: unknown;
    orientations?: unknown;
    networksOff?: unknown;
    languages?: { on?: unknown; chosen?: unknown };
    oldPhones?: unknown;
    depth?: unknown;
    apps?: { ios?: unknown; android?: unknown };
    keys?: { claude?: unknown; gpt?: unknown };
  }): Promise<void> {
    if (change.apps) {
      this._stored.apps = {
        ios: typeof change.apps.ios === "string" ? change.apps.ios.trim().slice(0, 500) : this._stored.apps?.ios,
        android:
          typeof change.apps.android === "string" ? change.apps.android.trim().slice(0, 500) : this._stored.apps?.android,
      };
    }
    if (typeof change.idleSeconds === "number" && IDLE_CHOICES.includes(change.idleSeconds)) {
      this._stored.idleSeconds = change.idleSeconds;
    }
    if (change.platforms && typeof change.platforms === "object") {
      const chosen = change.platforms as Record<string, unknown>;
      const off = PLATFORMS.filter((item) => chosen[item] === false);
      // At least one kind of device stays on: a check with no screens checks nothing.
      if (off.length < PLATFORMS.length) {
        this._stored.platformsOff = off;
      }
    }
    if (change.orientations && typeof change.orientations === "object") {
      const chosen = change.orientations as Record<string, unknown>;
      this._stored.orientationOff =
        chosen.portrait === false && chosen.landscape !== false
          ? "portrait"
          : chosen.landscape === false && chosen.portrait !== false
            ? "landscape"
            : undefined;
    }
    if (Array.isArray(change.networksOff)) {
      const known = new Set(AD_NETWORKS.map((network) => network.id));
      this._stored.networksOff = change.networksOff.filter((id): id is string => typeof id === "string" && known.has(id));
    }
    if (change.languages && typeof change.languages === "object") {
      if (typeof change.languages.on === "boolean") {
        this._stored.languagesOn = change.languages.on;
      }
      if (Array.isArray(change.languages.chosen)) {
        this._stored.languages = LANGUAGE_CHOICES.filter(
          (code) => code !== "en" && (change.languages!.chosen as unknown[]).includes(code)
        );
      }
    }
    if (change.depth === "quick" || change.depth === "full") {
      this._stored.depth = change.depth;
    }
    if (typeof change.oldPhones === "boolean") {
      this._stored.oldPhones = change.oldPhones;
    }
    if (isProvider(change.provider)) {
      this._stored.provider = change.provider;
    }
    if (typeof change.stress === "boolean") {
      this._stored.stress = change.stress;
    }
    if (typeof change.safari === "boolean") {
      this._stored.safari = change.safari;
    }
    const keys = { ...this._stored.keys };
    const names: Array<"claude" | "gpt"> = ["claude", "gpt"];
    for (let i = 0; i < names.length; i += 1) {
      const value = change.keys?.[names[i]];
      if (typeof value !== "string") {
        continue;
      }
      if (value.trim()) {
        keys[names[i]] = value.trim();
      } else {
        delete keys[names[i]];
      }
    }
    this._stored.keys = keys;
    await mkdir(path.dirname(this._file), { recursive: true });
    await writeFile(this._file, JSON.stringify(this._stored, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(this._file, 0o600).catch(() => undefined);
  }

  public get networksOff(): string[] {
    return this._stored.networksOff || [];
  }

  private _languages(): string[] {
    return (this._stored.languages || DEFAULT_LANGUAGES).filter((code) => LANGUAGE_CHOICES.includes(code) && code !== "en");
  }

  private _platformsOff(): Platform[] {
    return (this._stored.platformsOff || []).filter((item) => PLATFORMS.includes(item));
  }

  private _idleSeconds(): number {
    return IDLE_CHOICES.includes(this._stored.idleSeconds as number) ? (this._stored.idleSeconds as number) : 30;
  }

  private _key(provider: "claude" | "gpt"): string | undefined {
    return this._stored.keys?.[provider] || process.env[KEY_ENV[provider]] || undefined;
  }
}
