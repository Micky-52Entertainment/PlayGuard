import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AiSettings, Health } from "./api";
import { BuildsView } from "./BuildsView";
import { ProblemBox, explainCode } from "./errors";
import { EMPTY_FLOW, HomeView, Stepper, loadFlow, saveFlow } from "./HomeView";
import type { Flow } from "./HomeView";
import { LANGS, useI18n } from "./i18n";
import type { Key } from "./i18n";
import { useBatches, useLibrary } from "./library";
import { RecordView } from "./RecordView";
import type { RecordRequest } from "./RecordView";
import { ReportsView } from "./ReportsView";
import { SettingsView } from "./SettingsView";
import { SetupDialog, setupPostponed } from "./SetupDialog";
import { Tour, tourSeen } from "./Tour";
import { NameDialog } from "./Dialogs";
import { HelpView } from "./HelpView";
import { nameAsked } from "./identity";
import { TracesView } from "./TracesView";
import { Mascot, findAnswer, preloadMascot } from "./Mascot";
import type { MascotAction, MascotExplain } from "./Mascot";
import { SECTIONS } from "./HelpView";
import { Present } from "./Present";
import { briefUrl } from "./ReportsView";
import { chime, mascotSay } from "./mascotBus";
import type { MascotLine } from "./mascotBus";

type View = "check" | "builds" | "traces" | "reports" | "settings" | "help";

const NAV: Array<{ id: View; icon: JSX.Element }> = [
  {
    id: "check",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7" />
        <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
      </svg>
    ),
  },
  {
    id: "builds",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5z" />
        <path d="M3.5 6.5 10 10l6.5-3.5M10 10v7" />
      </svg>
    ),
  },
  // Recordings are turned off: the wizard records, checks and keeps them by itself,
  // and a separate list of raw recordings only confused the team. To bring it
  // back, uncomment this entry (the view below and TracesView are kept).
  // {
  //   id: "traces",
  //   icon: (
  //     <svg viewBox="0 0 20 20" aria-hidden="true">
  //       <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
  //       <circle cx="10" cy="10" r="3.2" fill="currentColor" />
  //     </svg>
  //   ),
  // },
  {
    id: "reports",
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M5 16V9M10 16V4M15 16v-5" />
      </svg>
    ),
  },
];

const HELP_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="10" cy="10" r="7" />
    <path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5" />
    <circle cx="10" cy="14" r="0.4" fill="currentColor" />
  </svg>
);

const SETTINGS_ICON = (
  <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M4 6h5M13 6h3M4 14h3M11 14h5" />
    <circle cx="11" cy="6" r="2" />
    <circle cx="9" cy="14" r="2" />
  </svg>
);

const STREAK_KEY = "playable-lab.pass-streak";
const GUIDED_KEY = "playable-lab.guided";

