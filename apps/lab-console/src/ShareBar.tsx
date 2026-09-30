import { useState } from "react";
import { useI18n } from "./i18n";
import { Present } from "./Present";
import { briefUrl, downloadUrl, packUrl } from "./ReportsView";

/**
 * Who the result goes to, not which file format: each audience gets one
 * button and one line about what they will receive.
 */
export const ShareBar = ({ dir, url }: { dir: string; url: string }) => {
  const { t, lang } = useI18n();
  const [presenting, setPresenting] = useState(false);
  return (
    <div className="share" role="group" aria-label={t("share.title")}>
      {presenting && <Present dir={dir} onClose={() => setPresenting(false)} />}
      <span className="share-title">{t("share.title")}</span>
      <a className="share-item" href={briefUrl(dir, lang, true)} title={t("brief.tip")} data-guide="share">
        <b>{t("share.manager")}</b>
        <span>{t("share.manager.text")}</span>
      </a>
      <a className="share-item" href={packUrl(dir, lang)} title={t("pack.tip")}>
        <b>{t("share.client")}</b>
        <span>{t("share.client.text")}</span>
      </a>
      <a className="share-item" href={downloadUrl(dir)} title={t("reports.download.tip")}>
        <b>{t("share.dev")}</b>
        <span>{t("share.dev.text")}</span>
      </a>
      <button className="share-item present-button" title={t("present.tip")} onClick={() => setPresenting(true)}>
        <b>▶ {t("present.button")}</b>
        <span>{t("present.text")}</span>
      </button>
      <a className="share-link" href={url} target="_blank" rel="noreferrer">
        {t("reports.newTab")} ↗
      </a>
    </div>
  );
};
