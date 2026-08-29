import { useEffect, useMemo, useRef, useState } from "react";
import { DEVICE_CATALOG } from "@playable-lab/device-catalog";
import { deviceCssSize } from "@playable-lab/input-mapper";
import type {
  DeviceProfile,
  HubOutbound,
  Orientation,
  PlayableRef,
  TestChain,
  TestStep,
} from "@playable-lab/protocol";
import { defaultTestChain } from "@playable-lab/test-chain";

interface Meta {
  hubHttpUrl: string;
  hubWsUrl: string;
}

interface CreatedSession {
  sessionId: string;
  playUrl: string;
  qrDataUrl: string;
  orientationLock: Orientation;
}

const json = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

export const App = () => {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [devices, setDevices] = useState<DeviceProfile[]>(DEVICE_CATALOG);
  const [chain, setChain] = useState<TestChain>(defaultTestChain());
  const [playables, setPlayables] = useState<PlayableRef[]>([]);
  const [playableId, setPlayableId] = useState("sample-tap");
  const [stepId, setStepId] = useState(defaultTestChain().steps[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    defaultTestChain().steps[0].deviceIds
  );
  const [session, setSession] = useState<CreatedSession | null>(null);
  const [abortReason, setAbortReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.28);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const overlayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const countRef = useRef<HTMLSpanElement | null>(null);
  const eventCount = useRef(0);

  const step: TestStep | null = useMemo(() => {
    return chain.steps.find((item) => item.id === stepId) || chain.steps[0] || null;
  }, [chain, stepId]);

  const orientation: Orientation = session?.orientationLock || step?.orientation || "portrait";

  useEffect(() => {
    void (async () => {
      try {
        const [metaRes, deviceRes, chainRes, playableRes] = await Promise.all([
          json<Meta>("/api/meta"),
          json<DeviceProfile[]>("/api/devices"),
          json<TestChain[]>("/api/chains"),
          json<PlayableRef[]>("/api/playables"),
        ]);
        setMeta(metaRes);
        setDevices(deviceRes);
        setChain(chainRes[0] || defaultTestChain());
        setPlayables(playableRes);
        if (playableRes[0]) {
          setPlayableId(playableRes[0].id);
        }
        const first = chainRes[0]?.steps[0];
        if (first) {
          setStepId(first.id);
          setSelectedIds(first.deviceIds);
        }
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message}. Start the hub: npm run hub`
            : "Hub is not reachable"
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!step) {
      return;
    }
    setSelectedIds(step.deviceIds);
    setAbortReason(null);
  }, [step?.id]);

  useEffect(() => {
    if (!meta) {
      return;
    }
    const socket = new WebSocket(
      location.port === "5173" ? `ws://${location.hostname}:8787/ws` : meta.hubWsUrl
    );
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "hello", role: "console" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as HubOutbound;
      if (message.type === "session_aborted") {
        setAbortReason(message.abort.reason);
      }
      if (message.type === "input") {
        eventCount.current += 1;
        if (countRef.current) {
          countRef.current.textContent = String(eventCount.current);
        }
        const list =
          message.event.pointers && message.event.pointers.length > 0
            ? message.event.pointers
            : message.event.type === "key" || message.event.type === "wheel" || message.event.type === "gesture"
              ? []
              : [{ pointerId: message.event.pointerId, nx: message.event.nx, ny: message.event.ny }];
        const html = list
          .map(
            (contact) =>
              `<div class="tap-dot" style="left:${contact.nx * 100}%;top:${contact.ny * 100}%"></div>`
          )
          .join("");
        Object.keys(overlayRefs.current).forEach((id) => {
          const overlay = overlayRefs.current[id];
          if (overlay) {
            overlay.innerHTML = html;
          }
        });
      }
    });
    return () => socket.close();
  }, [meta]);

  const selectedDevices = devices.filter((device) => selectedIds.includes(device.id));

  const startSession = async () => {
    if (!step) {
      return;
    }
    setAbortReason(null);
    try {
      const created = await json<CreatedSession>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playableId,
          orientationLock: step.orientation,
          chainId: chain.id,
          stepId: step.id,
        }),
      });
      setSession(created);
      eventCount.current = 0;
      if (countRef.current) {
        countRef.current.textContent = "0";
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start session");
    }
  };

  const endSession = async () => {
    if (!session) {
      return;
    }
    try {
      await json(`/api/sessions/${session.sessionId}/end`, { method: "POST" });
    } catch {
      // Keep the local session closed even if the hub already dropped it.
    }
    setSession(null);
  };

  const uploadPlayable = async (file: File) => {
    const html = await file.text();
    const created = await json<PlayableRef>("/api/playables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, html }),
    });
    setPlayables((prev) => [...prev, created]);
    setPlayableId(created.id);
  };

  const toggleDevice = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="lab">
      <aside className="panel">
        <h1>Playable Lab</h1>
        <p className="muted">QR · Mirror · Replay</p>

        <span className="label">Playable</span>
        <select value={playableId} onChange={(event) => setPlayableId(event.target.value)}>
          {playables.map((playable) => (
            <option key={playable.id} value={playable.id}>
              {playable.name} ({playable.engine})
            </option>
          ))}
        </select>
        <input
          type="file"
          accept=".html,text/html"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadPlayable(file);
            }
          }}
        />

        <span className="label">Test chain</span>
        {chain.steps.map((item) => (
          <div
            key={item.id}
            className={`step ${item.id === step?.id ? "active" : ""}`}
            onClick={() => setStepId(item.id)}
          >
            {item.label}
          </div>
        ))}

        <span className="label">Devices for this step</span>
        {devices
          .filter((device) => device.group === step?.group)
          .map((device) => (
            <label key={device.id} className="device-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(device.id)}
                onChange={() => toggleDevice(device.id)}
              />
              {device.name}
            </label>
          ))}

        <span className="label">Zoom {Math.round(zoom * 100)}%</span>
        <input
          type="range"
          min="0.12"
          max="0.7"
          step="0.01"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
      </aside>

      <main className="stage">
        <div className="stage-bar">
          {error && <div className="abort">{error}</div>}
          {!session && (
            <p className="muted">
              Press Start session / QR, then play on the phone. Tap, swipe, pinch and drag are mirrored.
            </p>
          )}
          {session && (
            <p className="muted">
              Phone events: <span ref={countRef}>0</span>
            </p>
          )}
        </div>
        <div className="devices">
        {selectedDevices.length === 0 && (
          <p className="muted">Select at least one device in the left list.</p>
        )}
        {selectedDevices.map((device) => {
          const size = deviceCssSize(device, orientation);
          return (
            <div className="phone" key={device.id}>
              <span>
                {device.name} · {size.cssWidth}×{size.cssHeight}
              </span>
              <div
                className="frame"
                style={{ width: size.cssWidth * zoom, height: size.cssHeight * zoom }}
              >
                {session ? (
                  <>
                    <iframe
                      title={device.name}
                      ref={(el) => {
                        iframeRefs.current[device.id] = el;
                      }}
                      src={`/view/${session.sessionId}?role=slave`}
                      style={{
                        width: size.cssWidth,
                        height: size.cssHeight,
                        transform: `scale(${zoom})`,
                      }}
                    />
                    <div
                      className="overlay"
                      ref={(el) => {
                        overlayRefs.current[device.id] = el;
                      }}
                    />
                  </>
                ) : (
                  <div className="placeholder">Waiting for session</div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </main>

      <aside className="panel right">
        <span className="label">Orientation lock</span>
        <p>{orientation}</p>
        <p className="muted">Portrait and landscape are separate sessions.</p>

        <button className="primary" onClick={() => void startSession()} disabled={!step}>
          Start session / QR
        </button>
        <button onClick={() => void endSession()} disabled={!session}>
          Save trace & end
        </button>
        <button
          className="danger"
          disabled={!session}
          onClick={() => {
            if (!session) {
              return;
            }
            void json(`/api/sessions/${session.sessionId}/abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "Aborted by operator" }),
            });
          }}
        >
          Abort
        </button>

        {session && (
          <>
            <span className="label">Scan on the phone</span>
            <img className="qr" src={session.qrDataUrl} alt="Session QR" />
            <p className="muted">{session.playUrl}</p>
          </>
        )}

        {abortReason && <div className="abort">{abortReason}</div>}
      </aside>
    </div>
  );
};
