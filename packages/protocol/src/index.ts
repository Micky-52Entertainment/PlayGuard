export const PROTOCOL_VERSION = 1 as const;

export type EngineKind = "luna" | "cocos" | "vanilla";
export type Orientation = "portrait" | "landscape";
export type DeviceGroup = "android" | "ios" | "tablet";
export type PointerKind = "touch" | "mouse" | "pen";
export type PointerPhase = "down" | "move" | "up" | "cancel" | "wheel" | "key";
export type InputType = "pointer" | "wheel" | "key" | "gesture";

/**
 * Where a touch landed in the playable's own scene: a point in the local space
 * of the object group under the finger. Another screen resolves it through its
 * copy of that group, so the touch follows the layout instead of the pixels.
 */
export interface TapAnchor {
  engine: "pixi" | "unity";
  /**
   * Pixi: child indices from the stage down to the group. Unity: the control's
   * name path, or "" for a point in world space.
   */
  path: string;
  x: number;
  y: number;
  /** Unity world points only: depth of the gameplay plane. */
  z?: number;
}

export interface PointerContact {
  pointerId: number;
  nx: number;
  ny: number;
  anchor?: TapAnchor;
  pressure: number;
}

export interface PointerSample {
  /** Wall clock of the source device (ms since epoch). */
  t: number;
  /** Ms since the playable's window `load` on the source. Replay schedules on this. */
  rt?: number;
  kind: PointerKind;
  phase: PointerPhase;
  pointerId: number;
  nx: number;
  ny: number;
  /** Set when the engine's scene was reachable on the source; preferred over nx/ny. */
  anchor?: TapAnchor;
  pressure: number;
  type?: InputType;
  isPrimary?: boolean;
  buttons?: number;
  pointers?: PointerContact[];
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  key?: string;
  code?: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  scale?: number;
  rotation?: number;
  gesture?:
    | "tap"
    | "doubletap"
    | "longpress"
    | "swipe"
    | "pinch"
    | "rotate"
    | "drag";
}
export type AdEventKind = "cta" | "lifecycle";

/** A call the playable made into an ad-network API (mocked by the lab). */
export interface AdEvent {
  t: number;
  rt: number;
  kind: AdEventKind;
  /** e.g. "mraid.open", "FbPlayableAd.onCTAClick", "install", "gameReady". */
  api: string;
  detail?: string;
}

/** Frame rate of the playable on the source device over roughly one second. */
export interface PerfSample {
  /** Ms since the playable page started; the window this sample closes. */
  at: number;
  /** Ms since `load`, 0 while still loading. */
  rt: number;
  fps: number;
  /** Longest single frame in the window, ms. */
  worstFrameMs: number;
}

export type ClientRole = "mobile" | "console" | "runner";
export type SessionMode = "live" | "replay";
export type FitMode = "stretch" | "contain";

export type AbortCode =
  | "ORIENTATION_CHANGED"
  | "SOURCE_DISCONNECTED"
  | "USER_ABORT"
  | "CHAIN_VIOLATION";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewportSnapshot {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  orientation: Orientation;
  contentRect: Rect;
  fit: FitMode;
}

export interface PlayableRef {
  id: string;
  engine: EngineKind;
  name: string;
  url: string;
  designWidth?: number;
  designHeight?: number;
}

export interface DeviceProfile {
  id: string;
  name: string;
  group: DeviceGroup;
  os: "ios" | "android";
  width: number;
  height: number;
  dpr: number;
}

export interface TestStep {
  id: string;
  label: string;
  group: DeviceGroup;
  orientation: Orientation;
  deviceIds: string[];
  mode: SessionMode;
}

export interface TestChain {
  id: string;
  name: string;
  steps: TestStep[];
}

export interface SessionAbort {
  code: AbortCode;
  reason: string;
  at: number;
}

export interface SessionTrace {
  version: typeof PROTOCOL_VERSION;
  sessionId: string;
  chainId?: string;
  stepId?: string;
  playable: PlayableRef;
  orientationLock: Orientation;
  sourceViewport: ViewportSnapshot;
  startedAt: number;
  endedAt?: number;
  /** Screens the operator mirrored while recording; the replay checks the same ones. */
  deviceIds?: string[];
  /** Who recorded it: the name the operator gave the console. */
  by?: string;
  /** Seed every instance of the playable gets for Math.random in this session. */
  seed?: number;
  events: PointerSample[];
  adEvents?: AdEvent[];
  /** Frame rate on the source device, from page start to the end of the session. */
  perf?: PerfSample[];
  abort?: SessionAbort;
}

export interface PairingPayload {
  v: typeof PROTOCOL_VERSION;
  hubHttpUrl: string;
  hubWsUrl: string;
  sessionId: string;
  playUrl: string;
  orientationLock: Orientation;
  engine: EngineKind;
}

export type HubInbound =
  | {
      type: "hello";
      role: ClientRole;
      sessionId?: string;
    }
  | {
      type: "input";
      sessionId: string;
      event: PointerSample;
      viewport: ViewportSnapshot;
    }
  | {
      type: "orientation";
      sessionId: string;
      cssWidth: number;
      cssHeight: number;
    }
  | {
      type: "ad_event";
      sessionId: string;
      event: AdEvent;
    }
  | {
      type: "perf";
      sessionId: string;
      sample: PerfSample;
    }
  | {
      /** The phone began loading the playable: mirrors start loading with it. */
      type: "source_started";
      sessionId: string;
      cssWidth: number;
      cssHeight: number;
    }
  | {
      /** The playable finished loading on the phone: the recording starts here. */
      type: "source_loaded";
      sessionId: string;
      cssWidth: number;
      cssHeight: number;
    }
  | {
      type: "end_session";
      sessionId: string;
    };

export type HubOutbound =
  | { type: "hello_ok"; clientId: string }
  | { type: "session_started"; sessionId: string; orientationLock: Orientation }
  | { type: "input"; sessionId: string; event: PointerSample }
  | { type: "ad_event"; sessionId: string; event: AdEvent }
  | { type: "source_started"; sessionId: string; cssWidth: number; cssHeight: number }
  | { type: "source_loaded"; sessionId: string; cssWidth: number; cssHeight: number }
  /** The phone opened the session page; it may not have tapped Start yet. */
  | { type: "source_connected"; sessionId: string }
  /** The phone's connection dropped; after `graceMs` without it the session aborts (0: nothing to abort yet). */
  | { type: "source_lost"; sessionId: string; graceMs: number }
  | { type: "perf"; sessionId: string; sample: PerfSample }
  /** The next recording (the other orientation) is ready: the phone opens `path` on its own. */
  | { type: "source_next"; sessionId: string; nextSessionId: string; path: string; orientationLock: Orientation }
  | { type: "session_aborted"; sessionId: string; abort: SessionAbort }
  | { type: "session_ended"; sessionId: string; trace: SessionTrace }
  | { type: "error"; message: string };

export const fullContentRect = (w: number, h: number): Rect => ({
  x: 0,
  y: 0,
  w,
  h,
});
