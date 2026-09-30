import { useEffect, useMemo, useRef, useState } from "react";
import { MickeyArt } from "./MickeyArt";
import { ApiError, aiReady, api, postJson } from "./api";
import type { AiProviderId, AiSettings, Health, QuickRun } from "./api";
import { tally } from "./BuildsView";
import { ProblemBox, explainCode, explainError, explainJob } from "./errors";
import type { Problem } from "./errors";
import { Hint } from "./Hint";
import { useI18n } from "./i18n";
import { fromDrop, fromInput, prepare } from "./upload";
import type { PickedFile } from "./upload";
import type { Key } from "./i18n";
import { VERDICT_GLYPH, batchBusy, batchProgress, timeLeft } from "./library";
import type { Batch, BatchesState, LibraryState, ReportSummary, Verdict } from "./library";
import { reportKind } from "./ReportsView";
import { ShareBar } from "./ShareBar";
import { ModeIcon } from "./ModeIcon";
import { ShowMore, usePaged } from "./paging";
import { StepArt } from "./StepArt";
import { DEVICE_CATALOG, FORMAT_SET, platformOf } from "@playable-lab/device-catalog";
import { mascotSay } from "./mascotBus";
import { ResultScreens, ScreensProgress, useScrub } from "./Screens";
import type { ScreenTile } from "./Screens";

interface LinkGateResult {
  verdict: "ok" | "no-apps" | "unknown-store" | "mismatch" | "absent";
  found: Array<{ url: string; store: "ios" | "android"; id: string }>;
  expected: Record<"ios" | "android", string | null>;
  store?: "ios" | "android";
  wrongId?: string;
}
import { Confetti } from "./Confetti";
import { getName } from "./identity";

export type Mode = "phone" | "pc" | "ai" | "load";

/** One pass through the wizard: what is tested, how it is played, where the result is. */
export interface Flow {
  step: 1 | 2 | 3 | 4;
  playableId: string | null;
  name: string;
  /** Set when the playable is a build from an uploaded archive. */
  batchId: string | null;
  mode: Mode | null;
  traceId: string | null;
  runId: string | null;
  reportDir: string | null;
  /** Step 2 shows the live recording screen instead of the choice. */
  recording: boolean;
  /** Orientations to play, in order: portrait first, then landscape (those on in Settings). */
  plan: Array<"portrait" | "landscape">;
  /** Which of them is being played now. */
  pass: number;
  /** Recordings saved so far in this pass through the wizard. */
  traceIds: string[];
  /** Quick before sending, or full before a release; the setting's choice when unset. */
  depth?: "quick" | "full";
}

export const EMPTY_FLOW: Flow = {
  step: 1,
  playableId: null,
  name: "",
  batchId: null,
  mode: null,
  traceId: null,
  runId: null,
  reportDir: null,
  recording: false,
  plan: [],
  pass: 0,
  traceIds: [],
};

const FLOW_KEY = "playable-lab.flow";

/** The wizard's place survives a reload of the page; a live recording does not, so it returns to the choice. */
export const loadFlow = (): Flow => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FLOW_KEY) || "null") as Flow | null;
    if (saved && typeof saved.step === "number" && saved.step >= 1 && saved.step <= 4) {
      return { ...EMPTY_FLOW, ...saved, recording: false };
    }
  } catch {
    // Nothing saved, or storage is blocked.
  }
  return EMPTY_FLOW;
};

export const saveFlow = (flow: Flow): void => {
  try {
    sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  } catch {
    // The wizard still works; it only starts over after a reload.
  }
};

const STEPS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

/** The four steps across the top: where the operator is, and the way back to the start. */
export const Stepper = ({
  flow,
  locked,
  onRestart,
  onBack,
}: {
  flow: Flow;
  locked: boolean;
  onRestart: () => void;
  /** Leave the recording screen for the choice of who plays. */
  onBack: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="stepper">
      <ol>
        {STEPS.map((step) => (
          <li
            key={step}
            className={step === flow.step ? "on" : step < flow.step ? "done" : ""}
            aria-current={step === flow.step ? "step" : undefined}
          >
            <span className="step-num">{step < flow.step ? "✓" : step}</span>
            {t(`wizard.step${step}` as Key)}
          </li>
        ))}
      </ol>
      <div className="stepper-side">
        {flow.name && <span className="stepper-name">{flow.name}</span>}
        {flow.step === 2 && flow.recording && (
          <button className="ghost" disabled={locked} title={locked ? t("wizard.restart.locked") : undefined} onClick={onBack}>
            ← {t("wizard.back")}
          </button>
        )}
        {flow.step > 1 && (
          <button className="ghost" disabled={locked} title={locked ? t("wizard.restart.locked") : undefined} onClick={onRestart}>
            {t("wizard.restart")}
          </button>
        )}
      </div>
    </div>
  );
};

