import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FpsZone } from "@playable-lab/checks";
import { ApiError, api, postJson } from "./api";
import type { QuickRun } from "./api";
import { getLang } from "./i18n";
import { getName } from "./identity";
import type { ScreenTile } from "./Screens";
import type { Lang, Translate } from "./i18n";

export type Verdict = "pass" | "warn" | "fail";

export interface ReportSummary {
  dir: string;
  url: string;
  generatedAt: string;
  status: Verdict;
  playable: string;
  network: string | null;
  sessionId: string | null;
  /** The other orientation's recording, checked together with this one. */
  also?: string[];
  /** Quick or full; null for checks made before depths existed. */
  depth?: "quick" | "full" | null;
  stepId: string | null;
  /** Who played, when the run was an AI autoplay. */
  ai?: string | null;
  /** Who ran the check. */
  by?: string | null;
  screens: Record<Verdict, number>;
}

export interface TraceSummary {
  id: string;
  playable: string;
  stepId: string | null;
  orientation: string;
  startedAt: number;
  durationMs: number;
  touches: number;
  cta: string | null;
  fps: { average: number; zone: FpsZone } | null;
  usable: boolean;
  problem: string | null;
  by?: string | null;
  report: ReportSummary | null;
  job: {
    state: "running" | "failed";
    startedAt: number;
    progress?: { done: number; total: number };
    screens?: ScreenTile[];
    error?: string;
    /** The folder the run wrote into: a failed run may be continued from it. */
    dir?: string;
  } | null;
  /** Its latest check stopped half-way and can be continued. */
  interrupted?: { dir: string; done: number; total: number | null };
}

/** A check that stopped before its report was written (the hub, the computer or the browser went down). */
export interface InterruptedCheck {
  dir: string;
  name: string;
  startedAt: number;
  done: number;
  total: number | null;
  by?: string;
  kind: "replay" | "load";
  traces: string[];
}

/** Continues an interrupted check where it stopped: the screens it finished stay. */
export const resumeCheck = (dir: string): Promise<QuickRun> =>
  postJson<QuickRun>(`/api/interrupted/${encodeURIComponent(dir)}/resume`, {});

/** Checks that can be continued, and archives with builds left unfinished. */
export const useInterrupted = (): { checks: InterruptedCheck[]; refresh: () => Promise<void> } => {
  const [checks, setChecks] = useState<InterruptedCheck[]>([]);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setChecks(await api<InterruptedCheck[]>("/api/interrupted"));
    } catch {
      // The hub is down; the page says so elsewhere.
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { checks, refresh };
};

export interface LibraryState {
  traces: TraceSummary[];
  reports: ReportSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Replays the trace on its step's screens; the report shows up in `reports`. */
  runChecks: (traceId: string, network?: string, also?: string[], depth?: "quick" | "full") => Promise<void>;
}

export const VERDICT_GLYPH: Record<Verdict, string> = { pass: "✓", warn: "!", fail: "✕" };

