import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { getName, setName } from "./identity";

interface ConfirmProps {
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Are you sure?" for anything that cannot be undone. */
export const ConfirmDialog = ({ title, text, action, onConfirm, onCancel }: ConfirmProps) => {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="setup-lead">{text}</p>
        <div className="modal-actions">
          <button className="ghost" autoFocus onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="danger" onClick={onConfirm}>
            {action}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Asks a new teammate for a name once, so the history shows who checked what. */
export const NameDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useI18n();
  const [value, setValue] = useState(getName());
  const save = (name: string): void => {
    setName(name);
    onClose();
  };
  return (
    <div className="modal-back">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("name.title")}
        onSubmit={(event) => {
          event.preventDefault();
          save(value);
        }}
      >
        <h2>{t("name.title")}</h2>
        <p className="setup-lead">{t("name.text")}</p>
        <input
          className="search name-input"
          autoFocus
          maxLength={60}
          placeholder={t("name.placeholder")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => save("")}>
            {t("name.skip")}
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            {t("name.save")}
          </button>
        </div>
      </form>
    </div>
  );
};
