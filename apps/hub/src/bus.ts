import type { IncomingMessage } from "node:http";
import type {
  AbortCode,
  AdEvent,
  ClientRole,
  HubInbound,
  HubOutbound,
  Orientation,
  PlayableRef,
  PointerSample,
  SessionTrace,
  ViewportSnapshot,
} from "@playable-lab/protocol";
import { fullContentRect } from "@playable-lab/protocol";
import { evaluateSessionOrientation } from "@playable-lab/orientation-guard";
import { SessionRecorder } from "@playable-lab/recorder";
import { WebSocket, WebSocketServer } from "ws";

interface Client {
  id: string;
  role: ClientRole;
  socket: WebSocket;
  sessionId?: string;
}

/** How long a phone may be gone (screen dim, Wi-Fi blip) before the session aborts. */
const SOURCE_GRACE_MS = 8000;

export interface LiveSession {
  id: string;
  playable: PlayableRef;
  orientationLock: Orientation;
  chainId?: string;
  stepId?: string;
  recorder: SessionRecorder;
  seed: number;
  sourceSeen: boolean;
  goneTimer?: ReturnType<typeof setTimeout>;
}

const send = (socket: WebSocket, message: HubOutbound): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

export class HubBus {
  private readonly _clients = new Map<string, Client>();
  private readonly _sessions = new Map<string, LiveSession>();
  private _seq = 0;

  public constructor(
    private readonly _wss: WebSocketServer,
    private readonly _onTrace: (trace: SessionTrace) => Promise<void>
  ) {
    this._wss.on("connection", (socket, request) => {
      this._bindSocket(socket, request);
    });
  }

  public get sessions(): Map<string, LiveSession> {
    return this._sessions;
  }

  public createSession(params: {
    playable: PlayableRef;
    orientationLock: Orientation;
    chainId?: string;
    stepId?: string;
    deviceIds?: string[];
    by?: string;
  }): LiveSession {
    const id = `ses_${Date.now().toString(36)}_${this._seq}`;
    this._seq += 1;
    const viewport: ViewportSnapshot = {
      cssWidth: 390,
      cssHeight: 844,
      dpr: 3,
      orientation: params.orientationLock,
      fit: "stretch",
      contentRect: fullContentRect(390, 844),
    };
    // Keep only the reference: the hub's playable entry also carries the full HTML.
    const playable: PlayableRef = {
      id: params.playable.id,
      engine: params.playable.engine,
      name: params.playable.name,
      url: params.playable.url,
      designWidth: params.playable.designWidth,
      designHeight: params.playable.designHeight,
    };
    const seed = Math.floor(Math.random() * 0xffffffff);
    const session: LiveSession = {
      id,
      seed,
      playable,
      orientationLock: params.orientationLock,
      chainId: params.chainId,
      stepId: params.stepId,
      sourceSeen: false,
      recorder: new SessionRecorder({
        sessionId: id,
        playable,
        orientationLock: params.orientationLock,
        sourceViewport: viewport,
        chainId: params.chainId,
        stepId: params.stepId,
        seed,
        deviceIds: params.deviceIds,
        by: params.by,
      }),
    };
    this._sessions.set(id, session);
    this._broadcast({
      type: "session_started",
      sessionId: id,
      orientationLock: params.orientationLock,
    });
    return session;
  }

  public getSession(id: string): LiveSession | undefined {
    return this._sessions.get(id);
  }

