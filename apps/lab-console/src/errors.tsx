import { ApiError } from "./api";
import type { Key, Translate } from "./i18n";
import { useI18n } from "./i18n";

export interface Problem {
  /** What happened, in plain words. */
  title: string;
  /** What to do about it. */
  advice: string;
  /** The technical text, for whoever is asked to help. */
  details?: string;
}

const KNOWN = [
  "HUB_DOWN",
  "PLAYABLE_NOT_FOUND",
  "NO_BUILDS",
  "BAD_ARCHIVE",
  "BAD_FILE",
  "OTHER_ARCHIVE",
  "EMPTY_FILE",
  "TRACE_NOT_FOUND",
  "AI_KEY_MISSING",
  "AI_KEY_INVALID",
  "AI_NO_CREDIT",
  "AI_UNREACHABLE",
  "NO_BROWSER",
  "FILE_GONE",
  "JOB_FAILED",
  "LOCAL_ONLY",
  "SIMULATOR_FAILED",
  "SESSION_NOT_FOUND",
  "UNKNOWN",
] as const;

type Code = (typeof KNOWN)[number];

const problem = (t: Translate, code: string, details?: string): Problem => {
  const known: Code = (KNOWN as readonly string[]).includes(code) ? (code as Code) : "UNKNOWN";
  return {
    title: t(`error.${known}.title` as Key),
    advice: t(`error.${known}.advice` as Key),
    details,
  };
};

/** A failed request to the hub, explained. */
export const explainError = (t: Translate, error: unknown): Problem =>
  error instanceof ApiError
    ? problem(t, error.code, error.code === "HUB_DOWN" ? undefined : error.message)
    : problem(t, "UNKNOWN", error instanceof Error ? error.message : String(error));

export const explainCode = (t: Translate, code: string, details?: string): Problem => problem(t, code, details);

/** The last words of a check run that died, explained. */
export const explainJob = (t: Translate, raw: string | undefined): Problem => {
  const text = raw || "";
  let code: Code = "JOB_FAILED";
  if (/Executable doesn't exist|browserType\.launch|Chromium distribution/i.test(text)) {
    code = "NO_BROWSER";
  } else if (/AI could not be reached|No API key|API_KEY/i.test(text)) {
    code = /401|invalid.*key|authentication|unauthorized/i.test(text)
      ? "AI_KEY_INVALID"
      : /credit|quota|billing|429/i.test(text)
        ? "AI_NO_CREDIT"
        : /API_KEY|No API key|apiKey/i.test(text)
          ? "AI_KEY_MISSING"
          : "AI_UNREACHABLE";
  } else if (/ENOENT|is not in playables|no such file/i.test(text)) {
    code = "FILE_GONE";
  }
  return problem(t, code, text || undefined);
};

interface ProblemBoxProps {
  problem: Problem;
  /** Shown as a full-width strip under the top bar instead of a card. */
  banner?: boolean;
  children?: React.ReactNode;
}

export const ProblemBox = ({ problem: item, banner, children }: ProblemBoxProps) => {
  const { t } = useI18n();
  return (
    <div className={banner ? "banner problem-box" : "notice danger problem-box"} role="alert">
      <b>{item.title}</b>
      <span>{item.advice}</span>
      {item.details && (
        <details>
          <summary>{t("error.details")}</summary>
          <code>{item.details}</code>
        </details>
      )}
      {children && <div className="problem-actions">{children}</div>}
    </div>
  );
};
