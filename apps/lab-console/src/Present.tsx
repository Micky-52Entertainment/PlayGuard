import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";
import { MickeyArt } from "./MickeyArt";

type Status = "pass" | "warn" | "fail";
type Answer = "yes" | "partly" | "no" | "unknown";

interface PresentRun {
  id: string;
  status: Status;
  device: { name: string };
  orientation: string;
  cssWidth: number;
  cssHeight: number;
  scenario?: string;
  language?: string;
  old?: string;
  shots: Array<{ file: string; label: string }>;
  marks?: {
    shot: string;
    boxes: Array<{ x: number; y: number; w: number; h: number; issue: string }>;
    taps: Array<{ x: number; y: number }>;
  };
}

interface PresentReport {
  status: Status;
  generatedAt: string;
  playable: { name: string; bytes: number };
  network?: { name: string };
  runs: PresentRun[];
  stress?: PresentRun[];
  languages?: PresentRun[];
  oldPhones?: PresentRun[];
  summary?: {
    headline: string;
    orientations: Array<{ status: Status; label: string }>;
    rows: Array<{ id: string; question: string; answer: Answer; text: string; where?: string; items?: string[] }>;
  };
}

const GLYPH: Record<Status, string> = { pass: "✓", warn: "!", fail: "✕" };
const ANSWER_STATUS: Record<Answer, Status | "skip"> = { yes: "pass", partly: "warn", no: "fail", unknown: "skip" };

const megabytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** One screen's picture with its frames and tap dots, as the report draws them. */
const Screen = ({ dir, run, height }: { dir: string; run: PresentRun; height: number }) => {
  const shot = run.marks?.shot || (run.shots.find((item) => item.label === "final") || run.shots[run.shots.length - 1])?.file;
  const width = Math.round((height * run.cssWidth) / run.cssHeight);
  return (
    <span className={`present-screen ${run.status}`} style={{ width, height }}>
      {shot && <img src={`/reports/${encodeURIComponent(dir)}/${shot}`} alt="" />}
      {(run.marks?.boxes || []).map((box, index) => (
        <span
          key={`b${index}`}
          className={`mk-box ${box.issue}`}
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
        />
      ))}
      {(run.marks?.taps || []).map((tap, index) => (
        <span key={`t${index}`} className="mk-tap" style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}>
          {index + 1}
        </span>
      ))}
      <span className={`present-screen-mark mark ${run.status}`}>{GLYPH[run.status]}</span>
    </span>
  );
};

/**
 * The result for a call: full screen, large, one idea per slide. Arrows or a
 * click go on, Esc leaves. The verdict first, then the screens, then each
 * remark in plain words.
 */
