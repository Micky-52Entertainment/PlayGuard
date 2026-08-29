export const PROTOCOL_VERSION = 1 as const;

export type EngineKind = "luna" | "cocos" | "vanilla";
export type Orientation = "portrait" | "landscape";
export type DeviceGroup = "android" | "ios" | "tablet";
export type PointerKind = "touch" | "mouse" | "pen";
export type PointerPhase = "down" | "move" | "up" | "cancel" | "wheel" | "key";
export type InputType = "pointer" | "wheel" | "key" | "gesture";

export interface PointerContact {
  pointerId: number;
  nx: number;
  ny: number;
  pressure: number;
}

export interface PointerSample {
  t: number;
  kind: PointerKind;
  phase: PointerPhase;
  pointerId: number;
  nx: number;
  ny: number;
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

export interface PointerSample {
  t: number;
  kind: PointerKind;
  phase: PointerPhase;
  pointerId: number;
  nx: number;
  ny: number;
  pressure: number;
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
  events: PointerSample[];
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
      type: "end_session";
      sessionId: string;
    };

export type HubOutbound =
  | { type: "hello_ok"; clientId: string }
  | { type: "session_started"; sessionId: string; orientationLock: Orientation }
  | { type: "input"; sessionId: string; event: PointerSample }
  | { type: "session_aborted"; sessionId: string; abort: SessionAbort }
  | { type: "session_ended"; sessionId: string; trace: SessionTrace }
  | { type: "error"; message: string };

export const fullContentRect = (w: number, h: number): Rect => ({
  x: 0,
  y: 0,
  w,
  h,
});
