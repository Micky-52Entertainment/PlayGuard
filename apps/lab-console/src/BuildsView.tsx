import { useEffect, useRef, useState } from "react";
import { MickeyArt } from "./MickeyArt";
import { api } from "./api";
import { ConfirmDialog } from "./Dialogs";
import { ProblemBox, explainCode, explainError } from "./errors";
import { fromDrop, fromInput, prepare } from "./upload";
import type { PickedFile } from "./upload";
import { Hint } from "./Hint";
import { checkTitle, useI18n } from "./i18n";
import type { Key } from "./i18n";
import { VERDICT_GLYPH, batchBusy, batchProgress, batchUnfinished, formatSize, timeLeft, when } from "./library";
import type { Batch, BatchBuild, BatchCheck, BatchesState, LibraryState, Verdict } from "./library";
import { ShowMore, usePaged } from "./paging";

const GLYPH: Record<BatchCheck["status"], string> = { pass: "✓", warn: "!", fail: "✕", info: "i", skip: "–" };
const RANK: Record<BatchCheck["status"], number> = { fail: 3, warn: 2, pass: 1, info: 0, skip: 0 };

// One column per question QA asks about a build; several checks can feed one column.
const COLUMNS: Array<{ id: string; ids: string[] }> = [
  { id: "size", ids: ["size"] },
  {
    id: "package",
    ids: ["packaging", "single-file", "external-refs", "cta-source", "required-source", "discouraged-source", "viewport-meta"],
  },
  { id: "loads", ids: ["load"] },
  { id: "errors", ids: ["js-errors"] },
  { id: "renders", ids: ["render"] },
  { id: "requests", ids: ["network"] },
  { id: "cta", ids: ["cta", "lifecycle", "store-link", "store-source"] },
  { id: "apis", ids: ["browser-apis"] },
  { id: "sound", ids: ["sound-start", "sound-hidden"] },
  { id: "rotate", ids: ["rotate"] },
  { id: "stress", ids: ["idle", "monkey", "memory"] },
];

const worst = (checks: BatchCheck[]): BatchCheck | null => {
  let pick: BatchCheck | null = null;
  for (let i = 0; i < checks.length; i += 1) {
    if (!pick || RANK[checks[i].status] > RANK[pick.status]) {
      pick = checks[i];
    }
  }
  return pick;
};

const Cell = ({ build, ids }: { build: BatchBuild; ids: string[] }) => {
  const { t, lang } = useI18n();
  const checks = build.checks.filter((check) => ids.includes(check.id));
  const pick = worst(checks);
  if (!pick) {
    return build.state === "done" || build.state === "failed" ? <span className="dim">—</span> : <span className="dim">·</span>;
  }
  const notes = checks
    .filter((check) => check.status === pick.status)
    .map((check) => `${checkTitle(t, lang, check)}: ${check.message}`)
    .join("\n");
  return (
    <span className={`mark ${pick.status}`} title={notes}>
      {GLYPH[pick.status]}
    </span>
  );
};

export const tally = (batch: Batch): Record<Verdict, number> & { pending: number; broken: number } => {
  const out = { pass: 0, warn: 0, fail: 0, pending: 0, broken: 0 };
  for (let i = 0; i < batch.builds.length; i += 1) {
    const build = batch.builds[i];
    if (build.state === "done" && build.verdict) {
      out[build.verdict] += 1;
    } else if (build.state === "queued" || build.state === "running") {
      out.pending += 1;
    } else if (build.state !== "skipped") {
      out.broken += 1;
    }
  }
  return out;
};

interface BuildsViewProps {
  batches: BatchesState;
  library: LibraryState;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenReport: (dir: string) => void;
  /** Play a build once, so its recording can be replayed on the whole batch. */
  onRecord: (playableId: string, name: string, batchId: string) => void;
  canDelete: boolean;
}