export const Present = ({ dir, onClose }: { dir: string; onClose: () => void }) => {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<PresentReport | null>(null);
  const [slide, setSlide] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // The summary is worked out again in the language of the page.
    void Promise.all([
      fetch(`/reports/${encodeURIComponent(dir)}/report.json`).then((response) => (response.ok ? (response.json() as Promise<PresentReport>) : null)),
      fetch(`/api/reports/${encodeURIComponent(dir)}/summary?lang=${lang}`).then((response) => (response.ok ? response.json() : null), () => null),
    ]).then(
      ([data, summary]) => setReport(data ? { ...data, summary: (summary as PresentReport["summary"]) || data.summary } : null),
      () => setReport(null)
    );
  }, [dir, lang]);

  // Full screen when the browser allows it; the overlay alone works too.
  useEffect(() => {
    const element = root.current;
    void element?.requestFullscreen?.().catch(() => undefined);
    const onExit = (): void => {
      if (!document.fullscreenElement) {
        onClose();
      }
    };
    document.addEventListener("fullscreenchange", onExit);
    return () => {
      document.removeEventListener("fullscreenchange", onExit);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const rows = (report?.summary?.rows || []).filter((row) => row.answer === "no" || row.answer === "partly");
  const screens = report ? [...report.runs, ...(report.stress || []), ...(report.languages || []), ...(report.oldPhones || [])] : [];
  const total = 2 + rows.length + 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        setSlide((value) => Math.min(total - 1, value + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        setSlide((value) => Math.max(0, value - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const status: Status = report?.status || "warn";
  const clean = report ? report.runs.filter((run) => run.status === "pass").length : 0;
  const tall = typeof window !== "undefined" ? window.innerHeight : 800;

  let body: React.ReactNode = <p className="present-loading">…</p>;
  if (report) {
    if (slide === 0) {
      body = (
        <div className="present-title">
          <div className="present-hero">
            <span className={`present-verdict ${status}`}>{GLYPH[status]}</span>
            <MickeyArt state={status === "pass" ? "celebrate" : status === "warn" ? "worried" : "upset"} size={170} />
          </div>
          <h1>{report.summary?.headline || t(`verdict.${status}` as never)}</h1>
          <p className="present-name">{report.playable.name}</p>
          <div className="present-facts">
            <span>
              <b>{clean}</b> / {report.runs.length} {t("present.clean")}
            </span>
            {report.network && <span>{report.network.name}</span>}
            <span>{megabytes(report.playable.bytes)}</span>
          </div>
          <div className="present-orientations">
            {(report.summary?.orientations || []).map((item) => (
              <span key={item.label} className={`present-chip ${item.status}`}>
                {GLYPH[item.status]} {item.label}
              </span>
            ))}
          </div>
        </div>
      );
    } else if (slide === 1) {
      const size = Math.max(140, Math.min(360, tall * 0.34 - (screens.length > 8 ? 60 : 0)));
      body = (
        <div className="present-grid-slide">
          <h2>{t("present.screens")}</h2>
          <div className="present-grid">
            {screens.map((run) => (
              <figure key={run.id}>
                <Screen dir={dir} run={run} height={size} />
                <figcaption>
                  {run.old || (run.language ? run.language.toUpperCase() : run.device.name)}
                  <span>{run.cssWidth}×{run.cssHeight}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      );
    } else if (slide < total - 1) {
      const row = rows[slide - 2];
      const tone = ANSWER_STATUS[row.answer];
      body = (
        <div className="present-row">
          <span className={`present-verdict small ${tone}`}>{tone === "fail" ? "✕" : "!"}</span>
          <h2>{row.question}</h2>
          <p className="present-text">{row.text}</p>
          {row.where && <p className="present-where">{row.where}</p>}
          {row.items && (
            <ul>
              {row.items.slice(0, 6).map((item) => (
                <li key={item}>{item.trim()}</li>
              ))}
            </ul>
          )}
        </div>
      );
    } else {
      body = (
        <div className="present-title">
          <MickeyArt state={status === "pass" ? "proud" : status === "warn" ? "checklist" : "oops"} size={200} />
          <h1>{t(`present.end.${status}` as never)}</h1>
          <p className="present-name">{report.generatedAt}</p>
        </div>
      );
    }
  }

  return createPortal(
    <div
      className={`present ${status}`}
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t("present.button")}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        setSlide((value) => Math.min(total - 1, value + 1));
      }}
    >
      <div key={slide} className="present-slide">
        {body}
      </div>
      <div className="present-bar">
        <button className="ghost" disabled={slide === 0} onClick={() => setSlide((value) => Math.max(0, value - 1))}>
          ←
        </button>
        <span className="present-dots">
          {Array.from({ length: total }, (_, index) => (
            <i key={index} className={index === slide ? "on" : ""} />
          ))}
        </span>
        <button className="ghost" disabled={slide === total - 1} onClick={() => setSlide((value) => Math.min(total - 1, value + 1))}>
          →
        </button>
        <button className="ghost present-close" onClick={onClose}>
          {t("present.close")}
        </button>
      </div>
    </div>,
    document.body
  );
};
