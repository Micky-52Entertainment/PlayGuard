import type { IncomingMessage } from "node:http";
import type {
  AbortCode,
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
}

export interface LiveSession {
  id: string;
  playable: PlayableRef;
  orientationLock: Orientation;
  chainId?: string;
  stepId?: string;
  recorder: SessionRecorder;
  sourceSeen: boolean;
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
    const session: LiveSession = {
      id,
      playable: params.playable,
      orientationLock: params.orientationLock,
      chainId: params.chainId,
      stepId: params.stepId,
      sourceSeen: false,
      recorder: new SessionRecorder({
        sessionId: id,
        playable: params.playable,
        orientationLock: params.orientationLock,
        sourceViewport: viewport,
        chainId: params.chainId,
        stepId: params.stepId,
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
    const abort = {
      code,
      reason,
      at: Date.now() - session.recorder.trace.startedAt,
    };
    const trace = session.recorder.abort(abort);
    this._broadcast({ type: "session_aborted", sessionId, abort });
    await this._onTrace(trace);
    this._sessions.delete(sessionId);
    return trace;
  }

  public async end(sessionId: string): Promise<SessionTrace | null> {
    const session = this._sessions.get(sessionId);
    if (!session) {
      return null;
    }
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

  private _onOrientation(
    sessionId: string,
    cssWidth: number,
    cssHeight: number
  ): void {
    const session = this._sessions.get(sessionId);
    if (!session) {
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

  private _onSourceGone(client: Client): void {
    if (client.role !== "mobile") {
      return;
    }
    this._sessions.forEach((session) => {
      if (session.sourceSeen && !session.recorder.trace.endedAt) {
        void this.abort(
          session.id,
          "Mobile source disconnected in the middle of a session. Replay this step.",
          "SOURCE_DISCONNECTED"
        );
      }
    });
  }

  private _broadcast(message: HubOutbound): void {
    this._clients.forEach((client) => {
      send(client.socket, message);
    });
  }
}
