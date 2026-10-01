import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckResult } from "@playable-lab/checks";
import { DEVICE_CATALOG, FORMAT_SET, formatLabel } from "@playable-lab/device-catalog";
import { deviceCssSize } from "@playable-lab/input-mapper";
import type {
  AdEvent,
  DeviceProfile,
  HubOutbound,
  Orientation,
  PerfSample,
  PlayableRef,
  SessionTrace,
  TestChain,
  TestStep,
} from "@playable-lab/protocol";
import { defaultTestChain } from "@playable-lab/test-chain";
import { api, postJson } from "./api";
import type { SimulatorState } from "./api";
import { ProblemBox, explainError } from "./errors";
import type { Problem } from "./errors";
import { Hint } from "./Hint";
import { checkTitle, useI18n } from "./i18n";
import { mascotSay } from "./mascotBus";
import { getName } from "./identity";
import type { Key } from "./i18n";
import { VERDICT_GLYPH, batchOfPlayable } from "./library";
import type { LibraryState } from "./library";
import { Timeline, clock } from "./Timeline";

/** What the wizard asks this view to do. */
export interface RecordRequest {
  playableId: string;
  nonce: number;
  /** Chain step to record on; it fixes the orientation. */
  stepId?: string;
  /** Start the session right away instead of waiting for the button. */
  autoStart?: boolean;
  /** Play in a window on this computer instead of on the phone. */
  onComputer?: boolean;
  /** The session just recorded: its phone (or window) moves on to this one by itself. */
  after?: string;
  /** Shown above the code: which pass of how many this is. */
  pass?: { index: number; total: number };
}

interface RecordViewProps {
  library: LibraryState;
  onOpenReport: (dir: string) => void;
  /** A build from an uploaded archive to open here. */
  request: RecordRequest | null;
  /** Networks that have a build in the uploaded archives; the picker offers these, not the whole catalogue. */
  uploadedNetworks: string[];
  /** Replay a saved recording on every build of the archive this one came from. */
  onReplayOnBatch: (batchId: string, traceId: string) => void;
  /** A recording was saved. `usable` is false when it has no input to replay. */
  onSaved?: (traceId: string, networkId: string | undefined, usable: boolean) => void;
  /** A session started or stopped being live. */
  onLiveChange?: (live: boolean) => void;
  /** Whether this computer can stand in for an iPhone with Xcode's simulator. */
  simulator?: SimulatorState;
}

interface Meta {
  hubHttpUrl: string;
  hubWsUrl: string;
  /** False when this computer has no address a phone could reach. */
  lan?: boolean;
}

interface NetworkOption {
  id: string;
  name: string;
}

interface FileChecks {
  network: NetworkOption | null;
  status: "pass" | "warn" | "fail";
  checks: CheckResult[];
}

interface CreatedSession {
  sessionId: string;
  playUrl: string;
  qrDataUrl: string;
  orientationLock: Orientation;
}

type Phase = "idle" | "waiting" | "recording" | "saved" | "aborted";
type InspectorTab = "session" | "checks";

const STATUS_GLYPH: Record<CheckResult["status"], string> = {
  pass: "✓",
  warn: "!",
  fail: "✕",
  info: "i",
  skip: "–",
};

/** How the phone's connection looks from here. */
type Link = "none" | "opened" | "lost";

/** How long to wait for the phone before the "cannot connect?" checklist opens. */
const SLOW_PHONE_MS = 20000;