export const App = () => {
  const { t, lang, setLang } = useI18n();
  const langIndex = LANGS.findIndex((item) => item.id === lang);
  const nextLang = LANGS[(langIndex + 1) % LANGS.length];
  const [view, setView] = useState<View>(() => {
    // The app's shortcuts (right click on its icon) open a view directly.
    const asked = new URLSearchParams(window.location.search).get("view");
    return asked === "reports" || asked === "builds" || asked === "settings" || asked === "help" ? asked : "check";
  });
  const [flow, setFlow] = useState<Flow>(loadFlow);
  const [reportDir, setReportDir] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [recordRequest, setRecordRequest] = useState<RecordRequest | null>(null);
  const [recordLive, setRecordLive] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [hubDown, setHubDown] = useState(false);
  const [videoNoteHidden, setVideoNoteHidden] = useState(false);
  const [setup, setSetup] = useState(false);
  const [setupAsked, setSetupAsked] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [tour, setTour] = useState(() => !tourSeen());
  const [askName, setAskName] = useState(() => !nameAsked());
  const [teamUrl, setTeamUrl] = useState<string | null>(null);
  const library = useLibrary();
  const batches = useBatches();

  const refreshHealth = useCallback(async (): Promise<void> => {
    try {
      const next = await api<Health>("/api/health");
      // A hub from before an update does not send the newer fields.
      setHealth({ ...next, missing: next.missing || [], downloadMb: next.downloadMb || 0 });
      setHubDown(false);
    } catch {
      setHubDown(true);
    }
  }, []);

  // While the hub is away, or a browser is downloading, keep asking.
  const watching = hubDown || health?.install.state === "running";
  useEffect(() => {
    void refreshHealth();
    if (!watching) {
      return;
    }
    const timer = setInterval(() => void refreshHealth(), 3000);
    return () => clearInterval(timer);
  }, [watching, refreshHealth]);

  useEffect(() => {
    if (hubDown) {
      return;
    }
    void api<AiSettings>("/api/settings").then(setSettings, () => undefined);
    void api<{ teamUrl?: string | null }>("/api/meta").then((meta) => setTeamUrl(meta.teamUrl || null), () => undefined);
    void library.refresh();
    void batches.refresh();
  }, [hubDown]);

  useEffect(() => {
    if (view !== "check" || !flow.recording) {
      void library.refresh();
    }
  }, [view, library.refresh]);

  useEffect(() => {
    saveFlow(flow);
  }, [flow]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("app.title");
  }, [lang]);

  const install = (): void => {
    void api<Health>("/api/health/install", { method: "POST" }).then(
      () => refreshHealth(),
      () => setHubDown(true)
    );
  };

  const openReport = (dir: string): void => {
    setReportDir(dir);
    setView("reports");
  };

  const openBatch = (id: string): void => {
    setBatchId(id);
    setView("builds");
  };

  const running = library.traces.filter((trace) => trace.job?.state === "running").length;
  const testing = batches.batches.some((batch) =>
    batch.builds.some((build) => build.state === "queued" || build.state === "running")
  );

  // The mascot: what the lab is doing right now, and a reaction when a check ends.
  useEffect(() => preloadMascot(), []);
  const busy = running > 0 || testing || (view === "check" && flow.step === 3);
  const resultStatus =
    flow.step === 4 && flow.reportDir ? library.reports.find((report) => report.dir === flow.reportDir)?.status : undefined;
  const mascotBase: MascotLine = tour
    ? { pose: "wave" }
    : recordLive
      ? { pose: "phone" }
      : busy
        ? { pose: "laptop" }
        : view === "check" && resultStatus
          ? { pose: resultStatus === "pass" ? "cheer" : resultStatus === "warn" ? "sweat" : "sad" }
          : { pose: "idle" };
  const react = (status: "pass" | "warn" | "fail"): void => {
    // A run of clean results is worth a word.
    let streak = 0;
    try {
      streak = status === "pass" ? Number(localStorage.getItem(STREAK_KEY) || 0) + 1 : 0;
      localStorage.setItem(STREAK_KEY, String(streak));
    } catch {
      streak = 0;
    }
    const text =
      status === "pass" && streak >= 3
        ? t("mascot.streak", { n: streak })
        : `${t(`mascot.done.${status}` as Key)}${status === "pass" ? "" : ` ${t("mascot.clickMe")}`}`;
    mascotSay({ pose: status === "pass" ? (streak >= 3 ? "trophy" : "celebrate") : status === "warn" ? "sweat" : "scared", text, ms: 7000 });
    chime(status);
  };
  const previous = useRef({ running, testing, step: flow.step });
  const pendingVerdict = useRef(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = { running, testing, step: flow.step };
    // A check of the wizard ended: its verdict is on the screen now.
    if (before.step === 3 && flow.step === 4) {
      pendingVerdict.current = true;
    }
    // A check started elsewhere (Recordings, Builds) ended in the background.
    if (before.running > running && library.reports[0]) {
      react(library.reports[0].status);
    }
    if (before.testing && !testing) {
      const latest = batches.batches[0];
      const verdicts = (latest?.builds || []).map((build) => build.verdict);
      react(verdicts.includes("fail") ? "fail" : verdicts.includes("warn") ? "warn" : "pass");
    }
  }, [running, testing, flow.step]);
  useEffect(() => {
    if (pendingVerdict.current && resultStatus) {
      pendingVerdict.current = false;
      react(resultStatus);
    }
  }, [resultStatus, flow.step]);

  const uploadedNetworks = Array.from(
    new Set(
      batches.batches.flatMap((batch) =>
        batch.builds.filter((build) => build.network?.known).map((build) => build.network!.id)
      )
    )
  );

  // Step 2 of the wizard, for one playable or one build of an archive.
  // ---- What Micky knows about the page ----
  const [presentDir, setPresentDir] = useState<string | null>(null);
  const [guided, setGuided] = useState(() => {
    try {
      return localStorage.getItem(GUIDED_KEY) === "1";
    } catch {
      return true;
    }
  });
  const shownReport = view === "check" && flow.step === 4 ? flow.reportDir : view === "reports" ? reportDir || library.reports[0]?.dir || null : null;
  const [explain, setExplain] = useState<MascotExplain | null>(null);
  useEffect(() => {
    setExplain(null);
    if (!shownReport) {
      return;
    }
    let stale = false;
    void api<{ headline: string; rows: Array<{ id: string; question: string; answer: string; text: string; where?: string }> }>(
      `/api/reports/${encodeURIComponent(shownReport)}/summary?lang=${lang}`
    ).then(
      (summary) => {
        if (stale) {
          return;
        }
        const worst = summary.rows.find((row) => row.answer === "no") || summary.rows.find((row) => row.answer === "partly");
        setExplain(
          worst
            ? {
                title: worst.question,
                text: `${worst.text}${worst.where ? ` (${worst.where})` : ""}`,
                advice: t(`mascot.fix.${worst.id}` as Key) === `mascot.fix.${worst.id}` ? t("mascot.fix.other") : t(`mascot.fix.${worst.id}` as Key),
              }
            : { title: summary.headline, text: t("mascot.allGood"), advice: t("mascot.fix.ready") }
        );
      },
      () => undefined
    );
    return () => {
      stale = true;
    };
  }, [shownReport, lang]);

  // The next step on each screen, for someone who seems stuck there.
  const hint: { key: string; text: string } | null =
    view !== "check"
      ? null
      : flow.recording
        ? { key: "record", text: t("mascot.hint.record") }
        : { key: `step${flow.step}`, text: t(`mascot.hint.step${flow.step}` as Key) };

  // The first check: the button to press lights up, step by step.
  const guide =
    guided || view !== "check" || flow.recording
      ? null
      : flow.step === 1
        ? { target: "upload", text: t("mascot.guide.upload") }
        : flow.step === 2
          ? { target: "play", text: t("mascot.guide.play") }
          : flow.step === 4
            ? { target: "share", text: t("mascot.guide.share") }
            : null;
  useEffect(() => {
    if (!guided && flow.step === 4) {
      const done = setTimeout(() => {
        setGuided(true);
        try {
          localStorage.setItem(GUIDED_KEY, "1");
        } catch {
          // Private mode: the guide may come back next time.
        }
      }, 12000);
      return () => clearTimeout(done);
    }
  }, [guided, flow.step]);

  const lastReport = library.reports[0]?.dir || null;
  const mascotActions: MascotAction[] = [
    { id: "sample", label: t("mascot.act.sample"), run: () => beginWith("sample-tap", t("upload.sampleName"), null) },
    { id: "last", label: t("mascot.act.last"), run: () => lastReport && openReport(lastReport), disabled: !lastReport },
    { id: "present", label: t("mascot.act.present"), run: () => setPresentDir(shownReport || lastReport), disabled: !(shownReport || lastReport) },
    {
      id: "manager",
      label: t("mascot.act.manager"),
      run: () => {
        const dir = shownReport || lastReport;
        if (dir) {
          window.location.href = briefUrl(dir, lang, true);
        }
      },
      disabled: !(shownReport || lastReport),
    },
    { id: "help", label: t("mascot.act.help"), run: () => setView("help") },
  ];
  const openHelp = (section?: string): void => {
    setView("help");
    if (section) {
      setTimeout(() => document.getElementById(`help-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
  };
  const askHelp = (question: string) =>
    findAnswer(
      question,
      SECTIONS.map((id) => ({ id, title: t(`help.${id}.title` as Key), body: t(`help.${id}.body` as Key) }))
    );

  const beginWith = (playableId: string, name: string, forBatch: string | null): void => {
    if (recordLive) {
      setView("check");
      return;
    }
    setFlow({ ...EMPTY_FLOW, step: 2, playableId, name, batchId: forBatch });
    setView("check");
  };

  // Played once in each orientation that is on in Settings: portrait first, then landscape.
  const record = (mode: "phone" | "pc"): void => {
    if (!flow.playableId) {
      return;
    }
    const plan = (["portrait", "landscape"] as const).filter((id) => settings?.orientations?.[id] !== false);
    const order = plan.length > 0 ? [...plan] : ["portrait" as const];
    setRecordRequest({
      playableId: flow.playableId,
      nonce: Date.now(),
      stepId: `android-${order[0]}`,
      autoStart: true,
      onComputer: mode === "pc",
      pass: { index: 0, total: order.length },
    });
    setFlow({ ...flow, mode, recording: true, plan: order, pass: 0, traceIds: [] });
  };

  // A saved recording leads to the next orientation, and after the last one
  // to the checks: on this playable, or on every build of its archive.
  const onSaved = async (traceId: string, networkId: string | undefined, usable: boolean): Promise<void> => {
    if (!usable || !flow.recording) {
      return;
    }
    const traceIds = [...flow.traceIds, traceId];
    const next = flow.pass + 1;
    mascotSay({ pose: "ok", text: t(next < flow.plan.length ? (flow.mode === "pc" ? "mascot.saved.nextPc" : "mascot.saved.next") : "mascot.saved"), ms: 5000 });
    if (next < flow.plan.length && flow.playableId) {
      setRecordRequest({
        playableId: flow.playableId,
        nonce: Date.now(),
        stepId: `android-${flow.plan[next]}`,
        autoStart: true,
        onComputer: flow.mode === "pc",
        after: traceId,
        pass: { index: next, total: flow.plan.length },
      });
      setFlow({ ...flow, pass: next, traceIds });
      return;
    }
    const [first, ...also] = traceIds;
    if (flow.batchId) {
      await batches.rerun(flow.batchId, first, also, flow.depth);
    } else {
      await library.runChecks(first, networkId, also, flow.depth);
    }
    setFlow({ ...flow, traceId: first, traceIds, runId: null, reportDir: null, recording: false, step: 3 });
  };

  const replayOnBatch = (id: string, traceId: string): void => {
    void batches.rerun(id, traceId);
    openBatch(id);
  };

  const showRecord = view === "check" && flow.recording;
  // Anything to download is asked about once, up front, not discovered in the middle of a check.
  useEffect(() => {
    if (!health || setupAsked || health.install.state === "running") {
      return;
    }
    setSetupAsked(true);
    if (health.missing.length > 0 && !setupPostponed(health.missing)) {
      setSetup(true);
    }
  }, [health, setupAsked]);

  // Deleting history is for the computer that runs the lab, not for a teammate's browser.
  const canDelete = settings?.local !== false;
  const browserMissing = health?.browser === "none";
  const videoOff = health && !browserMissing && !health.video && !videoNoteHidden;

  return (
    <div className="shell">
      <nav className="rail" aria-label={t("nav.label")}>
        <span className="rail-brand" title="PlayGuard">
          <img src="/logo.png" alt="PlayGuard" />
          <span>PlayGuard</span>
        </span>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "on" : ""}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            {item.icon}
            <span>{t(`nav.${item.id}` as Key)}</span>
            {item.id === "traces" && running > 0 && <span className="rail-dot" title={t("nav.dot.checks")} />}
            {item.id === "builds" && testing && <span className="rail-dot" title={t("nav.dot.builds")} />}
            {item.id === "check" && recordLive && <span className="rail-dot live" title={t("phase.recording")} />}
          </button>
        ))}
        <span className="rail-gap" />
        <button
          className={view === "help" ? "on" : ""}
          aria-current={view === "help" ? "page" : undefined}
          onClick={() => setView("help")}
        >
          {HELP_ICON}
          <span>{t("nav.help")}</span>
        </button>
        <button
          className={view === "settings" ? "on" : ""}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => setView("settings")}
        >
          {SETTINGS_ICON}
          <span>{t("nav.settings")}</span>
        </button>
        <button className="rail-lang" title={t("settings.lang")} onClick={() => setLang(nextLang.id)}>
          <b>{LANGS[langIndex].code}</b>
          <span>{nextLang.code}</span>
        </button>
      </nav>

      <div className="main">
        {hubDown && <ProblemBox problem={explainCode(t, "HUB_DOWN")} banner />}
        {!hubDown && browserMissing && (
          <div className="banner problem-box" role="alert">
            <b>{t("health.noBrowser.title")}</b>
            <span>{t("health.noBrowser.text")}</span>
            <div className="problem-actions">
              <button className="primary" disabled={health?.install.state === "running"} onClick={install}>
                {health?.install.state === "running" ? t("health.installing") : t("health.install")}
              </button>
            </div>
          </div>
        )}
        {!hubDown && videoOff && (
          <div className="banner soft">
            <span>{health.install.state === "failed" ? t("health.installFailed") : t("health.noVideo")}</span>
            <button disabled={health.install.state === "running"} onClick={install}>
              {health.install.state === "running" ? t("health.installing") : t("health.install")}
            </button>
            <button className="ghost" onClick={() => setVideoNoteHidden(true)}>
              {t("common.hide")}
            </button>
          </div>
        )}

        {view === "check" && (
          <Stepper
            flow={flow}
            locked={recordLive}
            onRestart={() => setFlow(EMPTY_FLOW)}
            onBack={() => setFlow({ ...flow, recording: false })}
          />
        )}

        {/* The record view stays mounted: a live session must survive a look at the library. */}
        <div className="panel" hidden={!showRecord}>
          <RecordView
            library={library}
            onOpenReport={openReport}
            request={recordRequest}
            uploadedNetworks={uploadedNetworks}
            onReplayOnBatch={replayOnBatch}
            onSaved={(traceId, networkId, usable) => void onSaved(traceId, networkId, usable)}
            onLiveChange={setRecordLive}
            simulator={health?.simulator}
          />
        </div>
        {view === "check" && !flow.recording && (
          <div className="panel">
            <HomeView
              flow={flow}
              setFlow={setFlow}
              library={library}
              batches={batches}
              health={health}
              settings={settings}
              onSettings={setSettings}
              onRecord={record}
              onOpenReport={openReport}
              onOpenBatch={openBatch}
              onOpenSettings={() => setView("settings")}
            />
          </div>
        )}
        {view === "builds" && (
          <div className="panel">
            <BuildsView
              batches={batches}
              library={library}
              selected={batchId}
              onSelect={setBatchId}
              onOpenReport={openReport}
              onRecord={beginWith}
              canDelete={canDelete}
            />
          </div>
        )}
        {view === "traces" && (
          <div className="panel">
            <TracesView library={library} onOpenReport={openReport} onRecord={() => setView("check")} canDelete={canDelete} />
          </div>
        )}
        {view === "reports" && (
          <div className="panel">
            <ReportsView library={library} selected={reportDir} onSelect={setReportDir} canDelete={canDelete} />
          </div>
        )}
        {view === "settings" && (
          <div className="panel">
            <SettingsView
              settings={settings}
              onSettings={setSettings}
              health={health}
              onInstall={install}
              onTour={() => setTour(true)}
              teamUrl={teamUrl}
              onCleaned={() => {
                void library.refresh();
                void batches.refresh();
              }}
            />
          </div>
        )}
        {view === "help" && (
          <div className="panel">
            <HelpView
              onTour={() => setTour(true)}
              onStart={() => {
                setView("check");
                if (!recordLive) {
                  setFlow(EMPTY_FLOW);
                }
              }}
            />
          </div>
        )}
      </div>

      {askName && !tour && <NameDialog onClose={() => setAskName(false)} />}
      {setup && !tour && !askName && health && <SetupDialog health={health} onInstall={install} onClose={() => setSetup(false)} />}
      {tour && (
        <Tour
          onClose={() => setTour(false)}
          onSample={() => beginWith("sample-tap", t("upload.sampleName"), null)}
        />
      )}
      {presentDir && <Present dir={presentDir} onClose={() => setPresentDir(null)} />}
      <Mascot
        base={mascotBase}
        hint={hint}
        guide={guide}
        explain={explain}
        actions={mascotActions}
        ask={askHelp}
        onOpenHelp={openHelp}
      />
    </div>
  );
};
