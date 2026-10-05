import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import type { Key } from "./i18n";
import { mascotHidden, onMascotSay, setMascotHidden } from "./mascotBus";
import type { MascotLine, Pose } from "./mascotBus";
import { EffectArt, MickeyPicture, scenesOnScreen } from "./MickeyArt";

const TIPS = 6;
/** Quiet for this long on the same screen, and Micky suggests the next step. */
const IDLE_MS = 20000;
/** Nobody has touched the page for this long: Micky dozes off until someone does. */
const NAP_MS = 180000;

const pictureOf = (pose: Pose, step: number): string =>
  `/mascot/${pose === "walk" ? (step % 2 === 0 ? "walk1" : "walk2") : pose}.webp`;

export interface MascotAction {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}

export interface MascotExplain {
  /** The one thing that matters most in the result, in plain words. */
  title: string;
  text: string;
  /** What to do about it. */
  advice?: string;
}

export interface MascotAnswer {
  text: string;
  /** The Help section it comes from, to open for more. */
  section?: string;
}

interface MascotProps {
  base: MascotLine;
  /** The next step on this screen, said when the person seems stuck. */
  hint?: { key: string; text: string } | null;
  /** First check: the button to press now, lit up on the page. */
  guide?: { target: string; text: string } | null;
  /** On a result: what went wrong and what to do. */
  explain?: MascotExplain | null;
  actions: MascotAction[];
  ask: (question: string) => MascotAnswer | null;
  onOpenHelp: (section?: string) => void;
}

/**
 * Micky, in the bottom right corner. Shows at a glance what the lab is doing,
 * suggests the next step when someone is stuck, explains a result, answers
 * questions from Help, and keeps the most used actions one click away.
 */
