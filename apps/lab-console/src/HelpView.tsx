import { useI18n } from "./i18n";
import { MickeyArt } from "./MickeyArt";
import type { Key } from "./i18n";
import { HelpArt } from "./HelpArt";

export const SECTIONS = ["start", "share", "archive", "phone", "verdicts", "team", "storage", "names"] as const;

/** Paragraphs split on blank lines; lines that start with "• " become a list. */
const Body = ({ text }: { text: string }) => (
  <>
    {text.split("\n\n").map((block) => {
      const lines = block.split("\n");
      return lines.every((line) => line.startsWith("• ")) ? (
        <ul key={block}>
          {lines.map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      ) : (
        <p key={block}>{block}</p>
      );
    })}
  </>
);

/** Answers to what a new teammate asks in the first week, in the words they would use. */
export const HelpView = ({ onTour, onStart }: { onTour: () => void; onStart: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="view">
      <header className="topbar">
        <h1>{t("nav.help")}</h1>
        <span className="subtitle">{t("help.lead")}</span>
        <div className="actions push">
          <button onClick={onTour}>{t("settings.tour")}</button>
          <button className="primary" onClick={onStart}>
            {t("help.start.go")}
          </button>
        </div>
      </header>
      <div className="scroll">
        <div className="helpdoc">
          <nav className="helpdoc-toc" aria-label={t("help.contents")}>
            {SECTIONS.map((id) => (
              <a key={id} href={`#help-${id}`}>
                {t(`help.${id}.title` as Key)}
              </a>
            ))}
            <button className="help-ask" onClick={() => window.dispatchEvent(new Event("playguard:mascot-open"))}>
              <MickeyArt state="idea" size={64} />
              <span>{t("help.askMicky")}</span>
            </button>
          </nav>
          <div className="helpdoc-body">
            {SECTIONS.map((id) => (
              <section key={id} id={`help-${id}`} className="help-section">
                <div>
                  <h2>{t(`help.${id}.title` as Key)}</h2>
                  <Body text={t(`help.${id}.body` as Key)} />
                </div>
                <HelpArt topic={id} />
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
