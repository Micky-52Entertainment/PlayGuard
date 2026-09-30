import { useMemo, useState } from "react";
import { MickeyArt } from "./MickeyArt";
import { api } from "./api";
import { ConfirmDialog } from "./Dialogs";
import { explainJob } from "./errors";
import { Hint } from "./Hint";
import { useI18n } from "./i18n";
import type { Key } from "./i18n";
import { VERDICT_GLYPH, when } from "./library";
import type { LibraryState, TraceSummary } from "./library";
import { ShowMore, usePaged } from "./paging";
import { clock } from "./Timeline";

const ZONE_CLASS = { green: "pass", yellow: "warn", red: "fail" } as const;
const ZONE_GLYPH = { green: "✓", yellow: "!", red: "✕" } as const;

interface TracesViewProps {
  library: LibraryState;
  onOpenReport: (dir: string) => void;
  onRecord: () => void;
  canDelete: boolean;
}

const Status = ({ trace }: { trace: TraceSummary }) => {
  const { t } = useI18n();
  if (trace.job?.state === "running") {
    return (
      <span className="running">
        <span className="spinner" />{" "}
        {trace.job.progress && trace.job.progress.total ? t("progress.screens", trace.job.progress) : t("checks.checking")}
      </span>
    );
  }
  if (trace.job?.state === "failed") {
    const problem = explainJob(t, trace.job.error);
    return (
      <span className="verdict fail" title={`${problem.title} ${problem.advice}`}>
        <span className="mark fail">✕</span>
        {t("checks.didNotFinish")}
      </span>
    );
  }
  if (trace.report) {
    return (
      <span className={`verdict ${trace.report.status}`}>
        <span className={`mark ${trace.report.status}`}>{VERDICT_GLYPH[trace.report.status]}</span>
        {t(`verdict.${trace.report.status}` as Key)}
      </span>
    );
  }
  if (!trace.usable) {
    return (
      <span className="verdict skip" title={trace.problem || ""}>
        <span className="mark skip">–</span>
        {t("traces.unusable")}
      </span>
    );
  }
  return <span className="dim">{t("traces.notChecked")}</span>;
};

/** Every saved recording, with its verdict and the one next action. */
export const TracesView = ({ library, onOpenReport, onRecord, canDelete }: TracesViewProps) => {
  const { t, lang } = useI18n();
  const [doomed, setDoomed] = useState<TraceSummary | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle
        ? library.traces.filter(
            (trace) => trace.playable.toLowerCase().includes(needle) || trace.id.toLowerCase().includes(needle)
          )
        : library.traces,
    [library.traces, needle]
  );
  const page = usePaged(rows, needle);

  return (
    <div className="view">
      <header className="topbar">
        <h1>{t("nav.traces")}</h1>
        <span className="dim">{t("traces.saved", { n: library.traces.length })}</span>
        <span className="subtitle">{t("traces.subtitle")}</span>
        <input
          className="search"
          type="search"
          placeholder={t("traces.search")}
          aria-label={t("traces.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="actions push">
          <button className="primary" onClick={onRecord}>
            {t("traces.new")}
          </button>
        </div>
      </header>

      {doomed && (
        <ConfirmDialog
          title={t("confirm.trace.title")}
          text={t("confirm.trace.text", { name: doomed.playable })}
          action={t("common.delete")}
          onCancel={() => setDoomed(null)}
          onConfirm={() => {
            const id = doomed.id;
            setDoomed(null);
            void api(`/api/traces/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
              () => library.refresh(),
              () => library.refresh()
            );
          }}
        />
      )}
      <div className="scroll">
        {library.loaded && library.traces.length === 0 && (
          <div className="empty">
            <MickeyArt state="playing" size={120} className="empty-mickey" />
            <p className="empty-title">{t("traces.empty.title")}</p>
            <p className="hint">{t("traces.empty.hint")}</p>
            <button className="primary" onClick={onRecord}>
              {t("traces.new")}
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t("record.playable")}</th>
                <th>
                  {t("record.group")} <Hint text={t("hint.group")} />
                </th>
                <th>{t("traces.recorded")}</th>
                <th className="num">{t("traces.length")}</th>
                <th className="num">{t("facts.touches")}</th>
                <th>
                  {t("timeline.fps")} <Hint text={t("hint.fps")} />
                </th>
                <th>
                  {t("facts.store")} <Hint text={t("hint.store")} />
                </th>
                <th>{t("common.verdict")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.shown.map((trace) => (
                <tr key={trace.id}>
                  <td>
                    <b>{trace.playable}</b>
                    <div className="sub">{trace.by ? `${trace.by} · ` : ""}{trace.id}</div>
                  </td>
                  <td>
                    {trace.stepId
                      ? t(`step.${trace.stepId}` as Key) || trace.stepId
                      : t(trace.orientation === "landscape" ? "common.landscape" : "common.portrait")}
                  </td>
                  <td>{when(trace.startedAt, t, lang)}</td>
                  <td className="num">{clock(trace.durationMs)}</td>
                  <td className="num">{trace.touches}</td>
                  <td>
                    {trace.fps ? (
                      <span className="inline">
                        <span className={`mark ${ZONE_CLASS[trace.fps.zone]}`}>{ZONE_GLYPH[trace.fps.zone]}</span>
                        {trace.fps.average.toFixed(0)}
                      </span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>{trace.cta || <span className="dim">{t("traces.noStore")}</span>}</td>
                  <td>
                    <Status trace={trace} />
                  </td>
                  <td className="row-actions">
                    {trace.report && (
                      <button onClick={() => onOpenReport(trace.report!.dir)}>{t("common.openReport")}</button>
                    )}
                    {trace.usable && trace.job?.state !== "running" && (
                      <button className={trace.report ? "ghost" : ""} onClick={() => void library.runChecks(trace.id)}>
                        {trace.report ? t("checks.again") : t("checks.run")}
                      </button>
                    )}
                    {canDelete && trace.job?.state !== "running" && (
                      <button className="ghost icon-button" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => setDoomed(trace)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ShowMore left={page.left} onClick={page.showMore} />
        {library.traces.length > 0 && rows.length === 0 && (
          <p className="hint pad">{t("traces.noMatch", { query })}</p>
        )}
      </div>
    </div>
  );
};
