import { PROTOCOL_VERSION } from "@playable-lab/protocol";
import type {
  Orientation,
  PlayableRef,
  PointerSample,
  SessionAbort,
  SessionTrace,
  ViewportSnapshot,
} from "@playable-lab/protocol";

export class SessionRecorder {
  private readonly _trace: SessionTrace;
  private _seenOrientation: Orientation;

  public constructor(params: {
    sessionId: string;
    playable: PlayableRef;
    orientationLock: Orientation;
    sourceViewport: ViewportSnapshot;
    chainId?: string;
    stepId?: string;
  }) {
    this._seenOrientation = params.orientationLock;
    this._trace = {
      version: PROTOCOL_VERSION,
      sessionId: params.sessionId,
      chainId: params.chainId,
      stepId: params.stepId,
      playable: params.playable,
      orientationLock: params.orientationLock,
      sourceViewport: params.sourceViewport,
      startedAt: Date.now(),
      events: [],
    };
  }

  public get trace(): SessionTrace {
    return this._trace;
  }

  public get seenOrientation(): Orientation {
    return this._seenOrientation;
  }

  public record(event: PointerSample, viewport?: ViewportSnapshot): void {
    if (this._trace.abort || this._trace.endedAt) {
      return;
    }
    this._trace.events.push(event);
    if (viewport) {
      this._trace.sourceViewport = viewport;
      this._seenOrientation = viewport.orientation;
    }
  }

  public abort(abort: SessionAbort): SessionTrace {
    this._trace.abort = abort;
    this._trace.endedAt = Date.now();
    return this._trace;
  }

  public finish(): SessionTrace {
    if (!this._trace.endedAt) {
      this._trace.endedAt = Date.now();
    }
    return this._trace;
  }
}
