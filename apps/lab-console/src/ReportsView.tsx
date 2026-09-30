import { useEffect, useState } from "react";
import { MickeyArt } from "./MickeyArt";
import { api } from "./api";
import { ConfirmDialog } from "./Dialogs";
import { ShareBar } from "./ShareBar";
import { ResultScreens, useScrub } from "./Screens";
import { useI18n } from "./i18n";
import type { Key, Translate } from "./i18n";
import { VERDICT_GLYPH } from "./library";
import type { LibraryState, ReportSummary } from "./library";
import { ShowMore, usePaged } from "./paging";

interface ReportsViewProps {
  library: LibraryState;
  selected: string | null;
  onSelect: (dir: string) => void;
  /** Deleting is for the computer that runs the lab. */
  canDelete: boolean;
}

/** How the playable was played in this run. */
export const reportKind = (t: Translate, report: ReportSummary): string =>
  report.stepId
    ? t(`step.${report.stepId}` as Key) || report.stepId
    : report.ai
      ? t("reports.ai", { name: report.ai })
      : t("reports.loadOnly");

export const downloadUrl = (dir: string): string => `/api/reports/${encodeURIComponent(dir)}/download`;

/** Videos, every screen and the networks, zipped for a client. */
export const packUrl = (dir: string, lang: string): string =>
  `/api/reports/${encodeURIComponent(dir)}/pack?lang=${lang}`;

/** The one-page summary for a manager; `download` saves it as a file instead of opening it. */
export const briefUrl = (dir: string, lang: string, download: boolean): string =>
  `/api/reports/${encodeURIComponent(dir)}/brief?lang=${lang}${download ? "&download=1" : ""}`;

/** Replay reports: the list on the left, the chosen report itself on the right. */
export const ReportsView = ({ library, selected, onSelect, canDelete }: ReportsViewProps) => {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const scrub = useScrub();
  const current = library.reports.find((report) => report.dir === selected) || library.reports[0];
  const page = usePaged(library.reports, undefined, current ? library.reports.indexOf(current) : -1);

  useEffect(() => {
    if (!selected && library.reports[0]) {
      onSelect(library.reports[0].dir);
    }
  }, [selected, library.reports, onSelect]);

  return (
    <div className="view">
      <header className="topbar">
        <h1>{t("nav.reports")}</h1>
        <span className="dim">{t("reports.count", { n: library.reports.length })}</span>
        <span className="subtitle">{t("reports.subtitle")}</span>
        {current && (
          <div className="actions push">
            <button
              className="danger"
              disabled={!canDelete}
              title={canDelete ? undefined : t("settings.hostOnly")}
              onClick={() => setConfirm(true)}
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </header>
      {current && <ShareBar dir={current.dir} url={current.url} />}
      {scrub.node}
      {confirm && current && (
        <ConfirmDialog
          title={t("confirm.report.title")}
          text={t("confirm.report.text", { name: current.playable })}
          action={t("common.delete")}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void api(`/api/reports/${encodeURIComponent(current.dir)}`, { method: "DELETE" }).then(
              () => library.refresh(),
              () => library.refresh()
            );
          }}
        />
      )}

      {library.loaded && library.reports.length === 0 ? (
        <div className="scroll">
          <div className="empty">
            <MickeyArt state="searching" size={120} className="empty-mickey" />
            <p className="empty-title">{t("reports.empty.title")}</p>
            <p className="hint">{t("reports.empty.hint")}</p>
          </div>
        </div>
      ) : (
        <div className="reports">
          <ul className="report-list">
            {page.shown.map((report) => (
              <li key={report.dir}>
                <button
                  className={current?.dir === report.dir ? "on" : ""}
                  aria-current={current?.dir === report.dir ? "true" : undefined}
                  onClick={() => onSelect(report.dir)}
                  onMouseEnter={(event) => scrub.start(report.dir, event)}
                  onMouseMove={scrub.move}
                  onMouseLeave={scrub.stop}
                >
                  <span className={`mark ${report.status}`}>{VERDICT_GLYPH[report.status]}</span>
                  <span className="report-text">
                    <b>{report.playable}</b>
                    <span className="sub">
                      {reportKind(t, report)}
                      {report.network ? ` · ${report.network}` : ""}
                      {report.by ? ` · ${report.by}` : ""}
                    </span>
                    <span className="sub">
                      {report.generatedAt} · {t(`verdict.${report.status}` as Key)} ·{" "}
                      {t("common.screensClean", {
                        n: report.screens.pass,
                        total: report.screens.pass + report.screens.warn + report.screens.fail,
                      })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {page.left > 0 && (
              <li>
                <ShowMore left={page.left} onClick={page.showMore} />
              </li>
            )}
          </ul>
          {current && (
            <div className="report-side">
              <ResultScreens
                dir={current.dir}
                onOpen={(runId) => setAnchor(`${runId}-${Date.now()}`)}
                onChanged={() => {
                  setReloads((value) => value + 1);
                  void library.refresh();
                }}
              />
              <iframe
                key={`${current.dir}-${reloads}`}
                className="report-frame"
                title={current.playable}
                src={anchor ? `${current.url}#${anchor.replace(/-\d+$/, "")}` : current.url}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