/** Saved traces and reports on the hub. Polls only while a replay is running. */
export const useLibrary = (): LibraryState => {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const busy = useRef(false);
  const lastText = useRef({ traces: "", reports: "" });

  const refresh = useCallback(async (): Promise<void> => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      const [traceRes, reportRes] = await Promise.all([fetch("/api/traces"), fetch("/api/reports")]);
      if (traceRes.ok && reportRes.ok) {
        const [traceText, reportText] = await Promise.all([traceRes.text(), reportRes.text()]);
        // A poll that brings the same list keeps the old array, so nothing that depends on it re-renders.
        if (traceText !== lastText.current.traces) {
          lastText.current.traces = traceText;
          setTraces(JSON.parse(traceText) as TraceSummary[]);
        }
        if (reportText !== lastText.current.reports) {
          lastText.current.reports = reportText;
          setReports(JSON.parse(reportText) as ReportSummary[]);
        }
        setLoaded(true);
      }
    } catch {
      // The hub is down; the record view already says so.
    } finally {
      busy.current = false;
    }
  }, []);

  const runChecks = useCallback(
    async (traceId: string, network?: string, also?: string[], depth?: "quick" | "full"): Promise<void> => {
      await fetch(`/api/traces/${encodeURIComponent(traceId)}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: network || "", also, depth, lang: getLang(), by: getName() }),
      });
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = useMemo(() => traces.some((trace) => trace.job?.state === "running"), [traces]);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  return { traces, reports, loaded, refresh, runChecks };
};

export const when = (ms: number, t: Translate, lang: Lang): string => {
  const date = new Date(ms);
  const today = new Date();
  const time = date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) {
    return `${t("common.today")} ${time}`;
  }
  return `${date.toLocaleDateString(lang, { day: "numeric", month: "short" })} ${time}`;
};

/** "about 2 min left", from how long the finished part took. Null until there is something to go on. */
export const timeLeft = (t: Translate, startedAt: number, done: number, total: number): string | null => {
  if (done <= 0 || total <= done) {
    return null;
  }
  const leftMs = ((Date.now() - startedAt) / done) * (total - done);
  return leftMs < 50000 ? t("progress.leftSoon") : t("progress.leftMin", { n: Math.max(1, Math.round(leftMs / 60000)) });
};

export interface BatchCheck {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail" | "info" | "skip";
  message: string;
  details?: string[];
}

export interface BatchBuild {
  id: string;
  name: string;
  kind: "html" | "zip";
  network: { id: string; name: string; known: boolean } | null;
  networkBy: "name" | "content" | null;
  bytes: number;
  /** "skipped": its network is turned off in Settings. */
  state: "queued" | "running" | "done" | "failed" | "interrupted" | "skipped";
  progress?: { done: number; total: number };
  /** The screens of the run while it goes on. */
  tiles?: ScreenTile[];
  error?: string;
  checks: BatchCheck[];
  verdict: Verdict | null;
  screens: Record<Verdict, number> | null;
  reportDir: string | null;
  reportUrl: string | null;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: number;
  traceId: string | null;
  alsoTraceIds?: string[];
  depth?: "quick" | "full";
  runStartedAt?: number;
  by?: string;
  builds: BatchBuild[];
}

export interface BatchesState {
  batches: Batch[];
  loaded: boolean;
  /** Why the last upload failed. */
  error: ApiError | null;
  uploading: boolean;
  refresh: () => Promise<void>;
  /** Sends an archive of builds; every build in it is tested. Resolves to the new batch. */
  upload: (file: File, traceId: string | null) => Promise<Batch | null>;
  /** Tests every build of a batch again, replaying `traceId` on each when given. */
  rerun: (batchId: string, traceId: string | null, also?: string[], depth?: "quick" | "full") => Promise<void>;
  /** Finishes a round of tests that was interrupted: only the unfinished builds run, from where they stopped. */
  resume: (batchId: string) => Promise<void>;
}

/** Builds an interrupted round left unfinished: they can be finished from where they stopped. */
export const batchUnfinished = (batch: Batch): number =>
  batchBusy(batch) ? 0 : batch.builds.filter((build) => build.state === "interrupted").length;

export const batchBusy = (batch: Batch): boolean =>
  batch.builds.some((build) => build.state === "queued" || build.state === "running");

/** The batch a playable id belongs to, when the playable is a build from an uploaded archive. */
export const batchOfPlayable = (playableId: string): string | null => {
  const match = /^(b_[a-z0-9]+_\d+)_\d+$/.exec(playableId);
  return match ? match[1] : null;
};

export const useBatches = (): BatchesState => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [uploading, setUploading] = useState(false);
  const lastText = useRef("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/batches");
      if (response.ok) {
        const text = await response.text();
        if (text !== lastText.current) {
          lastText.current = text;
          setBatches(JSON.parse(text) as Batch[]);
        }
        setLoaded(true);
      }
    } catch {
      // The hub is down; the record view already says so.
    }
  }, []);

  const upload = useCallback(
    async (file: File, traceId: string | null): Promise<Batch | null> => {
      setUploading(true);
      setError(null);
      try {
        const query = `name=${encodeURIComponent(file.name)}&lang=${getLang()}&by=${encodeURIComponent(getName())}${traceId ? `&trace=${encodeURIComponent(traceId)}` : ""}`;
        const batch = await api<Batch>(`/api/batches?${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: file,
        });
        await refresh();
        return batch;
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err)));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [refresh]
  );

  const rerun = useCallback(
    async (batchId: string, traceId: string | null, also?: string[], depth?: "quick" | "full"): Promise<void> => {
      try {
        await postJson(`/api/batches/${encodeURIComponent(batchId)}/run`, {
          traceId: traceId || "",
          also: also || [],
          depth,
          lang: getLang(),
          by: getName(),
        });
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err)));
      }
      await refresh();
    },
    [refresh]
  );

  const resume = useCallback(
    async (batchId: string): Promise<void> => {
      try {
        await postJson(`/api/batches/${encodeURIComponent(batchId)}/resume`, {});
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError("UNKNOWN", String(err)));
      }
      await refresh();
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = batches.some(batchBusy);
  useEffect(() => {
    if (!busy) {
      return;
    }
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  return { batches, loaded, error, uploading, refresh, resume, upload, rerun };
};

export const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/** Screens of a batch tested so far, counting the builds still running. */
export const batchProgress = (batch: Batch): { done: number; total: number } => {
  let done = 0;
  for (let i = 0; i < batch.builds.length; i += 1) {
    const build = batch.builds[i];
    if (build.state === "queued") {
      continue;
    }
    done += build.state === "running" ? (build.progress && build.progress.total ? build.progress.done / build.progress.total : 0) : 1;
  }
  return { done, total: batch.builds.length };
};
