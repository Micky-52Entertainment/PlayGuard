import { useEffect, useState } from "react";
import type { Pose } from "./mascotBus";

/**
 * Micky as part of a scene, not only in the corner: a pose, something drawn
 * around him, and a way of moving. The drawn things make states the picture
 * sheet does not have: celebrating in confetti, searching with a magnifier,
 * sweating over remarks, a rain cloud over a failure, asleep.
 */
export type Effect = "none" | "confetti" | "sparkle" | "sweat" | "rain" | "zzz" | "search" | "question" | "hearts";
export type Motion = "none" | "bounce" | "shake" | "float" | "breathe" | "sway" | "peek";

export interface MickeyState {
  pose: Pose;
  effect?: Effect;
  motion?: Motion;
  /** Looking the other way: pointing left, walking left. */
  flip?: boolean;
}

/** The states the site uses, each a pose with something around it. */
export const STATES = {
  greet: { pose: "wave", effect: "sparkle", motion: "sway" },
  celebrate: { pose: "celebrate", effect: "confetti", motion: "bounce" },
  proud: { pose: "trophy", effect: "sparkle", motion: "breathe" },
  worried: { pose: "sweat", motion: "breathe" },
  upset: { pose: "sad", effect: "rain", motion: "shake" },
  searching: { pose: "magnify", motion: "float" },
  wondering: { pose: "think", effect: "question", motion: "breathe" },
  sleeping: { pose: "sleep", effect: "zzz", motion: "breathe" },
  idea: { pose: "idea", effect: "sparkle", motion: "bounce" },
  busy: { pose: "laptop", motion: "breathe" },
  playing: { pose: "phone", motion: "breathe" },
  oops: { pose: "facepalm", motion: "shake" },
  scared: { pose: "scared", motion: "shake" },
  checklist: { pose: "checklist", motion: "breathe" },
  tired: { pose: "tired", effect: "zzz", motion: "breathe" },
  okay: { pose: "ok", effect: "sparkle", motion: "sway" },
  running: { pose: "run", motion: "bounce" },
  bye: { pose: "bye", motion: "sway" },
  pointLeft: { pose: "point", motion: "sway", flip: true },
  pointRight: { pose: "point", motion: "sway" },
  ready: { pose: "ready", motion: "breathe" },
  love: { pose: "laugh", effect: "hearts", motion: "bounce" },
  waiting: { pose: "idle", effect: "question", motion: "breathe" },
} satisfies Record<string, MickeyState>;

export type StateName = keyof typeof STATES;

const picture = (pose: Pose): string => `/mascot/${pose === "walk" ? "walk1" : pose}.webp`;

export const EffectArt = ({ effect }: { effect: Effect }) => {
  switch (effect) {
    case "confetti":
      return (
        <span className="mk-fx fx-confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <i key={index} style={{ ["--i" as string]: index }} />
          ))}
        </span>
      );
    case "sparkle":
      return (
        <span className="mk-fx fx-sparkle" aria-hidden="true">
          <i>✦</i>
          <i>✦</i>
          <i>✧</i>
        </span>
      );
    case "sweat":
      return (
        <svg className="mk-fx fx-sweat" viewBox="0 0 20 28" aria-hidden="true">
          <path d="M10 2C10 2 3 12 3 18a7 7 0 0 0 14 0C17 12 10 2 10 2z" fill="#8be9ff" stroke="#3b82f6" strokeWidth="1.5" />
          <path d="M7 18a3 3 0 0 0 3 3" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "rain":
      return (
        <span className="mk-fx fx-rain" aria-hidden="true">
          <svg viewBox="0 0 64 30">
            <path d="M16 26h34a10 10 0 0 0 0-20 14 14 0 0 0-26-2A11 11 0 0 0 16 26z" fill="#94a3b8" />
          </svg>
          <i />
          <i />
          <i />
        </span>
      );
    case "zzz":
      return (
        <span className="mk-fx fx-zzz" aria-hidden="true">
          <i>z</i>
          <i>z</i>
          <i>Z</i>
        </span>
      );
    case "search":
      return (
        <svg className="mk-fx fx-search" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="16" cy="16" r="10" fill="rgba(139,233,255,0.35)" stroke="#1e5bff" strokeWidth="4" />
          <path d="M24 24l11 11" stroke="#1e5bff" strokeWidth="6" strokeLinecap="round" />
          <path d="M11 12a6 6 0 0 1 5-3" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "question":
      return (
        <span className="mk-fx fx-question" aria-hidden="true">
          ?
        </span>
      );
    case "hearts":
      return (
        <span className="mk-fx fx-hearts" aria-hidden="true">
          <i>♥</i>
          <i>♥</i>
          <i>♥</i>
        </span>
      );
    default:
      return null;
  }
};

/**
 * Micky placed in the page. While one is on screen the corner Micky hides
 * behind the edge, so there are never two of him at once.
 */
export const MickeyArt = ({
  state,
  size = 120,
  className = "",
  label,
}: {
  state: StateName | MickeyState;
  size?: number;
  className?: string;
  /** Read aloud instead of hiding the picture from screen readers. */
  label?: string;
}) => {
  const look: MickeyState = typeof state === "string" ? STATES[state] : state;
  // Walking is two pictures in turn.
  const [stride, setStride] = useState(0);
  useEffect(() => {
    if (look.pose !== "walk") {
      return;
    }
    const walk = setInterval(() => setStride((value) => value + 1), 320);
    return () => clearInterval(walk);
  }, [look.pose]);
  useEffect(() => {
    const body = document.body;
    body.dataset.mickeyScenes = String(Number(body.dataset.mickeyScenes || 0) + 1);
    window.dispatchEvent(new Event("playguard:mickey-scene"));
    return () => {
      body.dataset.mickeyScenes = String(Math.max(0, Number(body.dataset.mickeyScenes || 1) - 1));
      window.dispatchEvent(new Event("playguard:mickey-scene"));
    };
  }, []);
  return (
    <span
      className={`mickey-art motion-${look.motion || "none"}${look.flip ? " flip" : ""} ${className}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <img key={look.pose} src={look.pose === "walk" ? `/mascot/walk${(stride % 2) + 1}.webp` : picture(look.pose)} alt="" draggable={false} />
      {look.effect && look.effect !== "none" && <EffectArt effect={look.effect} />}
    </span>
  );
};

/** How many scene Mickys are on screen right now. */
export const scenesOnScreen = (): number => Number(document.body.dataset.mickeyScenes || 0);
