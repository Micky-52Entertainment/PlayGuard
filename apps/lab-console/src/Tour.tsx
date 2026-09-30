import { useEffect, useState } from "react";
import { MickeyArt } from "./MickeyArt";
import { useI18n } from "./i18n";
import type { Key } from "./i18n";
import { StepArt } from "./StepArt";
import type { ArtStep } from "./StepArt";

const SEEN_KEY = "playable-lab.tour-seen";
// A welcome, then one card for each step of the wizard.
const SLIDES = 5;

export const tourSeen = (): boolean => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
};

const markSeen = (): void => {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: the tour shows again next time, nothing else is lost.
  }
};

/** A walk through the one path the lab has, a moving picture per step, shown on the first visit. */
export const Tour = ({ onClose, onSample }: { onClose: () => void; onSample: () => void }) => {
  const { t } = useI18n();
  const [slide, setSlide] = useState(1);
  const close = (): void => {
    markSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("tour.label")} onClick={(event) => event.stopPropagation()}>
        <span className="modal-step">
          {slide} / {SLIDES}
        </span>
        {/* Keyed by slide, so each one slides in rather than swapping in place. */}
        <div key={slide} className="tour-slide">
          {slide === 1 ? (
            <MickeyArt state="greet" size={112} className="tour-mickey" label="Micky" />
          ) : (
            <StepArt step={(slide - 1) as ArtStep} caption={false} />
          )}
          <h2>{t(`tour.${slide}.title` as Key)}</h2>
          <p>{t(`tour.${slide}.text` as Key)}</p>
        </div>
        <div className="modal-dots" aria-hidden="true">
          {Array.from({ length: SLIDES }, (_, index) => (
            <span key={index} className={index + 1 === slide ? "on" : ""} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={close}>
            {t("tour.skip")}
          </button>
          {slide > 1 && <button onClick={() => setSlide(slide - 1)}>{t("tour.back")}</button>}
          {slide < SLIDES ? (
            <button className="primary" autoFocus onClick={() => setSlide(slide + 1)}>
              {t("tour.next")}
            </button>
          ) : (
            <button
              className="primary"
              autoFocus
              onClick={() => {
                close();
                onSample();
              }}
            >
              {t("tour.sample")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
