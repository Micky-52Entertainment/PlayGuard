/** A failed call to the hub: `code` picks the plain explanation, `message` is the technical text. */
export class ApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Calls the hub and returns its JSON; failures carry a code the UI can explain. */
export const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("HUB_DOWN", `${url} is not reachable`);
  }
  if (!response.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = (await response.json()) as { error?: string; code?: string };
    } catch {
      // The dev server answers for a hub that is not running with an empty 500.
    }
    const down = response.status >= 500 && !body.code;
    throw new ApiError(body.code || (down ? "HUB_DOWN" : "UNKNOWN"), body.error || `${url} failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

export const postJson = <T,>(url: string, body: unknown, method = "POST"): Promise<T> =>
  api<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface Health {
  browser: "bundled" | "chrome" | "none";
  video: boolean;
  /** WebKit, Safari's engine, is installed. */
  webkit: boolean;
  lan: boolean;
  /** The iPhone simulator of Xcode: there, missing, or not a Mac at all. */
  simulator?: SimulatorState;
  /** What is not installed yet and can be downloaded. */
  missing: Array<"browser" | "video" | "webkit">;
  downloadMb: number;
  install: { state: "idle" | "running" | "failed"; step?: string; percent?: number; error?: string };
}

export type SimulatorState = "ready" | "no-xcode" | "no-runtime" | "unsupported";

export type AiProviderId = "claude" | "gpt" | "monkey";

export interface KeyStatus {
  configured: boolean;
  source: "saved" | "env" | null;
  hint: string | null;
}

export interface AiSettings {
  /** False when this console is open on a teammate's computer. */
  local?: boolean;
  /** Stress scenarios run with every check. */
  stress: boolean;
  /** iOS screens run in WebKit when it is installed. */
  safari: boolean;
  /** How long the idle scenario waits, in seconds. */
  idleSeconds: number;
  /** Kinds of device checks run on. */
  platforms: Record<"android" | "ios" | "tablet" | "foldable", boolean>;
  orientations: Record<"portrait" | "landscape", boolean>;
  /** Phone languages the ad is opened in to check its translation; English is the reference. */
  languages?: { on: boolean; chosen: string[]; all: string[] };
  /** Played as on iOS 13–14 and Android 8–9. */
  oldPhones?: boolean;
  /** The depth a check starts with by default. */
  depth?: "quick" | "full";
  /** Ad networks whose builds in an archive are skipped. */
  networksOff: string[];
  /** The advertised app: what was typed for each store, and the id read out of it. */
  apps: Record<"ios" | "android", { text: string; id: string | null }>;
  provider: AiProviderId;
  keys: Record<"claude" | "gpt", KeyStatus>;
}

export const aiReady = (settings: AiSettings | null, provider: AiProviderId): boolean =>
  provider === "monkey" || Boolean(settings?.keys[provider].configured);

export interface QuickRun {
  id: string;
  playableId: string;
  playable: string;
  mode: "ai" | "load";
  provider: AiProviderId | null;
  state: "running" | "done" | "failed";
  startedAt: number;
  progress: { done: number; total: number } | null;
  /** Every screen of the run, with the ones done so far. */
  screens?: import("./Screens").ScreenTile[];
  tokens: { used: number; limit: number; calls: number } | null;
  lastLine: string | null;
  reportDir: string | null;
  verdict: "pass" | "warn" | "fail" | null;
  error?: string;
}