export const Mascot = ({ base, hint, guide, explain, actions, ask, onOpenHelp }: MascotProps) => {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(mascotHidden);
  const [line, setLine] = useState<MascotLine | null>(null);
  const [step, setStep] = useState(0);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<MascotAnswer | "none" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tip = useRef(0);
  const panel = useRef<HTMLDivElement | null>(null);
  const [scenes, setScenes] = useState(scenesOnScreen);
  const [asleep, setAsleep] = useState(false);

  useEffect(() => {
    const sync = (): void => setScenes(scenesOnScreen());
    window.addEventListener("playguard:mickey-scene", sync);
    return () => window.removeEventListener("playguard:mickey-scene", sync);
  }, []);

  useEffect(() => {
    let nap: ReturnType<typeof setTimeout>;
    const wake = (): void => {
      setAsleep(false);
      clearTimeout(nap);
      nap = setTimeout(() => setAsleep(true), NAP_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel"];
    events.forEach((name) => window.addEventListener(name, wake, { passive: true }));
    wake();
    return () => {
      clearTimeout(nap);
      events.forEach((name) => window.removeEventListener(name, wake));
    };
  }, []);

  useEffect(() => {
    const sync = (): void => setHidden(mascotHidden());
    window.addEventListener("playguard:mascot-visibility", sync);
    return () => window.removeEventListener("playguard:mascot-visibility", sync);
  }, []);

  const show = (next: MascotLine): void => {
    clearTimeout(timer.current);
    setLine(next);
    timer.current = setTimeout(() => setLine(null), next.ms ?? 4500);
  };

  useEffect(() => onMascotSay(show), []);
  // "Ask Micky" elsewhere on the page opens this panel.
  useEffect(() => {
    const openPanel = (): void => {
      setAnswer(null);
      setOpen(true);
    };
    window.addEventListener("playguard:mascot-open", openPanel);
    return () => window.removeEventListener("playguard:mascot-open", openPanel);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Stuck on one screen: after a quiet while, the next step, once per screen.
  useEffect(() => {
    if (!hint || hidden) {
      return;
    }
    let quiet: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      clearTimeout(quiet);
      quiet = setTimeout(() => show({ pose: "point", text: hint.text, ms: 9000 }), IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "wheel"];
    events.forEach((name) => window.addEventListener(name, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(quiet);
      events.forEach((name) => window.removeEventListener(name, arm));
    };
  }, [hint?.key, hidden]);

  // First check: the button to press glows, and Micky says which one.
  useEffect(() => {
    if (!guide || hidden) {
      return;
    }
    let element: Element | null = null;
    const light = (): void => {
      element?.classList.remove("guide-glow");
      element = document.querySelector(`[data-guide="${guide.target}"]`);
      element?.classList.add("guide-glow");
    };
    const start = setTimeout(() => {
      light();
      show({ pose: "point", text: guide.text, ms: 8000 });
    }, 600);
    // The page may redraw the button: keep the light on the current one.
    const keep = setInterval(light, 1500);
    return () => {
      clearTimeout(start);
      clearInterval(keep);
      element?.classList.remove("guide-glow");
    };
  }, [guide?.target, hidden]);

  // The panel closes on a click elsewhere or Esc.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent): void => {
      if (panel.current && !panel.current.contains(event.target as Node) && !(event.target as Element).closest?.(".mascot-body")) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sleeping = asleep && !open && !line && base.pose === "idle";
  const current: MascotLine = open
    ? { pose: explain ? "think" : "idea" }
    : sleeping
      ? { pose: "sleep" }
      : line || (hover && base.pose === "idle" ? { pose: "wink" } : base);
  useEffect(() => {
    if (current.pose !== "walk") {
      return;
    }
    const walk = setInterval(() => setStep((value) => value + 1), 320);
    return () => clearInterval(walk);
  }, [current.pose]);

  if (hidden) {
    return null;
  }
  const text = open ? undefined : (line?.text ?? base.text);
  // A Micky in the page itself: this one steps aside, peeking from the edge.
  const peek = scenes > 0 && !open && !text && !hover;

  const submit = (): void => {
    const found = question.trim() ? ask(question) : null;
    setAnswer(found || "none");
  };

  return (
    <div className={`mascot pose-${current.pose}${peek ? " peek" : ""}${sleeping ? " asleep" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {open && (
        <div className="mascot-panel" ref={panel} role="dialog" aria-label={t("mascot.panel")}>
          {explain && (
            <section className="mascot-explain">
              <b>{explain.title}</b>
              <p>{explain.text}</p>
              {explain.advice && (
                <p className="mascot-advice">
                  <span aria-hidden="true">→ </span>
                  {explain.advice}
                </p>
              )}
            </section>
          )}
          <form
            className="mascot-ask"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              value={question}
              placeholder={t("mascot.ask")}
              aria-label={t("mascot.ask")}
              onChange={(event) => {
                setQuestion(event.target.value);
                setAnswer(null);
              }}
              autoFocus={!explain}
            />
            <button type="submit" className="primary" disabled={!question.trim()}>
              {t("mascot.askGo")}
            </button>
          </form>
          {answer === "none" && <p className="mascot-answer dim">{t("mascot.noAnswer")}</p>}
          {answer && answer !== "none" && (
            <div className="mascot-answer">
              <p>{answer.text}</p>
              <button className="linkish" onClick={() => onOpenHelp(answer.section)}>
                {t("mascot.moreHelp")}
              </button>
            </div>
          )}
          <div className="mascot-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.run();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
          <p className="mascot-tip dim">{t(`mascot.tip.${(tip.current % TIPS) + 1}` as Key)}</p>
        </div>
      )}
      {text && (
        <div className="mascot-bubble" role="status" key={text}>
          {text}
        </div>
      )}
      <button
        className="mascot-body"
        title={t("mascot.tip")}
        aria-label={t("mascot.tip")}
        aria-expanded={open}
        onClick={() => {
          tip.current += 1;
          setLine(null);
          setAnswer(null);
          setOpen((value) => !value);
        }}
      >
        <MickeyPicture
          key={peek ? "peek" : current.pose === "walk" ? "walk" : current.pose}
          src={peek ? "/mascot/peek.webp" : pictureOf(current.pose, step)}
        />
        {sleeping && !peek && <EffectArt effect="zzz" />}
      </button>
      <button
        className="mascot-hide"
        title={t("mascot.hide")}
        aria-label={t("mascot.hide")}
        onClick={() => {
          // A wave goodbye before he goes.
          show({ pose: "bye", ms: 900 });
          setTimeout(() => setMascotHidden(true), 800);
        }}
      >
        ×
      </button>
    </div>
  );
};

/** Kept so the browser keeps them decoded. */
const preloaded: HTMLImageElement[] = [];

/** Every picture loaded once up front, so a change of pose never blinks. */
export const preloadMascot = (): void => {
  if (preloaded.length > 0) {
    return;
  }
  [
    "idle", "talk", "laugh", "cheer", "wave", "ready", "sad", "think", "wink", "thumbs", "point", "shrug", "walk1", "walk2", "jump", "arms",
    "sleep", "phone", "magnify", "laptop", "run", "facepalm", "idea", "celebrate", "scared", "bye", "checklist", "tired", "peek", "ok", "trophy", "sweat",
  ].forEach(
    (name) => {
      const image = new Image();
      image.src = `/mascot/${name}.webp`;
      preloaded.push(image);
    }
  );
};

/**
 * The Help paragraph that best answers a question: the words of the question
 * found in it, counted by their first letters so that "отчёта" finds "отчёт".
 */
export const findAnswer = (question: string, sections: Array<{ id: string; title: string; body: string }>): MascotAnswer | null => {
  const stems = (text: string): string[] =>
    (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).map((word) => word.slice(0, Math.min(word.length, 5)));
  const wanted = Array.from(new Set(stems(question)));
  if (wanted.length === 0) {
    return null;
  }
  let best: { score: number; text: string; section: string } | null = null;
  for (const section of sections) {
    const paragraphs = section.body.split("\n\n");
    for (const paragraph of paragraphs) {
      const have = new Set(stems(`${section.title} ${paragraph}`));
      const score = wanted.filter((stem) => have.has(stem)).length + (stems(section.title).some((stem) => wanted.includes(stem)) ? 0.5 : 0);
      if (score > 0 && (!best || score > best.score)) {
        best = { score, text: paragraph.replace(/^• /gm, "· "), section: section.id };
      }
    }
  }
  return best ? { text: best.text, section: best.section } : null;
};