/** One archive in, every network's build tested, one table of what works. */
export const BuildsView = ({ batches, library, selected, onSelect, onOpenReport, onRecord, canDelete }: BuildsViewProps) => {
  const [confirm, setConfirm] = useState(false);
  const { t, lang } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [traceId, setTraceId] = useState("");
  const [odd, setOdd] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const current = batches.batches.find((batch) => batch.id === selected) || batches.batches[0];
  const page = usePaged(batches.batches, undefined, current ? batches.batches.indexOf(current) : -1);
  const usable = library.traces.filter((trace) => trace.usable);

  useEffect(() => {
    if (current) {
      setTraceId(current.traceId || "");
    }
  }, [current?.id, current?.traceId]);

  const send = async (picked: PickedFile[]): Promise<void> => {
    if (picked.length === 0) {
      return;
    }
    setOdd(null);
    const upload = await prepare(picked, true);
    if (upload.kind !== "archive") {
      setOdd(upload.kind === "unsupported" ? upload.name : null);
      return;
    }
    const batch = await batches.upload(upload.file, traceId || null);
    if (batch) {
      onSelect(batch.id);
    }
  };

  const counts = current ? tally(current) : null;
  const busy = current ? batchBusy(current) : false;
  const progress = current && busy ? batchProgress(current) : null;
  const left = current && progress ? timeLeft(t, current.runStartedAt || current.createdAt, progress.done, progress.total) : null;
  const problems = (build: BatchBuild): BatchCheck[] =>
    build.checks.filter((check) => check.status === "fail" || check.status === "warn");

  return (
    <div
      className={`view ${dragging ? "dropping" : ""}`}
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
      <header className="topbar">
        <h1>{t("nav.builds")}</h1>
        {!current && <span className="subtitle">{t("builds.subtitle")}</span>}
        {current && counts && (
          <span className="dim">
            {t("builds.count", { n: current.builds.length })} · {t("builds.tally", counts)}
            {progress
              ? ` · ${t("builds.progress", { done: current.builds.length - counts.pending, total: current.builds.length })}${left ? ` · ${left}` : ""}`
              : ""}
          </span>
        )}
        <label className="field inline-field push">
          <span>
            {t("builds.input")} <Hint text={t("hint.input")} />
          </span>
          <select value={traceId} onChange={(event) => setTraceId(event.target.value)}>
            <option value="">{t("builds.loadOnly")}</option>
            {usable.map((trace) => (
              <option key={trace.id} value={trace.id}>
                {trace.playable} · {when(trace.startedAt, t, lang)} · {t("common.touches", { n: trace.touches })}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <button
            className="danger"
            disabled={busy || !canDelete}
            title={canDelete ? undefined : t("settings.hostOnly")}
            onClick={() => setConfirm(true)}
          >
            {t("common.delete")}
          </button>
        )}
        {current && batchUnfinished(current) > 0 && (
          <button className="primary" title={t("resume.builds", { n: batchUnfinished(current) })} onClick={() => void batches.resume(current.id)}>
            {t("resume.finish")}
          </button>
        )}
        {current && (
          <button disabled={busy} onClick={() =>
              void batches.rerun(current.id, traceId || null, traceId && traceId === current.traceId ? current.alsoTraceIds : undefined)
            }>
            {traceId ? t("builds.replayAll") : t("checks.again")}
          </button>
        )}
        {current && (
          <a
            className="button"
            href={`/api/batches/${encodeURIComponent(current.id)}/sheet?lang=${lang}`}
            target="_blank"
            rel="noreferrer"
            title={t("builds.sheet.tip")}
          >
            {t("builds.sheet")}
          </a>
        )}
        {current && (
          <a
            className="button"
            href={`/api/batches/${encodeURIComponent(current.id)}/pack?lang=${lang}`}
            title={t("pack.tip")}
          >
            {t("pack.button")}
          </a>
        )}
        <button className="primary" disabled={batches.uploading} onClick={() => fileInput.current?.click()}>
          {batches.uploading ? t("common.uploading") : t("builds.upload")}
        </button>
        <button disabled={batches.uploading} onClick={() => folderInput.current?.click()}>
          {t("upload.folder")}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".zip,.html,.htm,application/zip,text/html"
          hidden
          onChange={(event) => {
            void send(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
        <input
          ref={(element) => {
            folderInput.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          onChange={(event) => {
            void send(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
      </header>

      {progress && (
        <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.done / progress.total) * 100)}>
          <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
      {batches.error && <ProblemBox problem={explainError(t, batches.error)} banner />}
      {confirm && current && (
        <ConfirmDialog
          title={t("confirm.batch.title")}
          text={t("confirm.batch.text", { name: current.name, n: current.builds.length })}
          action={t("common.delete")}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void api(`/api/batches/${encodeURIComponent(current.id)}`, { method: "DELETE" }).then(
              () => Promise.all([batches.refresh(), library.refresh()]),
              () => batches.refresh()
            );
          }}
        />
      )}
      {odd !== null && (
        <ProblemBox
          problem={explainCode(t, /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i.test(odd) ? "OTHER_ARCHIVE" : "BAD_FILE", odd || undefined)}
          banner
        />
      )}

      {batches.loaded && batches.batches.length === 0 ? (
        <div className="scroll">
          <div className="empty drop">
            <MickeyArt state="busy" size={120} className="empty-mickey" />
            <p className="empty-title">{t("builds.empty.title")}</p>
            <p className="hint">{t("builds.empty.hint")}</p>
            <button className="primary" onClick={() => fileInput.current?.click()}>
              {t("builds.choose")}
            </button>
          </div>
        </div>
      ) : (
        <div className="reports">
          <ul className="report-list">
            {page.shown.map((batch) => {
              const c = tally(batch);
              const state: Verdict | null = c.pending > 0 ? null : c.fail + c.broken > 0 ? "fail" : c.warn > 0 ? "warn" : "pass";
              return (
                <li key={batch.id}>
                  <button
                    className={current?.id === batch.id ? "on" : ""}
                    aria-current={current?.id === batch.id ? "true" : undefined}
                    onClick={() => onSelect(batch.id)}
                  >
                    {state ? <span className={`mark ${state}`}>{VERDICT_GLYPH[state]}</span> : <span className="spinner" />}
                    <span className="report-text">
                      <b>{batch.name}</b>
                      <span className="sub">
                        {when(batch.createdAt, t, lang)} · {t("builds.count", { n: batch.builds.length })}
                        {batch.by ? ` · ${batch.by}` : ""}
                      </span>
                      <span className="sub">
                        {c.pending > 0
                          ? t("builds.testing", { n: c.pending })
                          : t("builds.tally", { ...c, fail: c.fail + c.broken })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {page.left > 0 && (
              <li>
                <ShowMore left={page.left} onClick={page.showMore} />
              </li>
            )}
          </ul>

          {current && (
            <div className="scroll">
              <table className="table builds">
                <thead>
                  <tr>
                    <th>{t("record.network")}</th>
                    <th>{t("builds.build")}</th>
                    {COLUMNS.map((column) => (
                      <th key={column.id} className="center">
                        {t(`col.${column.id}` as Key)} <Hint text={t(`col.${column.id}.tip` as Key)} />
                      </th>
                    ))}
                    <th>{t("common.verdict")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {current.builds.map((build) => (
                    <tr key={build.id}>
                      <td>
                        <b>{build.network ? build.network.name : t("builds.unknown")}</b>
                        <div className="sub">
                          {!build.network
                            ? t("builds.nameIt")
                            : !build.network.known
                              ? t("builds.noProfile")
                              : build.networkBy === "content"
                                ? t("builds.byCall")
                                : t("builds.byName")}
                        </div>
                      </td>
                      <td>
                        {build.name}
                        <div className="sub">
                          {build.kind === "zip" ? "zip" : t("builds.singleHtml")} · {formatSize(build.bytes)}
                        </div>
                        {(build.state === "done" || build.state === "failed") &&
                          problems(build).map((check) => (
                            <div key={check.id} className={`problem ${check.status}`}>
                              {checkTitle(t, lang, check)}: {check.message}
                            </div>
                          ))}
                        {build.error && (
                          <div className="problem fail" title={build.error}>
                            {t("checks.didNotFinish")}
                          </div>
                        )}
                      </td>
                      {COLUMNS.map((column) => (
                        <td key={column.id} className="center">
                          <Cell build={build} ids={column.ids} />
                        </td>
                      ))}
                      <td>
                        {build.state === "running" && (
                          <span className="running">
                            <span className="spinner" />{" "}
                            {build.progress && build.progress.total
                              ? t("progress.screens", build.progress)
                              : t("builds.testingOne")}
                          </span>
                        )}
                        {build.state === "queued" && <span className="dim">{t("builds.queued")}</span>}
                        {build.state === "interrupted" && <span className="dim">{t("builds.interrupted")}</span>}
                        {build.state === "skipped" && <span className="dim" title={t("builds.skipped.tip")}>{t("builds.skipped")}</span>}
                        {build.state === "failed" && (
                          <span className="verdict fail">
                            <span className="mark fail">✕</span>
                            {t("builds.didNotRun")}
                          </span>
                        )}
                        {build.state === "done" && build.verdict && (
                          <span className={`verdict ${build.verdict}`}>
                            <span className={`mark ${build.verdict}`}>{VERDICT_GLYPH[build.verdict]}</span>
                            {t(`verdict.${build.verdict}` as Key)}
                          </span>
                        )}
                        {build.screens && (
                          <div className="sub">
                            {t("common.screensClean", {
                              n: build.screens.pass,
                              total: build.screens.pass + build.screens.warn + build.screens.fail,
                            })}
                          </div>
                        )}
                      </td>
                      <td className="row-actions">
                        {build.reportDir && (
                          <button onClick={() => onOpenReport(build.reportDir!)}>{t("common.report")}</button>
                        )}
                        <button
                          className="ghost"
                          title={t("builds.play.tip")}
                          onClick={() => onRecord(`${current.id}_${build.id}`, build.name, current.id)}
                        >
                          {t("builds.play")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint pad">{current.traceId ? t("builds.note.replay") : t("builds.note.load")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