export const RecordView = ({
  library,
  onOpenReport,
  request,
  uploadedNetworks,
  onReplayOnBatch,
  onSaved,
  onLiveChange,
  simulator,
}: RecordViewProps) => {
  const { t, lang } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [devices, setDevices] = useState<DeviceProfile[]>(DEVICE_CATALOG);
  const [chain, setChain] = useState<TestChain>(defaultTestChain());
  const [playables, setPlayables] = useState<PlayableRef[]>([]);
  const [playableId, setPlayableId] = useState("sample-tap");
  const [stepId, setStepId] = useState(defaultTestChain().steps[0].id);
  // One screen per shape by default: that is where layouts actually differ.
  const [selectedIds, setSelectedIds] = useState<string[]>(FORMAT_SET);
  const [allScreens, setAllScreens] = useState(false);
  // How touches reach other shapes: through the engine's scene, or by screen fraction.
  const [mapping, setMapping] = useState<"scene" | "fraction" | null>(null);
  const [session, setSession] = useState<CreatedSession | null>(null);
  const [abort, setAbort] = useState<{ code: string; reason: string } | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [link, setLink] = useState<Link>("none");
  const [slow, setSlow] = useState(false);
  const [onComputer, setOnComputer] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // The iPhone simulator: "ask" explains what has to be installed before anything is opened.
  const [sim, setSim] = useState<{ state: "idle" | "ask" | "sent" | "opening" | "opened"; name?: string }>({
    state: "idle",
  });
  const handledRequest = useRef(0);
  const [zoom, setZoom] = useState(0.3);
  // The screens fit the stage by themselves until the zoom is set by hand.
  const [autoZoom, setAutoZoom] = useState(true);
  const mirrorsRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const [networks, setNetworks] = useState<NetworkOption[]>([]);
  const [networkId, setNetworkId] = useState("");
  const [fileChecks, setFileChecks] = useState<FileChecks | null>(null);
  const [ctaCalls, setCtaCalls] = useState<AdEvent[]>([]);
  const [taps, setTaps] = useState<number[]>([]);
  const [savedTraceId, setSavedTraceId] = useState<string | null>(null);
  const [perf, setPerf] = useState<PerfSample[]>([]);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [tab, setTab] = useState<InspectorTab>("checks");
  const [copied, setCopied] = useState(false);
  const overlayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInput = useRef<HTMLInputElement | null>(null);
  // The socket outlives renders; it needs the session that is current now.
  const sessionIdRef = useRef<string | null>(null);

  const step: TestStep | null = useMemo(() => {
    return chain.steps.find((item) => item.id === stepId) || chain.steps[0] || null;
  }, [chain, stepId]);

  const orientation: Orientation = session?.orientationLock || step?.orientation || "portrait";

  const phase: Phase = abort
    ? "aborted"
    : session
      ? sourceSize || perf.length > 0
        ? "recording"
        : "waiting"
      : savedTraceId
        ? "saved"
        : "idle";
  const live = phase === "waiting" || phase === "recording";

  useEffect(() => {
    onLiveChange?.(live);
  }, [live]);

  // A phone that has not shown up for a while most likely cannot reach this computer.
  useEffect(() => {
    setSlow(false);
    if (phase !== "waiting" || link !== "none") {
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_PHONE_MS);
    return () => clearTimeout(timer);
  }, [phase, link, session?.sessionId]);

  useEffect(() => {
    void (async () => {
      try {
        const [metaRes, deviceRes, chainRes, playableRes, networkRes] = await Promise.all([
          api<Meta>("/api/meta"),
          api<DeviceProfile[]>("/api/devices"),
          api<TestChain[]>("/api/chains"),
          api<PlayableRef[]>("/api/playables"),
          api<NetworkOption[]>("/api/networks"),
        ]);
        setMeta(metaRes);
        setNetworks(networkRes);
        setDevices(deviceRes);
        setChain(chainRes[0] || defaultTestChain());
        setPlayables(playableRes);
        if (playableRes[0]) {
          // Keep what the wizard already picked; fall back to the first one only when it is gone.
          setPlayableId((current) => (playableRes.some((item) => item.id === current) ? current : playableRes[0].id));
        }
        const first = chainRes[0]?.steps[0];
        if (first) {
          setStepId(first.id);
        }
        setError(null);
      } catch (err) {
        setError(explainError(t, err));
      }
    })();
  }, []);

  // Builds uploaded after this view loaded are not in the list yet.
  useEffect(() => {
    if (!request || !meta || handledRequest.current === request.nonce) {
      return;
    }
    handledRequest.current = request.nonce;
    void api<PlayableRef[]>("/api/playables").then(
      (list) => {
        setPlayables(list);
        if (!list.some((item) => item.id === request.playableId)) {
          return;
        }
        setPlayableId(request.playableId);
        const wanted = chain.steps.find((item) => item.id === request.stepId) || step;
        if (wanted) {
          setStepId(wanted.id);
        }
        if (request.autoStart && wanted && !sessionIdRef.current) {
          void startSession({ playableId: request.playableId, step: wanted, onComputer: Boolean(request.onComputer), after: request.after });
        }
      },
      () => undefined
    );
  }, [request?.nonce, meta]);

  useEffect(() => {
    let stale = false;
    setFileChecks(null);
    void api<FileChecks>(
      `/api/playables/${encodeURIComponent(playableId)}/checks${networkId ? `?network=${networkId}` : ""}`
    ).then(
      (result) => {
        if (!stale) {
          setFileChecks(result);
        }
      },
      () => {
        // The hub is down or the playable is gone; the banner already says so.
      }
    );
    return () => {
      stale = true;
    };
  }, [playableId, networkId, playables.length]);

  useEffect(() => {
    if (!meta) {
      return;
    }
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "hello", role: "console" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as HubOutbound;
      if (!("sessionId" in message) || message.sessionId !== sessionIdRef.current) {
        return;
      }
      if (message.type === "session_aborted") {
        setAbort({ code: message.abort.code, reason: message.abort.reason });
        setTab("session");
      }
      if (message.type === "source_connected") {
        setLink("opened");
      }
      if (message.type === "source_lost") {
        setLink("lost");
      }
      if (message.type === "perf") {
        const sample = message.sample;
        // The page clock went backwards: the phone reloaded, start the chart over.
        setPerf((prev) =>
          prev.length > 0 && sample.at < prev[prev.length - 1].at ? [sample] : [...prev, sample]
        );
      }
      if (message.type === "source_started") {
        setSourceSize({ width: message.cssWidth, height: message.cssHeight });
        setLink("opened");
      }
      if (message.type === "source_loaded") {
        setSourceSize({ width: message.cssWidth, height: message.cssHeight });
        setCtaCalls([]);
        setTaps([]);
      }
      if (message.type === "ad_event" && message.event.kind === "cta") {
        setCtaCalls((prev) => [...prev, message.event]);
      }
      if (message.type === "input") {
        const input = message.event;
        if (input.phase === "down" && (input.type || "pointer") === "pointer") {
          setTaps((prev) => [...prev, input.rt ?? 0]);
          setMapping(input.anchor ? "scene" : "fraction");
        }
      }
    });
    return () => socket.close();
  }, [meta]);

  // Each mirror says where the touch really landed on it (on another shape the
  // game puts the button elsewhere); the dot is drawn there, and fades on release.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; phase?: string; x?: number; y?: number } | null;
      if (!data || data.type !== "playable:touch" || typeof data.x !== "number" || typeof data.y !== "number") {
        return;
      }
      const id = Object.keys(frameRefs.current).find((key) => frameRefs.current[key]?.contentWindow === event.source);
      const overlay = id ? overlayRefs.current[id] : null;
      if (!overlay) {
        return;
      }
      const left = `${Math.min(100, Math.max(0, data.x * 100))}%`;
      const top = `${Math.min(100, Math.max(0, data.y * 100))}%`;
      let dot = overlay.querySelector<HTMLElement>(".tap-dot");
      if (data.phase === "down") {
        dot?.remove();
        dot = document.createElement("div");
        dot.className = "tap-dot";
        overlay.appendChild(dot);
        const ripple = document.createElement("div");
        ripple.className = "tap-ripple";
        ripple.style.left = left;
        ripple.style.top = top;
        overlay.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
      }
      if (!dot) {
        return;
      }
      dot.style.left = left;
      dot.style.top = top;
      if (data.phase === "up") {
        dot.classList.add("lifted");
        const lifted = dot;
        setTimeout(() => lifted.remove(), 450);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const shape = (device: DeviceProfile): number =>
    Math.max(device.width, device.height) / Math.min(device.width, device.height);
  // Narrowest first, so neighbours on the stage differ by one step of shape.
  const selectedDevices = devices
    .filter((device) => selectedIds.includes(device.id))
    .sort((a, b) => shape(b) - shape(a));
  // A phone's touch does not land on the same thing on a tablet, so tablets are
  // left out of the live copies of a phone recording. They are still checked:
  // the recording is replayed on them afterwards.
  const tabletsHidden = step?.group !== "tablet" && selectedDevices.some((device) => device.group === "tablet");
  const liveDevices = tabletsHidden ? selectedDevices.filter((device) => device.group !== "tablet") : selectedDevices;
  // A different shape means a different layout: the same relative tap can
  // land on another element there.
  const reshapedFor = (device: DeviceProfile): boolean => {
    if (!sourceSize) {
      return false;
    }
    const size = deviceCssSize(device, orientation);
    return Math.abs((size.cssWidth / size.cssHeight) / (sourceSize.width / sourceSize.height) - 1) > 0.01;
  };
  // Fit every screen on the stage at once, in as few rows as it takes, so
  // nothing needs scrolling while the phone is being played.
  useEffect(() => {
    const box = mirrorsRef.current;
    if (!box || !autoZoom) {
      return;
    }
    const fit = (): void => {
      const sizes = liveDevices.map((device) => deviceCssSize(device, orientation)).map((size) => ({ w: size.cssWidth, h: size.cssHeight }));
      if (sourceSize) {
        sizes.unshift({ w: sourceSize.width, h: sourceSize.height });
      }
      if (sizes.length === 0) {
        return;
      }
      const width = box.clientWidth - 32;
      const height = box.clientHeight - 36 - Array.from(box.querySelectorAll<HTMLElement>(".mirrors-note")).reduce((sum, note) => sum + note.offsetHeight + 20, 0);
      // The caption block and its gap (styles.css: .mirror figcaption).
      const caption = 52;
      // Lay the screens out as the stage wraps them, and measure the height it takes.
      const tallAt = (zoomLevel: number): number => {
        let rowWidth = 0;
        let rowHeight = 0;
        let total = 0;
        for (const size of sizes) {
          const w = Math.max(64, size.w * zoomLevel);
          if (rowWidth > 0 && rowWidth + 24 + w > width) {
            total += rowHeight + 20;
            rowWidth = 0;
            rowHeight = 0;
          }
          rowWidth += (rowWidth > 0 ? 24 : 0) + w;
          rowHeight = Math.max(rowHeight, size.h * zoomLevel + caption);
        }
        return total + rowHeight;
      };
      let low = 0.08;
      let high = 0.8;
      for (let step = 0; step < 20; step += 1) {
        const middle = (low + high) / 2;
        if (tallAt(middle) <= height) {
          low = middle;
        } else {
          high = middle;
        }
      }
      const best = low;
      setZoom(Math.floor(Math.min(0.8, Math.max(0.08, best)) * 100) / 100);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => watch.disconnect();
  }, [autoZoom, selectedIds.join(","), tabletsHidden, orientation, sourceSize?.width, sourceSize?.height]);

  const chipDevices = devices
    .filter((device) => allScreens || FORMAT_SET.includes(device.id) || selectedIds.includes(device.id))
    .sort((a, b) => shape(b) - shape(a));

  const openPlayWindow = (created: CreatedSession): void => {
    setBlocked(false);
    // A phone-shaped window on this computer takes the phone's place.
    const portrait = created.orientationLock === "portrait";
    const width = portrait ? 412 : 915;
    const height = portrait ? 915 : 412;
    const opened = window.open(
      `${created.playUrl}${created.playUrl.includes("?") ? "&" : "?"}pc=1`,
      "playable-lab-source",
      `popup,width=${width},height=${height}`
    );
    // Browsers block windows that do not open straight from a click.
    setBlocked(!opened);
  };

  const startSession = async (wanted?: { playableId: string; step: TestStep; onComputer: boolean; after?: string }) => {
    const target = wanted?.step || step;
    if (!target) {
      return;
    }
    try {
      const created = await postJson<CreatedSession>("/api/sessions", {
        playableId: wanted?.playableId || playableId,
        orientationLock: target.orientation,
        chainId: chain.id,
        stepId: target.id,
        deviceIds: selectedIds,
        lang,
        by: getName(),
        after: wanted?.after,
      });
      sessionIdRef.current = created.sessionId;
      setSession(created);
      setAbort(null);
      setCtaCalls([]);
      setTaps([]);
      setPerf([]);
      setSourceSize(null);
      setMapping(null);
      setSavedTraceId(null);
      setCopied(false);
      setLink("none");
      setSim({ state: "idle" });
      // "Record again" keeps the way the last recording was played.
      const pc = wanted ? wanted.onComputer : onComputer;
      setOnComputer(pc);
      setTab("session");
      setError(null);
      // After the first pass the play window follows on its own.
      if (pc && !wanted?.after) {
        openPlayWindow(created);
      }
    } catch (err) {
      setError(explainError(t, err));
    }
  };

  // Micky watches the recording: a lost phone, the store reached, a long silence.
  const [saveAnyway, setSaveAnyway] = useState(false);
  useEffect(() => {
    if (!saveAnyway) {
      return;
    }
    const reset = setTimeout(() => setSaveAnyway(false), 10000);
    return () => clearTimeout(reset);
  }, [saveAnyway]);
  const lostBefore = useRef(false);
  useEffect(() => {
    if (!session) {
      lostBefore.current = false;
      return;
    }
    if (link === "lost") {
      lostBefore.current = true;
      mascotSay({ pose: "scared", text: t("mascot.record.lost"), ms: 8000 });
    } else if (link === "opened" && lostBefore.current) {
      lostBefore.current = false;
      mascotSay({ pose: "ok", text: t("mascot.record.back"), ms: 4000 });
    }
  }, [link, session?.sessionId]);
  useEffect(() => {
    if (ctaCalls.length === 1) {
      mascotSay({ pose: "celebrate", text: t("mascot.record.cta"), ms: 6000 });
    }
  }, [ctaCalls.length]);
  useEffect(() => {
    if (phase !== "recording") {
      return;
    }
    const quiet = setTimeout(() => mascotSay({ pose: "tired", text: t("mascot.record.quiet"), ms: 9000 }), 45000);
    return () => clearTimeout(quiet);
  }, [phase, taps.length]);

  const endSession = async () => {
    if (!session) {
      return;
    }
    const usable = taps.length > 0;
    try {
      const trace = await api<SessionTrace>(`/api/sessions/${session.sessionId}/end`, {
        method: "POST",
      });
      setSavedTraceId(trace.sessionId);
      await library.refresh();
      onSaved?.(trace.sessionId, fileChecks?.network?.id, usable);
    } catch {
      // Keep the local session closed even if the hub already dropped it.
    }
    sessionIdRef.current = null;
    setSession(null);
  };

  const abortSession = () => {
    if (!session) {
      return;
    }
    void postJson(`/api/sessions/${session.sessionId}/abort`, { reason: "Aborted by operator" }).catch(() => {
      setAbort({ code: "USER_ABORT", reason: "Aborted by operator" });
    });
  };

  const uploadPlayable = async (file: File) => {
    try {
      const html = await file.text();
      const created = await postJson<PlayableRef>("/api/playables", { name: file.name, html });
      setPlayables((prev) => [...prev, created]);
      setPlayableId(created.id);
      setTab("checks");
      setError(null);
    } catch (err) {
      setError(explainError(t, err));
    }
  };

  const toggleDevice = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const replayCommand = savedTraceId
    ? `npm run replay -- --trace traces/${savedTraceId}.json${fileChecks?.network ? ` --network ${fileChecks.network.id}` : ""}`
    : "";
  const issues = fileChecks
    ? fileChecks.checks.filter((check) => check.status === "fail" || check.status === "warn").length
    : 0;
  const lastAt = perf.length > 0 ? perf[perf.length - 1].at : 0;
  const ctaApis = Array.from(new Set(ctaCalls.map((call) => call.api)));
  const saved = savedTraceId ? library.traces.find((trace) => trace.id === savedTraceId) : undefined;
  const batchId = batchOfPlayable(playableId);

  const openSimulator = async (): Promise<void> => {
    if (!session) {
      return;
    }
    if (simulator !== "ready") {
      setSim({ state: "ask" });
      return;
    }
    setSim({ state: "opening" });
    try {
      const opened = await postJson<{ device: string }>("/api/simulator/open", { sessionId: session.sessionId, lang });
      setSim({ state: "opened", name: opened.device });
    } catch (err) {
      setSim({ state: "idle" });
      setError(explainError(t, err));
    }
  };

  const openXcodeStore = (): void => {
    void postJson("/api/simulator/xcode", {}).then(
      () => setSim({ state: "sent" }),
      (err) => setError(explainError(t, err))
    );
  };

  const playHere = (): void => {
    if (session) {
      setOnComputer(true);
      openPlayWindow(session);
    }
  };

  const abortText =
    abort && (abort.code === "ORIENTATION_CHANGED" || abort.code === "SOURCE_DISCONNECTED" || abort.code === "USER_ABORT")
      ? t(`abort.${abort.code}` as Key)
      : abort?.reason || "";
  const orientationWord = t(orientation === "portrait" ? "common.portrait" : "common.landscape");

  return (
    <div className="view record">
      <header className="topbar">

        <label className="field">
          <span>{t("record.playable")}</span>
          <select
            value={playableId}
            disabled={live}
            onChange={(event) => setPlayableId(event.target.value)}
          >
            {playables.map((playable) => (
              <option key={playable.id} value={playable.id}>
                {playable.name}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" disabled={live} onClick={() => fileInput.current?.click()}>
          {t("record.upload")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".html,text/html"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadPlayable(file);
            }
            event.target.value = "";
          }}
        />

        <label className="field">
          <span>
            {t("record.network")} <Hint text={t("hint.network")} />
          </span>
          <select value={networkId} onChange={(event) => setNetworkId(event.target.value)}>
            <option value="">
              {fileChecks?.network && !networkId ? `${t("record.auto")} · ${fileChecks.network.name}` : t("record.auto")}
            </option>
            {networks
              .filter(
                (network) =>
                  uploadedNetworks.length === 0 ||
                  uploadedNetworks.includes(network.id) ||
                  network.id === networkId
              )
              .map((network) => (
              <option key={network.id} value={network.id}>
                {network.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>
            {t("record.group")} <Hint text={t("hint.group")} />
          </span>
          <select value={step?.id || ""} disabled={live} onChange={(event) => setStepId(event.target.value)}>
            {chain.steps.map((item) => (
              <option key={item.id} value={item.id}>
                {t(`step.${item.id}` as Key) || item.label}
              </option>
            ))}
          </select>
        </label>

        <span className={`status ${phase}`} role="status">
          <span className="status-dot" />
          {t(`phase.${phase}` as Key)}
          {phase === "recording" && lastAt > 0 ? ` ${clock(lastAt)}` : ""}
        </span>

        <div className="actions">
          {live ? (
            <>
              <button className="danger" onClick={abortSession}>
                {phase === "waiting" ? t("common.cancel") : t("record.abort")}
              </button>
              {phase === "recording" && (
                <button
                  className={`primary ${ctaCalls.length > 0 ? "pulse" : ""}`}
                  onClick={() => {
                    // Saving before the store opened makes a recording that cannot check the install button.
                    if (ctaCalls.length === 0 && !saveAnyway) {
                      setSaveAnyway(true);
                      mascotSay({ pose: "facepalm", text: t("mascot.record.noCta"), ms: 9000 });
                      return;
                    }
                    void endSession();
                  }}
                >
                  {saveAnyway && ctaCalls.length === 0 ? t("record.saveAnyway") : t("record.save")}
                </button>
              )}
            </>
          ) : (
            <button className="primary" onClick={() => void startSession()} disabled={!step || !meta}>
              {phase === "idle" ? t("record.start") : t("record.startAgain")}
            </button>
          )}
        </div>
      </header>

      {error && <ProblemBox problem={error} banner />}

      <div className="workspace">
        <main className="stage">
          <div className="toolbar">
            <span className="toolbar-label">
              {t("record.screens")} <Hint text={t("hint.screens")} />
            </span>
            {chipDevices.map((device) => (
              <button
                key={device.id}
                className={`chip ${selectedIds.includes(device.id) ? "on" : ""}`}
                aria-pressed={selectedIds.includes(device.id)}
                onClick={() => toggleDevice(device.id)}
              >
                <b>{formatLabel(device)}</b> {device.name}
              </button>
            ))}
            <button className="chip more" onClick={() => setAllScreens((value) => !value)}>
              {allScreens ? t("record.fewerScreens") : t("record.allScreens", { n: devices.length })}
            </button>
            <label className="zoom">
              {t("record.zoom")} {Math.round(zoom * 100)}%
              <input
                type="range"
                min="0.08"
                max="0.8"
                step="0.01"
                value={zoom}
                onChange={(event) => {
                  setAutoZoom(false);
                  setZoom(Number(event.target.value));
                }}
              />
            </label>
            <button
              className={`chip ${autoZoom ? "on" : ""}`}
              aria-pressed={autoZoom}
              title={t("record.fit.tip")}
              onClick={() => setAutoZoom(true)}
            >
              {t("record.fit")}
            </button>
          </div>

          <div className="stage-body">
          {session && request?.pass && request.pass.total > 1 && (
            <div className={`pass-banner ${session.orientationLock}`} role="status">
              <span className="pass-turn" aria-hidden="true" />
              <div>
                <b>
                  {t("record.pass", {
                    n: request.pass.index + 1,
                    total: request.pass.total,
                    orientation: t(session.orientationLock === "landscape" ? "common.landscape" : "common.portrait").toLowerCase(),
                  })}
                </b>
                {request.after && phase === "waiting" && (
                  <span>{t(onComputer ? "record.pass.nextPc" : "record.pass.next")}</span>
                )}
              </div>
            </div>
          )}
          {phase === "waiting" && session && onComputer && (
            <div className="stage-card">
              <div>
                <p className="stage-card-title">{blocked ? t("record.pc.blocked") : t("record.pc.title")}</p>
                {blocked && <p className="hint warn-text">{t("record.pc.blocked.hint")}</p>}
                <ol className="steps">
                  <li>{t("record.pc.step1")}</li>
                  <li>{t("record.pc.step2")}</li>
                  <li>{t("record.pc.step3")}</li>
                </ol>
                <button className={`wide ${blocked ? "primary" : ""}`} onClick={playHere}>
                  {blocked ? t("play.pc.go") : t("record.pc.reopen")}
                </button>
              </div>
            </div>
          )}
          {phase === "waiting" && session && !onComputer && (
            <div className="stage-card tall">
              {/* The code sits on a phone that comes alive when the real one connects. */}
              <div className={`qr-phone ${link}`}>
                <span className="qr-notch" />
                <img className="qr" src={session.qrDataUrl} alt={t("record.qrAlt")} />
                {link === "opened" && (
                  <span className="qr-connected">
                    <span className="mark pass">✓</span>
                    {t("record.qr.connected")}
                  </span>
                )}
              </div>
              <div>
                <p className="stage-card-title">{t("record.phone.title")}</p>
                <p className={`link-state ${link}`} role="status">
                  <span className="status-dot" />
                  {t(`link.${link}` as Key)}
                </p>
                {meta?.lan === false && <p className="hint warn-text">{t("record.noLan")}</p>}
                <ol className="steps">
                  <li>{t("record.phone.step1")}</li>
                  <li>{t("record.phone.step2")}</li>
                  <li>{t("record.phone.step3")}</li>
                </ol>
                <details className="trouble" open={slow}>
                  <summary>{t("trouble.title")}</summary>
                  <ul>
                    <li>{t("trouble.wifi")}</li>
                    <li>{t("trouble.vpn")}</li>
                    <li>{t("trouble.guest")}</li>
                    <li>{t("trouble.firewall")}</li>
                    <li>
                      {t("trouble.manual")} <span className="url inline-url">{session.playUrl}</span>
                    </li>
                  </ul>
                </details>
                <button className="wide" onClick={playHere}>
                  {t("record.playHere")}
                </button>
                {simulator && simulator !== "unsupported" && (
                  <div className="sim">
                    <button className="wide" disabled={sim.state === "opening"} title={t("sim.tip")} onClick={() => void openSimulator()}>
                      {t("sim.open")}
                    </button>
                    {sim.state === "idle" && orientation === "landscape" && <p className="hint">{t("sim.rotate")}</p>}
                    {sim.state === "opening" && (
                      <p className="hint running" role="status">
                        <span className="spinner" /> {t("sim.opening")}
                      </p>
                    )}
                    {sim.state === "opened" && (
                      <p className="hint" role="status">
                        {t("sim.opened", { name: sim.name || "iPhone" })}
                      </p>
                    )}
                    {sim.state === "ask" && simulator === "no-runtime" && (
                      <div className="notice">
                        <b>{t("sim.runtime.title")}</b>
                        <span>{t("sim.runtime.text")}</span>
                      </div>
                    )}
                    {sim.state === "ask" && simulator !== "no-runtime" && (
                      <div className="notice">
                        <b>{t("sim.need.title")}</b>
                        <span>{t("sim.need.text")}</span>
                        <div className="problem-actions">
                          <button className="primary" onClick={openXcodeStore}>
                            {t("sim.need.go")}
                          </button>
                          <button className="ghost" onClick={() => setSim({ state: "idle" })}>
                            {t("setup.later")}
                          </button>
                        </div>
                      </div>
                    )}
                    {sim.state === "sent" && <p className="hint">{t("sim.need.sent")}</p>}
                  </div>
                )}
              </div>
            </div>
          )}
          {phase === "recording" && (
            <div className={`stage-card slim ${link === "lost" ? "warn" : ctaCalls.length > 0 ? "good" : ""}`} role="status">
              {link === "lost" ? (
                <span>{t("record.lost")}</span>
              ) : ctaCalls.length > 0 ? (
                <span>
                  <span className="mark pass">{STATUS_GLYPH.pass}</span> {t("record.ctaSeen")}
                </span>
              ) : (
                <span>{t("record.playing")}</span>
              )}
            </div>
          )}
          {phase === "saved" && savedTraceId && (
            <div className="stage-card result">
              <div>
                <p className="stage-card-title">{t("record.saved")}</p>
                <p className="hint">
                  {t("common.touches", { n: taps.length })} ·{" "}
                  {ctaApis.length > 0 ? t("record.storeVia", { api: ctaApis.join(", ") }) : t("record.noStore")}
                  {saved?.fps ? ` · ${t("record.fpsAverage", { n: saved.fps.average.toFixed(0) })}` : ""}
                </p>
                {taps.length === 0 && <p className="hint warn-text">{t("record.noInput")}</p>}
                {taps.length > 0 && saved && !saved.usable && <p className="hint warn-text">{saved.problem}</p>}
                {saved?.job?.state === "failed" && (
                  <p className="hint warn-text" title={saved.job.error}>
                    {t("checks.didNotFinish")}
                  </p>
                )}
              </div>
              <div className="stage-card-actions">
                {saved?.job?.state === "running" ? (
                  <span className="running">
                    <span className="spinner" /> {t("record.replaying")}
                  </span>
                ) : saved?.report ? (
                  <>
                    <span className={`verdict ${saved.report.status}`}>
                      <span className={`mark ${saved.report.status}`}>{VERDICT_GLYPH[saved.report.status]}</span>
                      {t(`verdict.${saved.report.status}` as Key)}
                    </span>
                    <button className="primary" onClick={() => onOpenReport(saved.report!.dir)}>
                      {t("common.openReport")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={batchId && saved?.usable ? "" : "primary"}
                      onClick={() => void library.runChecks(savedTraceId, fileChecks?.network?.id)}
                    >
                      {batchId ? t("record.checkThis") : t("checks.run")}
                    </button>
                    {batchId && saved?.usable && (
                      <button className="primary" onClick={() => onReplayOnBatch(batchId, savedTraceId)}>
                        {t("builds.replayAll")}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="mirrors" ref={mirrorsRef}>
            {tabletsHidden && <p className="mirrors-note">{t("record.tabletsLater")}</p>}
            {session && mapping && sourceSize && liveDevices.some((device) => reshapedFor(device)) && (
              <p className="mirrors-note" title={t(mapping === "scene" ? "record.mapScene.tip" : "record.mapFraction.tip")}>
                <i className={mapping === "scene" ? "mapped" : "reshaped"}>≈</i>{" "}
                {t(mapping === "scene" ? "record.mapScene" : "record.mapFraction")}
              </p>
            )}
            {session && sourceSize && (
              <figure className="mirror source" key="source-replica" style={{ width: sourceSize.width * zoom }}>
                <figcaption>
                  <b title={t("record.replica")}>
                    {phase === "recording" && <span className="live-dot" aria-hidden="true" />}
                    {t("record.replica")}
                  </b>
                  <span>
                    {sourceSize.width}×{sourceSize.height} · {t("record.exactCopy")}
                  </span>
                </figcaption>
                <div
                  className="frame source"
                  style={{ width: sourceSize.width * zoom, height: sourceSize.height * zoom }}
                >
                  <iframe
                    title={t("record.replica")}
                    ref={(el) => {
                      frameRefs.current["source-replica"] = el;
                    }}
                    src={`/view/${session.sessionId}?role=slave&lang=${lang}`}
                    style={{
                      width: sourceSize.width,
                      height: sourceSize.height,
                      transform: `scale(${zoom})`,
                    }}
                  />
                  <div
                    className="overlay"
                    ref={(el) => {
                      overlayRefs.current["source-replica"] = el;
                    }}
                  />
                </div>
              </figure>
            )}
            {selectedDevices.length === 0 && (
              <p className="hint">{t("record.pickScreen")}</p>
            )}
            {liveDevices.map((device) => {
              const size = deviceCssSize(device, orientation);
              const reshaped = reshapedFor(device);
              return (
                <figure className="mirror" key={device.id} style={{ width: size.cssWidth * zoom }}>
                  <figcaption>
                    <b title={device.name}>{device.name}</b>
                    <span>
                      {formatLabel(device)} · {size.cssWidth}×{size.cssHeight}
                      {session && reshaped && mapping && (
                        <i
                          className={mapping === "scene" ? "mapped" : "reshaped"}
                          title={t(mapping === "scene" ? "record.mapScene.tip" : "record.mapFraction.tip")}
                        >
                          ≈
                        </i>
                      )}
                    </span>
                  </figcaption>
                  <div
                    className="frame"
                    style={{ width: size.cssWidth * zoom, height: size.cssHeight * zoom }}
                  >
                    {session ? (
                      <>
                        <iframe
                          title={device.name}
                          ref={(el) => {
                            frameRefs.current[device.id] = el;
                          }}
                          src={`/view/${session.sessionId}?role=slave&lang=${lang}`}
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
                      <div className="placeholder">
                        {phase === "saved" ? t("record.ended") : t("record.placeholder")}
                      </div>
                    )}
                  </div>
                </figure>
              );
            })}
          </div>

          </div>

          <Timeline samples={perf} taps={taps} ctas={ctaCalls} />
        </main>

        <aside className="inspector">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "session"}
              className={tab === "session" ? "on" : ""}
              onClick={() => setTab("session")}
            >
              {t("record.tab.session")}
            </button>
            <button
              role="tab"
              aria-selected={tab === "checks"}
              className={tab === "checks" ? "on" : ""}
              onClick={() => setTab("checks")}
            >
              {t("record.tab.checks")}
              {fileChecks && issues > 0 && (
                <span className={`count ${fileChecks.status}`}>{issues}</span>
              )}
            </button>
          </div>

          {tab === "session" && (
            <div className="tab-body">
              {phase === "idle" && (
                <ol className="steps">
                  <li>{t("record.how1")}</li>
                  <li>{t("record.how2")}</li>
                  <li>{t("record.how3")}</li>
                  <li>{t("record.how4")}</li>
                </ol>
              )}

              {phase === "aborted" && (
                <div className="notice danger">
                  <b>{t("record.aborted")}</b>
                  {abortText}
                </div>
              )}

              {session && phase !== "aborted" && (
                <>
                  <p className="section">{t("record.phoneLink")}</p>
                  <p className="url">{session.playUrl}</p>
                  <p className="hint">{phase === "waiting" ? t("record.linkWaiting") : t("record.linkConnected")}</p>
                </>
              )}

              {(session || phase === "saved") && phase !== "aborted" && (
                <dl className="facts">
                  <dt>{t("facts.orientation")}</dt>
                  <dd>{orientationWord}</dd>
                  <dt>{t("facts.phoneScreen")}</dt>
                  <dd>{sourceSize ? `${sourceSize.width}×${sourceSize.height}` : t("facts.waiting")}</dd>
                  <dt>{t("facts.touches")}</dt>
                  <dd>{taps.length}</dd>
                  <dt>
                    {t("facts.mapping")} <Hint text={t("hint.mapping")} />
                  </dt>
                  <dd>
                    {mapping === "scene"
                      ? t("facts.mapScene")
                      : mapping === "fraction"
                        ? t("facts.mapFraction")
                        : t("facts.mapLater")}
                  </dd>
                  <dt>
                    {t("facts.store")} <Hint text={t("hint.store")} />
                  </dt>
                  <dd>
                    {ctaApis.length > 0 ? (
                      <span className="inline">
                        <span className="mark pass">{STATUS_GLYPH.pass}</span>
                        {ctaApis.join(", ")}
                      </span>
                    ) : (
                      t("facts.notYet")
                    )}
                  </dd>
                </dl>
              )}

              {phase === "saved" && (
                <details className="trouble dev">
                  <summary>{t("record.terminal")}</summary>
                  <code className="cmd">{replayCommand}</code>
                  <button
                    className="ghost wide"
                    onClick={() => {
                      void navigator.clipboard.writeText(replayCommand).then(() => setCopied(true));
                    }}
                  >
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </details>
              )}
            </div>
          )}

          {tab === "checks" && (
            <div className="tab-body">
              <p className="section">
                {fileChecks?.network
                  ? `${t("record.against", { name: fileChecks.network.name })}${networkId ? "" : ` ${t("record.fromName")}`}`
                  : t("record.noNetwork")}
              </p>
              {!fileChecks && <p className="hint">{t("checks.checking")}</p>}
              {fileChecks &&
                fileChecks.checks.map((check) => (
                  <div className="check-row" key={check.id}>
                    <span className={`mark ${check.status}`}>{STATUS_GLYPH[check.status]}</span>
                    <div>
                      <div>{checkTitle(t, lang, check)}</div>
                      <div className="hint">{check.message}</div>
                      {check.status !== "pass" &&
                        (check.details || []).map((line) => (
                          <div className="detail" key={line}>
                            {line}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
