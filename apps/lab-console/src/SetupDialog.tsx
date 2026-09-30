import { useState } from "react";
import type { Health } from "./api";
import { useI18n } from "./i18n";
import type { Key } from "./i18n";

const LATER_KEY = "playable-lab.setup-later";

/** What the operator already answered "not now" to: the same list is not asked about twice. */
export const setupPostponed = (missing: string[]): boolean => {
  try {
    return localStorage.getItem(LATER_KEY) === missing.join(",");
  } catch {
    return false;
  }
};

const postpone = (missing: string[]): void => {
  try {
    localStorage.setItem(LATER_KEY, missing.join(","));
  } catch {
    // Asked again next time; nothing else is lost.
  }
};

interface SetupDialogProps {
  health: Health;
  onInstall: () => void;
  onClose: () => void;
}

/**
 * Says what has to be downloaded and why, asks once, then shows the download.
 * Nothing is fetched before the operator agrees.
 */
export const SetupDialog = ({ health, onInstall, onClose }: SetupDialogProps) => {
  const { t } = useI18n();
  // The list as it was when the dialog opened: items leave `health.missing` one by one as they arrive.
  const [wanted] = useState(health.missing);
  const [size] = useState(health.downloadMb);
  const running = health.install.state === "running";
  const failed = health.install.state === "failed";
  const done = !running && !failed && health.missing.length === 0;
  const later = (): void => {
    postpone(health.missing);
    onClose();
  };

  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("setup.title")}>
        <h2>{t("setup.title")}</h2>
        {done ? (
          <p className="setup-done">{t("setup.done")}</p>
        ) : (
          <>
            <p className="setup-lead">{t("setup.lead")}</p>
            <ul className="setup-list">
              {wanted.map((item) => (
                <li key={item}>
                  <span className={`mark ${health.missing.includes(item) ? "skip" : "pass"}`}>
                    {health.missing.includes(item) ? "↓" : "✓"}
                  </span>
                  <span>
                    <b>{t(`setup.item.${item}` as Key)}</b>
                    <span className="sub">{t(`setup.item.${item}.why` as Key)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint">{t("setup.size", { mb: size })}</p>
          </>
        )}
        {running && (
          <>
            <div
              className={`bar ${health.install.percent === undefined ? "unknown" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={health.install.percent || 0}
            >
              <span style={{ width: `${health.install.percent || 0}%` }} />
            </div>
            <p className="hint" role="status">
              {health.install.step
                ? t("setup.step", { name: health.install.step, percent: health.install.percent || 0 })
                : t("setup.running")}
            </p>
          </>
        )}
        {failed && (
          <p className="hint warn-text" role="alert" title={health.install.error}>
            {t("health.installFailed")}
          </p>
        )}
        {!running && !done && <p className="hint">{t("setup.later.hint")}</p>}
        <div className="modal-actions">
          {done ? (
            <button className="primary" autoFocus onClick={onClose}>
              {t("setup.close")}
            </button>
          ) : (
            <>
              <button className="ghost" onClick={running ? onClose : later}>
                {running ? t("common.hide") : t("setup.later")}
              </button>
              <button className="primary" autoFocus disabled={running} onClick={onInstall}>
                {running ? t("health.installing") : t("setup.go")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