const Bar = ({ done, total }: { done: number; total: number }) => {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div
      className={`bar ${total > 0 ? "" : "unknown"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
    >
      <span style={{ width: `${share * 100}%` }} />
    </div>
  );
};

const VerdictBadge = ({ status }: { status: Verdict }) => {
  const { t } = useI18n();
  return (
    <span className={`verdict ${status}`}>
      <span className={`mark ${status}`}>{VERDICT_GLYPH[status]}</span>
      {t(`verdict.${status}` as Key)}
    </span>
  );
};

interface HomeViewProps {
  flow: Flow;
  setFlow: (flow: Flow) => void;
  library: LibraryState;
  batches: BatchesState;
  health: Health | null;
  settings: AiSettings | null;
  onSettings: (settings: AiSettings) => void;
  /** Start recording on the phone or in a window on this computer. */
  onRecord: (mode: "phone" | "pc") => void;
  onOpenReport: (dir: string) => void;
  onOpenBatch: (batchId: string) => void;
  onOpenSettings: () => void;
}

/** The guided path: drop a playable, pick who plays it, watch the checks, read the verdict. */
export const HomeView = (props: HomeViewProps) => {
  const { flow } = props;
  return (
    <div className="view">
      <div className="scroll">
        {flow.step === 1 && <UploadStep {...props} />}
        {flow.step === 2 && <PlayStep {...props} />}
        {flow.step === 3 && <ProgressStep {...props} />}
        {flow.step === 4 && <ResultStep {...props} />}
      </div>
    </div>
  );
};

const UploadStep = ({ setFlow, library, batches, onOpenReport }: HomeViewProps) => {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const begin = (playableId: string, name: string, batchId: string | null): void =>
    setFlow({ ...EMPTY_FLOW, step: 2, playableId, name, batchId });

  const send = async (picked: PickedFile[]): Promise<void> => {
    if (picked.length === 0 || busy) {
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const upload = await prepare(picked);
      if (upload.kind === "archive") {
        const batch = await batches.upload(upload.file, null);
        if (batch) {
          begin(`${batch.id}_${batch.builds[0].id}`, batch.name, batch.id);
        }
      } else if (upload.kind === "html") {
        const html = await upload.file.text();
        const created = await postJson<{ id: string; name: string }>("/api/playables", { name: upload.file.name, html });
        begin(created.id, created.name, null);
      } else {
        setProblem(explainCode(t, /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i.test(upload.name) ? "OTHER_ARCHIVE" : "BAD_FILE", upload.name || undefined));
      }
    } catch (error) {
      setProblem(explainError(t, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="wizard"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void fromDrop(event.dataTransfer).then(send);
      }}
    >
      <h1 className="wizard-title">{t("upload.title")}</h1>
      <div className={`dropzone ${dragging ? "over" : ""}`} data-guide="upload">
        <StepArt step={1} caption={false} />
        <p className="dropzone-title">{busy ? t("common.uploading") : t("upload.drop")}</p>
        <p className="hint">{t("upload.kinds")}</p>
        <div className="dropzone-actions">
          <button className="primary big" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t("upload.choose")}
          </button>
          <button className="big" disabled={busy} onClick={() => folderInput.current?.click()}>
            {t("upload.folder")}
          </button>
          <button className="ghost big" disabled={busy} onClick={() => begin("sample-tap", t("upload.sampleName"), null)}>
            {t("upload.sample")}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".html,.htm,.zip,text/html,application/zip"
          hidden
          onChange={(event) => {
            void send(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
        <input
          ref={(element) => {
            folderInput.current = element;
            // Not in React's attribute list: the browser's own folder picker.
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          onChange={(event) => {
            void send(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
      </div>
      {problem && <ProblemBox problem={problem} />}
      {!problem && batches.error && <ProblemBox problem={explainError(t, batches.error)} />}
      <History library={library} onOpenReport={onOpenReport} />
    </div>
  );
};

/** Every playable that was ever checked: its latest verdict first, its earlier versions one click away. */
const History = ({ library, onOpenReport }: { library: LibraryState; onOpenReport: (dir: string) => void }) => {
  const { t } = useI18n();
  const scrub = useScrub();
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const byName = new Map<string, ReportSummary[]>();
    for (let i = 0; i < library.reports.length; i += 1) {
      const report = library.reports[i];
      const group = byName.get(report.playable);
      if (group) {
        group.push(report);
      } else {
        byName.set(report.playable, [report]);
      }
    }
    return Array.from(byName.entries());
  }, [library.reports]);
  const page = usePaged(groups, undefined, open === null ? -1 : groups.findIndex(([name]) => name === open));

  if (groups.length === 0) {
    return null;
  }
  return (
    <section className="history">
      {scrub.node}
      <h2>
        {t("history.title")} <Hint text={t("history.tip")} />
      </h2>
      <ul>
        {page.shown.map(([name, reports]) => (
          <li key={name} className={open === name ? "open" : ""}>
            <div className="history-row">
              <VerdictBadge status={reports[0].status} />
              <button
                className="history-name"
                onClick={() => onOpenReport(reports[0].dir)}
                onMouseEnter={(event) => scrub.start(reports[0].dir, event)}
                onMouseMove={scrub.move}
                onMouseLeave={scrub.stop}
              >
                {name}
              </button>
              <span className="dim">
                {reports[0].by ? `${reports[0].by} · ` : ""}
                {reports[0].generatedAt}
              </span>
              {reports.length > 1 ? (
                <button className="ghost" aria-expanded={open === name} onClick={() => setOpen(open === name ? null : name)}>
                  {t("history.versions", { n: reports.length })} {open === name ? "▴" : "▾"}
                </button>
              ) : (
                <span className="dim history-one">{reportKind(t, reports[0])}</span>
              )}
            </div>
            {open === name && (
              <ol className="history-versions">
                {reports.map((report) => (
                  <li key={report.dir}>
                    <VerdictBadge status={report.status} />
                    <span className="dim">{report.generatedAt}</span>
                    <span className="dim">
                      {reportKind(t, report)}
                      {report.network ? ` · ${report.network}` : ""}
                    </span>
                    <button onClick={() => onOpenReport(report.dir)}>{t("common.openReport")}</button>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
      <ShowMore left={page.left} onClick={page.showMore} />
    </section>
  );
};

const PROVIDERS: AiProviderId[] = ["claude", "gpt", "monkey"];

/** What one way of playing checks and what it leaves out, so the choice is an informed one. */
const Scope = ({ mode }: { mode: Mode }) => {
  const { t } = useI18n();
  const lines = (key: Key): string[] => t(key).split("\n").filter(Boolean);
  return (
    <details className="scope">
      <summary>{t("play.scope.more")}</summary>
      <p className="scope-title">{t("play.covers")}</p>
      <ul>
        {lines(`play.${mode}.covers` as Key).map((line) => (
          <li key={line}>
            <span className="mark pass">✓</span>
            {line}
          </li>
        ))}
      </ul>
      <p className="scope-title">{t("play.misses")}</p>
      <ul>
        {lines(`play.${mode}.misses` as Key).map((line) => (
          <li key={line}>
            <span className="mark skip">–</span>
            {line}
          </li>
        ))}
      </ul>
    </details>
  );
};

/** The app the playable advertises: with it, the install link is compared instead of only shown. */
const AppLinks = ({ settings, onSettings }: { settings: AiSettings | null; onSettings: (settings: AiSettings) => void }) => {
  const { t } = useI18n();
  const [ios, setIos] = useState(settings?.apps.ios.text || "");
  const [android, setAndroid] = useState(settings?.apps.android.text || "");
  const loaded = Boolean(settings);

  useEffect(() => {
    if (settings) {
      setIos(settings.apps.ios.text);
      setAndroid(settings.apps.android.text);
    }
  }, [loaded]);

  const save = (apps: { ios?: string; android?: string }): void => {
    void postJson<AiSettings>("/api/settings", { apps }, "PUT").then(onSettings, () => undefined);
  };
  // Saved while typing: the check of the playable's links follows without a click.
  useEffect(() => {
    if (!settings || (ios === settings.apps.ios.text && android === settings.apps.android.text)) {
      return;
    }
    const timer = setTimeout(() => save({ ios, android }), 500);
    return () => clearTimeout(timer);
  }, [ios, android]);
  const state = (store: "ios" | "android", typed: string): JSX.Element => {
    const saved = settings?.apps[store];
    if (!typed.trim()) {
      return <span className="hint">{t("apps.empty")}</span>;
    }
    if (saved && saved.text === typed.trim()) {
      return saved.id ? (
        <span className="hint key-state ok">✓ {t("apps.ok", { id: saved.id })}</span>
      ) : (
        <span className="hint warn-text">{t("apps.bad")}</span>
      );
    }
    return <span className="hint">&nbsp;</span>;
  };

  return (
    <fieldset className="apps">
      <legend>
        {t("apps.title")} <Hint text={t("apps.tip")} />
      </legend>
      <label className="field">
        <span>{t("apps.ios")}</span>
        <input
          className="search"
          type="text"
          spellCheck={false}
          placeholder={t("apps.ios.example")}
          value={ios}
          onChange={(event) => setIos(event.target.value)}
          onBlur={() => save({ ios })}
        />
        {state("ios", ios)}
      </label>
      <label className="field">
        <span>{t("apps.android")}</span>
        <input
          className="search"
          type="text"
          spellCheck={false}
          placeholder={t("apps.android.example")}
          value={android}
          onChange={(event) => setAndroid(event.target.value)}
          onBlur={() => save({ android })}
        />
        {state("android", android)}
      </label>
    </fieldset>
  );
};

/** Why the check cannot start yet, or that the links are right. */
const LinkGateNotice = ({
  gate,
  override,
  onOverride,
}: {
  gate: LinkGateResult;
  override: boolean;
  onOverride: (value: boolean) => void;
}) => {
  const { t } = useI18n();
  const storeName = (store?: "ios" | "android"): string => t(store === "android" ? "gate.store.android" : "gate.store.ios");
  if (gate.verdict === "ok") {
    return (
      <p className="gate ok" role="status">
        <span className="mark pass">✓</span>
        {t("gate.ok", { n: gate.found.length })}
      </p>
    );
  }
  const text =
    gate.verdict === "no-apps"
      ? t("gate.noApps")
      : gate.verdict === "mismatch"
        ? t("gate.mismatch", { store: storeName(gate.store), found: gate.wrongId || "", expected: gate.expected[gate.store || "ios"] || "" })
        : gate.verdict === "unknown-store"
          ? t("gate.unknownStore", { store: storeName(gate.store) })
          : t("gate.absent", { store: storeName(gate.store) });
  return (
    <div className={`gate ${override ? "warned" : "blocked"}`} role="alert">
      {!override && <MickeyArt state="pointLeft" size={70} className="gate-mickey" />}
      <b>{override ? t(gate.verdict === "absent" ? "gate.overridden" : "gate.skipped") : t("gate.blocked")}</b>
      <span>{text}</span>
      {gate.found.length > 0 && (
        <span className="gate-found">
          {t("gate.found")} {gate.found.map((item) => `${storeName(item.store)}: ${item.id}`).join(" · ")}
        </span>
      )}
      <label className="toggle">
        <input type="checkbox" checked={override} onChange={(event) => onOverride(event.target.checked)} />
        <span>{t(gate.verdict === "absent" ? "gate.override" : "gate.skip")}</span>
      </label>
    </div>
  );
};

const MANUAL = ["link", "device", "rules", "look"] as const;

/** The things no mode covers, each with the place to check it by hand. */
const ManualChecks = () => {
  const { t } = useI18n();
  return (
    <section className="manual">
      <h2>{t("manual.title")}</h2>
      <p className="hint">{t("manual.lead")}</p>
      <ol>
        {MANUAL.map((id) => (
          <li key={id}>
            <b>{t(`manual.${id}.title` as Key)}</b>
            <span>{t(`manual.${id}.text` as Key)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

/** How many runs each depth makes, from the settings: the main screens, then the long parts. */
const depthRuns = (settings: AiSettings): { screens: number; extra: Array<{ key: Key; n: number }> } => {
  const platforms = (["android", "ios", "tablet", "foldable"] as const).filter((id) => settings.platforms[id]);
  const screens =
    DEVICE_CATALOG.filter((device) => FORMAT_SET.includes(device.id) && (platforms as string[]).includes(platformOf(device))).length *
    Math.max(1, (["portrait", "landscape"] as const).filter((id) => settings.orientations[id]).length);
  const extra: Array<{ key: Key; n: number }> = [];
  if (settings.stress) extra.push({ key: "depth.stress", n: 3 });
  if (settings.languages?.on && settings.languages.chosen.length > 0) extra.push({ key: "depth.languages", n: settings.languages.chosen.length + 1 });
  if (settings.oldPhones) extra.push({ key: "depth.old", n: 3 });
  return { screens, extra };
};

/** Quick before sending, or full before a release: what each checks, in runs. */
const DepthChoice = ({
  settings,
  depth,
  onChange,
}: {
  settings: AiSettings;
  depth: "quick" | "full";
  onChange: (depth: "quick" | "full") => void;
}) => {
  const { t } = useI18n();
  const runs = depthRuns(settings);
  const full = runs.screens + runs.extra.reduce((sum, item) => sum + item.n, 0);
  return (
    <div className="depth" role="radiogroup" aria-label={t("depth.title")}>
      {(["quick", "full"] as const).map((id) => (
        <button
          key={id}
          role="radio"
          aria-checked={depth === id}
          className={`depth-option ${depth === id ? "on" : ""}`}
          onClick={() => onChange(id)}
        >
          <span className="depth-head">
            <b>{id === "quick" ? "⚡" : "🔍"} {t(`depth.${id}` as Key)}</b>
            <span className="depth-runs">{t("depth.runs", { n: id === "quick" ? runs.screens : full })}</span>
          </span>
          <span className="depth-text">
            {id === "quick"
              ? t("depth.quick.text")
              : runs.extra.length > 0
                ? `${t("depth.full.text")} ${runs.extra.map((item) => `${t(item.key)} (${item.n})`).join(", ")}.`
                : t("depth.full.none")}
          </span>
        </button>
      ))}
    </div>
  );
};

/** The order the playable is played in: once upright, once on its side. */
const PassPlan = ({ settings }: { settings: AiSettings | null }) => {
  const { t } = useI18n();
  const plan = (["portrait", "landscape"] as const).filter((id) => settings?.orientations?.[id] !== false);
  return (
    <p className="pass-plan">
      {plan.map((id, index) => (
        <span key={id} className={`pass-chip ${id}`}>
          <span className="pass-icon" aria-hidden="true" />
          {index + 1}. {t(id === "portrait" ? "common.portrait" : "common.landscape")}
        </span>
      ))}
    </p>
  );
};

const PlayStep = ({ flow, setFlow, batches, health, settings, onSettings, onRecord, onOpenSettings }: HomeViewProps) => {
  const { t, lang } = useI18n();
  const [provider, setProvider] = useState<AiProviderId>(settings?.provider || "claude");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [starting, setStarting] = useState(false);
  const batch = flow.batchId ? batches.batches.find((item) => item.id === flow.batchId) : undefined;

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
    }
  }, [settings?.provider]);

  const depth = flow.depth || settings?.depth || "quick";
  const startRun = async (mode: "ai" | "load"): Promise<void> => {
    setProblem(null);
    setStarting(true);
    try {
      const run = await postJson<QuickRun>("/api/runs", { playableId: flow.playableId, mode, provider, lang, by: getName(), depth });
      setFlow({ ...flow, mode, runId: run.id, traceId: null, reportDir: null, step: 3 });
    } catch (error) {
      setProblem(explainError(t, error));
    } finally {
      setStarting(false);
    }
  };

  const loadOnly = (): void => {
    if (batch) {
      // Every build of an archive is loaded on every screen as soon as it is uploaded.
      setFlow({ ...flow, mode: "load", traceId: null, runId: null, step: 3 });
      return;
    }
    void startRun("load");
  };

  const ready = aiReady(settings, provider);

  // The store links in the playable must lead to the app before anything is started.
  const [gate, setGate] = useState<LinkGateResult | null>(null);
  const [override, setOverride] = useState(false);
  const appsKey = settings ? `${settings.apps.ios.text}|${settings.apps.android.text}` : "";
  useEffect(() => {
    if (!flow.playableId) {
      return;
    }
    let stale = false;
    setOverride(false);
    void api<LinkGateResult>(`/api/playables/${encodeURIComponent(flow.playableId)}/links`).then(
      (result) => {
        if (!stale) {
          setGate(result);
        }
      },
      () => undefined
    );
    return () => {
      stale = true;
    };
  }, [flow.playableId, appsKey]);
  // Any mismatch can be skipped on purpose; the report still says what the links were.
  const blocked = gate !== null && gate.verdict !== "ok" && !override;
  // Before anything starts, Micky says what would otherwise surprise later:
  // links that do not match, builds that will be skipped, screens left out.
  useEffect(() => {
    if (!gate || !settings) {
      return;
    }
    const notes: string[] = [];
    if (gate.verdict === "no-apps") {
      notes.push(t("mascot.warn.noApps"));
    } else if (gate.verdict !== "ok") {
      notes.push(t("mascot.gate"));
    }
    const skipped = (batch?.builds || []).filter((build) => build.state === "skipped");
    if (skipped.length > 0) {
      const names = Array.from(new Set(skipped.map((build) => build.network?.name).filter(Boolean))).join(", ");
      notes.push(t("mascot.warn.skipped", { n: skipped.length, names }));
    }
    // One orientation off: say which one is still checked.
    const on = (["portrait", "landscape"] as const).filter((id) => settings.orientations[id]);
    if (on.length === 1) {
      notes.push(t("mascot.warn.orientation", { o: t(on[0] === "portrait" ? "common.portrait" : "common.landscape").toLowerCase() }));
    }
    if (settings.platforms.ios && health && !health.webkit) {
      notes.push(t("mascot.warn.webkit"));
    }
    if (notes.length > 0) {
      mascotSay({ pose: "checklist", text: notes.join(" "), ms: 5000 + notes.length * 2500 });
    } else if (gate.verdict === "ok") {
      mascotSay({ pose: "ok", text: t("mascot.gate.ok"), ms: 3500 });
    }
  }, [gate?.verdict, flow.playableId, settings === null]);

  return (
    <div className="wizard">
      <h1 className="wizard-title">{t("play.title")}</h1>
      <p className="lead">{t("play.lead")}</p>
      <StepArt step={2} inline />
      {settings && (
        <p className="scope-line">
          {t("play.scope", {
            devices: (["android", "ios", "tablet", "foldable"] as const)
              .filter((id) => settings.platforms[id])
              // Inside a sentence only brand names keep their capital letter.
              .map((id) => {
                const label = t(`scope.platform.${id}` as Key);
                return id === "tablet" || id === "foldable" ? label.charAt(0).toLowerCase() + label.slice(1) : label;
              })
              .join(", "),
            orientations: (["portrait", "landscape"] as const)
              .filter((id) => settings.orientations[id])
              .map((id) => t(id === "portrait" ? "common.portrait" : "common.landscape").toLowerCase())
              .join(t("scope.and")),
          })}{" "}
          <button className="linkish" onClick={onOpenSettings}>
            {t("play.scope.change")}
          </button>
        </p>
      )}

      {batch && batch.builds.length > 1 && (
        <label className="field wizard-field">
          <span>
            {t("play.build")} <Hint text={t("play.build.tip", { n: batch.builds.length })} />
          </span>
          <select
            value={flow.playableId || ""}
            onChange={(event) => setFlow({ ...flow, playableId: event.target.value })}
          >
            {batch.builds.map((build) => (
              <option key={build.id} value={`${batch.id}_${build.id}`}>
                {build.network ? `${build.network.name} · ` : ""}
                {build.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {problem && <ProblemBox problem={problem} />}

      {settings && (
        <DepthChoice
          settings={settings}
          depth={depth}
          onChange={(next) => {
            setFlow({ ...flow, depth: next });
            // Remembered as the default on this computer; a teammate's choice lasts for this check.
            void api<AiSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ depth: next }) }).then(onSettings, () => undefined);
          }}
        />
      )}
      <AppLinks settings={settings} onSettings={onSettings} />
      {gate && <LinkGateNotice gate={gate} override={override} onOverride={setOverride} />}

      <div className="cards">
        <div className="card">
          <span className="card-badge">{t("play.phone.badge")}</span>
          <ModeIcon mode="phone" />
          <h2>{t("play.phone.title")}</h2>
          <p>{t("play.phone.text")}</p>
          <Scope mode="phone" />
          {health && !health.lan && <p className="hint warn-text">{t("record.noLan")}</p>}
          <div className="card-foot">
            <PassPlan settings={settings} />
            <button className="primary" disabled={blocked} data-guide="play" onClick={() => onRecord("phone")}>
              {t("play.phone.go")}
            </button>
          </div>
        </div>

        <div className="card">
          <ModeIcon mode="pc" />
          <h2>{t("play.pc.title")}</h2>
          <p>{t("play.pc.text")}</p>
          <Scope mode="pc" />
          <div className="card-foot">
            <PassPlan settings={settings} />
            <button className="primary" disabled={blocked} onClick={() => onRecord("pc")}>
              {t("play.pc.go")}
            </button>
          </div>
        </div>

        <div className="card">
          <ModeIcon mode="ai" />
          <h2>{t("play.ai.title")}</h2>
          <p>{t("play.ai.text")}</p>
          <Scope mode="ai" />
          {batch && batch.builds.length > 1 && <p className="hint">{t("play.ai.oneBuild")}</p>}
          <div className="card-foot">
            <label className="field">
              <span>
                {t("play.ai.who")} <Hint text={t("play.ai.who.tip")} />
              </span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as AiProviderId)}>
                {PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {t(`provider.${id}` as Key)}
                  </option>
                ))}
              </select>
            </label>
            {ready ? (
              <button className="primary" disabled={starting || blocked} onClick={() => void startRun("ai")}>
                {t("play.ai.go")}
              </button>
            ) : (
              <>
                <p className="hint warn-text">{t("play.ai.noKey")}</p>
                <button onClick={onOpenSettings}>{t("play.ai.addKey")}</button>
              </>
            )}
          </div>
        </div>

        <div className="card quiet">
          <ModeIcon mode="load" />
          <h2>{t("play.load.title")}</h2>
          <p>{t("play.load.text")}</p>
          <Scope mode="load" />
          <div className="card-foot">
            <button disabled={starting || blocked} onClick={loadOnly}>
              {t("play.load.go")}
            </button>
          </div>
        </div>
      </div>
      <ManualChecks />
    </div>
  );
};

/** Follows a run on the hub until it ends. */
const useRun = (runId: string | null): { run: QuickRun | null; lost: boolean } => {
  const [run, setRun] = useState<QuickRun | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    setRun(null);
    setLost(false);
    if (!runId) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await api<QuickRun>(`/api/runs/${encodeURIComponent(runId)}`);
        if (stopped) {
          return;
        }
        setRun(next);
        setLost(false);
        if (next.state !== "running") {
          return;
        }
      } catch (error) {
        if (stopped) {
          return;
        }
        // The hub restarted and forgot the run: there is nothing left to wait for.
        if (error instanceof ApiError && error.code === "RUN_NOT_FOUND") {
          setLost(true);
          return;
        }
      }
      timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);
  return { run, lost };
};

const ProgressStep = ({ flow, setFlow, library, batches }: HomeViewProps) => {
  const tilesOf = (): ScreenTile[] => {
    if (run?.screens) {
      return run.screens;
    }
    if (trace?.job?.screens) {
      return trace.job.screens;
    }
    // An archive: the screens of the builds being tested right now.
    return (batch?.builds || []).filter((build) => build.state === "running").flatMap((build) => build.tiles || []);
  };
  const { t } = useI18n();
  const { run, lost } = useRun(flow.runId);
  const trace = flow.traceId && !flow.batchId ? library.traces.find((item) => item.id === flow.traceId) : undefined;
  const batch = flow.batchId && !flow.runId ? batches.batches.find((item) => item.id === flow.batchId) : undefined;
  // Re-render every second so the time left keeps moving between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const finish = (reportDir: string | null): void => {
    void library.refresh();
    setFlow({ ...flow, step: 4, reportDir });
  };

  useEffect(() => {
    if (run?.state === "done") {
      finish(run.reportDir);
    }
  }, [run?.state]);

  useEffect(() => {
    if (trace && !trace.job && trace.report) {
      finish(trace.report.dir);
    }
  }, [trace?.job, trace?.report?.dir]);

  const batchDone = batch ? !batchBusy(batch) : false;
  useEffect(() => {
    if (batch && batchDone) {
      finish(null);
    }
  }, [batch?.id, batchDone]);

  let problem: Problem | null = null;
  let done = 0;
  let total = 0;
  let startedAt = Date.now();
  if (run) {
    done = run.progress?.done || 0;
    total = run.progress?.total || 0;
    startedAt = run.startedAt;
    if (run.state === "failed") {
      problem = explainJob(t, run.error);
    }
  } else if (lost) {
    problem = explainCode(t, "JOB_FAILED");
  } else if (trace) {
    done = trace.job?.progress?.done || 0;
    total = trace.job?.progress?.total || 0;
    startedAt = trace.job?.startedAt || startedAt;
    if (trace.job?.state === "failed") {
      problem = explainJob(t, trace.job.error);
    }
  } else if (batch) {
    const progress = batchProgress(batch);
    done = progress.done;
    total = progress.total;
    startedAt = batch.runStartedAt || batch.createdAt;
  }
  const left = timeLeft(t, startedAt, done, total);
  const counts = batch ? tally(batch) : null;
  const tiles = tilesOf();

  // The tab says how far the check is, for whoever switched to other work meanwhile.
  const shown = total > 0 ? `(${Math.floor(done)}/${total}) ` : "";
  useEffect(() => {
    document.title = `${shown}${t("progress.title")} · PlayGuard`;
  }, [shown]);
  useEffect(() => () => {
    document.title = t("app.title");
  }, []);

  if (problem) {
    return (
      <div className="wizard narrow">
        <h1 className="wizard-title">{t("progress.failed")}</h1>
        <ProblemBox problem={problem}>
          <button className="primary" onClick={() => setFlow({ ...flow, step: 2, runId: null, traceId: null, recording: false })}>
            {t("progress.back")}
          </button>
        </ProblemBox>
      </div>
    );
  }

  return (
    <div className="wizard narrow">
      <h1 className="wizard-title">{flow.mode === "ai" ? t("progress.title.ai") : t("progress.title")}</h1>
      {tiles.length === 0 && <StepArt step={3} inline />}
      {/* Micky walks along the bar with a magnifier as the screens get done. */}
      <div className="bar-walk">
        <Bar done={done} total={total} />
        <span className="bar-walker" style={{ left: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}>
          <MickeyArt state={{ pose: "walk", effect: "search" }} size={64} />
        </span>
      </div>
      {tiles.length > 0 && <ScreensProgress tiles={tiles} />}
      <p className="progress-line" role="status">
        {batch && counts
          ? t("progress.builds", { done: batch.builds.length - counts.pending, total: batch.builds.length })
          : total > 0
            ? t("progress.screens", { done: Math.floor(done), total })
            : t("progress.starting")}
        {left ? ` · ${left}` : ""}
      </p>
      {flow.mode === "ai" && (
        <div className="notice">
          <span>{run?.provider === "monkey" ? t("progress.monkey") : t("progress.ai.window")}</span>
          {run?.tokens && run.provider !== "monkey" && (
            <span className="tokens">
              {t("progress.tokens", {
                used: run.tokens.used.toLocaleString(),
                limit: run.tokens.limit.toLocaleString(),
                calls: run.tokens.calls,
              })}{" "}
              <Hint text={t("hint.tokens")} />
            </span>
          )}
          {run?.lastLine && <code className="live-line">{run.lastLine}</code>}
        </div>
      )}
      {flow.mode !== "ai" && <p className="hint center-text">{t("progress.note")}</p>}
      {batch && (
        <ul className="build-states">
          {batch.builds.map((build) => (
            <li key={build.id}>
              {build.state === "done" && build.verdict ? (
                <span className={`mark ${build.verdict}`}>{VERDICT_GLYPH[build.verdict]}</span>
              ) : build.state === "running" ? (
                <span className="spinner" />
              ) : build.state === "queued" ? (
                <span className="mark skip">·</span>
              ) : (
                <span className="mark fail">✕</span>
              )}
              <span>
                {build.network ? <b>{build.network.name} </b> : null}
                <span className="dim">{build.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const batchVerdict = (batch: Batch): Verdict => {
  const counts = tally(batch);
  return counts.fail + counts.broken > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
};

const ResultStep = ({ flow, setFlow, library, batches, onOpenReport, onOpenBatch }: HomeViewProps) => {
  const [anchor, setAnchor] = useState<string | null>(null);
  // Bumped when a screen was checked again: the report page reloads.
  const [reloads, setReloads] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (anchor) {
      frame.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [anchor]);
  const { t, lang } = useI18n();
  const report = flow.reportDir ? library.reports.find((item) => item.dir === flow.reportDir) : undefined;
  const batch = !flow.reportDir && flow.batchId ? batches.batches.find((item) => item.id === flow.batchId) : undefined;
  const { run } = useRun(flow.runId);

  // The report was written a moment ago; the list may not have it yet.
  useEffect(() => {
    if (flow.reportDir && !report) {
      const timer = setTimeout(() => void library.refresh(), 800);
      return () => clearTimeout(timer);
    }
  }, [flow.reportDir, report, library.reports]);

  const status: Verdict | null = report ? report.status : batch ? batchVerdict(batch) : null;
  useEffect(() => {
    if (!status) {
      return;
    }
    document.title = `${VERDICT_GLYPH[status]} ${t(`verdict.${status}` as Key)} · PlayGuard`;
    return () => {
      document.title = t("app.title");
    };
  }, [status]);
  const again = (): void => setFlow({ ...flow, step: 2, mode: null, runId: null, traceId: null, reportDir: null, recording: false });

  // A quick check before sending can grow into the full one before a release, from the same playthrough.
  const wasQuick = (report?.depth === "quick" || batch?.depth === "quick") && flow.mode !== "ai";
  const [upgrading, setUpgrading] = useState(false);
  const runFull = async (): Promise<void> => {
    setUpgrading(true);
    try {
      if (batch) {
        await batches.rerun(batch.id, batch.traceId, batch.alsoTraceIds, "full");
        setFlow({ ...flow, depth: "full", step: 3, reportDir: null, runId: null });
      } else if (flow.traceId) {
        await library.runChecks(flow.traceId, undefined, flow.traceIds.slice(1), "full");
        setFlow({ ...flow, depth: "full", step: 3, reportDir: null, runId: null });
      } else if (flow.playableId) {
        const next = await postJson<QuickRun>("/api/runs", { playableId: flow.playableId, mode: "load", lang, by: getName(), depth: "full" });
        setFlow({ ...flow, depth: "full", step: 3, reportDir: null, runId: next.id });
      }
    } finally {
      setUpgrading(false);
    }
  };

  if (!status) {
    return (
      <div className="wizard narrow">
        <p className="progress-line">
          <span className="spinner" /> {t("result.loading")}
        </p>
      </div>
    );
  }

  const counts = batch ? tally(batch) : null;
  return (
    <div className="result">
      <div className={`hero ${status}`}>
        {status === "pass" && <Confetti />}
        <span className={`hero-mark ${status}`}>{VERDICT_GLYPH[status]}</span>
        <MickeyArt state={status === "pass" ? "celebrate" : status === "warn" ? "worried" : "upset"} size={118} className="hero-mickey" />
        <div className="hero-text">
          <h1>{t(`verdict.${status}` as Key)}</h1>
          <p>{t(status === "pass" && flow.mode === "load" ? "result.pass.load" : (`result.${status}` as Key))}</p>
          <p className="dim">
            {report &&
              t("common.screensClean", {
                n: report.screens.pass,
                total: report.screens.pass + report.screens.warn + report.screens.fail,
              })}
            {batch && counts && t("builds.tally", { ...counts, fail: counts.fail + counts.broken })}
            {flow.mode === "load" ? ` · ${t("result.loadOnly")}` : ""}
            {run?.tokens && run.provider !== "monkey"
              ? ` · ${t("result.tokens", { used: run.tokens.used.toLocaleString(), calls: run.tokens.calls })}`
              : ""}
          </p>
        </div>
        <div className="hero-actions">
          {batch && (
            <>
              <a
                className="button primary"
                href={`/api/batches/${encodeURIComponent(batch.id)}/sheet?lang=${lang}`}
                target="_blank"
                rel="noreferrer"
                title={t("builds.sheet.tip")}
              >
                {t("builds.sheet")}
              </a>
              <a
                className="button"
                href={`/api/batches/${encodeURIComponent(batch.id)}/pack?lang=${lang}`}
                title={t("pack.tip")}
              >
                {t("pack.button")}
              </a>
              <button onClick={() => onOpenBatch(batch.id)}>{t("result.table")}</button>
            </>
          )}
          <button onClick={again}>{t("result.again")}</button>
          <button onClick={() => setFlow(EMPTY_FLOW)}>{t("result.another")}</button>
        </div>
      </div>
      {wasQuick && (
        <div className="depth-upgrade" role="note">
          <span>⚡ {t("depth.wasQuick")}</span>
          <button className="primary" disabled={upgrading} onClick={() => void runFull()}>
            🔍 {t("depth.runFull")}
          </button>
        </div>
      )}
      {report && <StepArt step={4} inline />}
      {report && <ShareBar dir={report.dir} url={report.url} />}
      {report && (
        <ResultScreens
          dir={report.dir}
          onOpen={(runId) => setAnchor(`${runId}-${Date.now()}`)}
          onChanged={() => {
            setReloads((value) => value + 1);
            void library.refresh();
          }}
        />
      )}
      {report && (
        <iframe
          key={reloads}
          className="report-frame"
          title={report.playable}
          src={anchor ? `${report.url}#${anchor.replace(/-\d+$/, "")}` : report.url}
          ref={frame}
        />
      )}
      {batch && (
        <ul className="build-results">
          {batch.builds.map((build) => (
            <li key={build.id}>
              {build.state === "done" && build.verdict ? (
                <VerdictBadge status={build.verdict} />
              ) : build.state === "skipped" ? (
                <span className="verdict skip">
                  <span className="mark skip">–</span>
                  {t("builds.skipped")}
                </span>
              ) : (
                <span className="verdict fail">
                  <span className="mark fail">✕</span>
                  {t("builds.didNotRun")}
                </span>
              )}
              <span className="build-name">
                <b>{build.network ? build.network.name : t("builds.unknown")}</b>
                <span className="dim">{build.name}</span>
              </span>
              {build.reportDir && <button onClick={() => onOpenReport(build.reportDir!)}>{t("common.report")}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