  public async abort(
    sessionId: string,
    reason: string,
    code: AbortCode
  ): Promise<SessionTrace | null> {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return null;
    }
    clearTimeout(session.goneTimer);
    const abort = {
      code,
      reason,
      at: Date.now() - session.recorder.trace.startedAt,
    };
    const trace = session.recorder.abort(abort);
    this._broadcast({ type: "session_aborted", sessionId, abort });
    // A session no phone ever joined has nothing worth keeping.
    if (session.sourceSeen) {
      await this._onTrace(trace);
    }
    this._sessions.delete(sessionId);
    return trace;
  }

  public async end(sessionId: string): Promise<SessionTrace | null> {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return null;
    }
    clearTimeout(session.goneTimer);
    const trace = session.recorder.finish();
    this._broadcast({ type: "session_ended", sessionId, trace });
    await this._onTrace(trace);
    this._sessions.delete(sessionId);
    return trace;
  }

  private _bindSocket(socket: WebSocket, _request: IncomingMessage): void {
    const clientId = `c_${Date.now().toString(36)}_${this._seq}`;
    this._seq += 1;
    const client: Client = { id: clientId, role: "console", socket };
    this._clients.set(clientId, client);
    send(socket, { type: "hello_ok", clientId });

    socket.on("message", (raw) => {
      this._onMessage(client, raw.toString());
    });
    socket.on("close", () => {
      this._clients.delete(clientId);
      this._onSourceGone(client);
    });
  }

  private _onMessage(client: Client, raw: string): void {
    let message: HubInbound;
    try {
      message = JSON.parse(raw) as HubInbound;
    } catch {
      send(client.socket, { type: "error", message: "Invalid JSON" });
      return;
    }
    if (message.type === "hello") {
      client.role = message.role;
      client.sessionId = message.sessionId;
      if (message.role === "mobile" && message.sessionId) {
        const session = this._sessions.get(message.sessionId);
        if (session?.goneTimer) {
          clearTimeout(session.goneTimer);
          session.goneTimer = undefined;
        }
        if (session) {
          this._broadcast({ type: "source_connected", sessionId: session.id });
        }
      }
      return;
    }
    if (message.type === "source_started") {
      const started = this._sessions.get(message.sessionId);
      if (client.role !== "mobile" || !started) {
        return;
      }
      started.sourceSeen = true;
      console.log(`[hub] source started ${message.cssWidth}x${message.cssHeight}, mirrors start`);
      this._broadcast({
        type: "source_started",
        sessionId: message.sessionId,
        cssWidth: message.cssWidth,
        cssHeight: message.cssHeight,
      });
      return;
    }
    if (message.type === "source_loaded") {
      if (client.role !== "mobile") {
        return;
      }
      const session = this._sessions.get(message.sessionId);
      if (!session) {
        return;
      }
      session.recorder.restart();
      console.log(`[hub] source loaded ${message.cssWidth}x${message.cssHeight}`);
      this._broadcast({
        type: "source_loaded",
        sessionId: message.sessionId,
        cssWidth: message.cssWidth,
        cssHeight: message.cssHeight,
      });
      return;
    }
    if (message.type === "perf") {
      if (client.role !== "mobile") {
        return;
      }
      const session = this._sessions.get(message.sessionId);
      if (!session) {
        return;
      }
      session.sourceSeen = true;
      session.recorder.recordPerf(message.sample);
      this._broadcast({ type: "perf", sessionId: message.sessionId, sample: message.sample });
      return;
    }
    if (message.type === "ad_event") {
      if (client.role !== "mobile") {
        return;
      }
      this._onAdEvent(message.sessionId, message.event);
      return;
    }
    if (message.type === "input") {
      if (client.role !== "mobile") {
        return;
      }
      this._onInput(message.sessionId, message.event, message.viewport);
      return;
    }
    if (message.type === "orientation") {
      if (client.role !== "mobile") {
        return;
      }
      this._onOrientation(message.sessionId, message.cssWidth, message.cssHeight);
      return;
    }
    if (message.type === "end_session") {
      void this.end(message.sessionId);
    }
  }

  private _onInput(
    sessionId: string,
    event: PointerSample,
    viewport: ViewportSnapshot
  ): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.sourceSeen = true;
    const verdict = evaluateSessionOrientation(
      session.orientationLock,
      viewport.cssWidth,
      viewport.cssHeight,
      session.recorder.seenOrientation
    );
    if (!verdict.ok) {
      void this.abort(sessionId, verdict.reason, verdict.code);
      return;
    }
    session.recorder.record(event, viewport);
    if (event.phase !== "move") {
      console.log(
        `[hub] ${event.type || "pointer"} ${event.phase} ${event.nx.toFixed(3)},${event.ny.toFixed(3)}`
      );
    }
    this._broadcast({ type: "input", sessionId, event });
  }

  private _onAdEvent(sessionId: string, event: AdEvent): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.recorder.recordAdEvent(event);
    console.log(`[hub] ad ${event.kind} ${event.api}${event.detail ? ` ${event.detail}` : ""}`);
    this._broadcast({ type: "ad_event", sessionId, event });
  }

  private _onOrientation(
    sessionId: string,
    cssWidth: number,
    cssHeight: number
  ): void {
    const session = this._sessions.get(sessionId);
    // Before Start the phone is still being turned the right way: only a turn
    // in the middle of playing spoils the recording.
    if (!session || !session.sourceSeen) {
      return;
    }
    const verdict = evaluateSessionOrientation(
      session.orientationLock,
      cssWidth,
      cssHeight,
      session.recorder.seenOrientation
    );
    if (!verdict.ok) {
      void this.abort(sessionId, verdict.reason, verdict.code);
    }
  }

  /**
   * The phone that played `previousId` moves on to the next recording by
   * itself (the other orientation), without scanning a new code.
   */
  public announceNext(previousId: string, nextId: string, path: string, orientationLock: Orientation): void {
    this._broadcast({ type: "source_next", sessionId: previousId, nextSessionId: nextId, path, orientationLock });
  }

  private _onSourceGone(client: Client): void {
    if (client.role !== "mobile") {
      return;
    }
    // Only the session this phone was driving, and only if it does not come back.
    const session = client.sessionId ? this._sessions.get(client.sessionId) : undefined;
    if (!session || session.recorder.trace.endedAt) {
      return;
    }
    // A reload opens the new socket before the old one closes: the phone is still there.
    let others = false;
    this._clients.forEach((other) => {
      if (other.role === "mobile" && other.sessionId === session.id) {
        others = true;
      }
    });
    if (others) {
      return;
    }
    this._broadcast({
      type: "source_lost",
      sessionId: session.id,
      graceMs: session.sourceSeen ? SOURCE_GRACE_MS : 0,
    });
    if (!session.sourceSeen) {
      return;
    }
    clearTimeout(session.goneTimer);
    session.goneTimer = setTimeout(() => {
      void this.abort(
        session.id,
        "Mobile source disconnected in the middle of a session. Replay this step.",
        "SOURCE_DISCONNECTED"
      );
    }, SOURCE_GRACE_MS);
  }

  private _broadcast(message: HubOutbound): void {
    this._clients.forEach((client) => {
      send(client.socket, message);
    });
  }
}
