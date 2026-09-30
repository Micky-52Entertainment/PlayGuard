import { PROTOCOL_VERSION } from "@playable-lab/protocol";
import type {
  AdEvent,
  Orientation,
  PerfSample,
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
    seed?: number;
    deviceIds?: string[];
    by?: string;
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
      seed: params.seed,
      deviceIds: params.deviceIds,
      by: params.by,
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

  /** The source reloaded the playable: input recorded so far belongs to a run that no longer exists. */
  public restart(): void {
    if (this._trace.abort || this._trace.endedAt) {
      return;
    }
    this._trace.events = [];
    this._trace.adEvents = undefined;
    this._trace.startedAt = Date.now();
  }

  public recordPerf(sample: PerfSample): void {
    if (this._trace.abort || this._trace.endedAt) {
      return;
    }
    const perf = this._trace.perf || [];
    // The page clock went backwards: the phone reloaded, a new run begins.
    if (perf.length > 0 && sample.at < perf[perf.length - 1].at) {
      perf.length = 0;
    }
    perf.push(sample);
    this._trace.perf = perf;
  }

  public recordAdEvent(event: AdEvent): void {
    if (this._trace.abort || this._trace.endedAt) {
      return;
    }
    if (!this._trace.adEvents) {
      this._trace.adEvents = [];
    }
    this._trace.adEvents.push(event);
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
