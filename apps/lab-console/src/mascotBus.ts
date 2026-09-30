/** The mascot's poses, one picture each under /mascot/. */
export type Pose =
  | "idle"
  | "talk"
  | "laugh"
  | "cheer"
  | "wave"
  | "ready"
  | "sad"
  | "think"
  | "wink"
  | "thumbs"
  | "point"
  | "shrug"
  | "walk"
  | "jump"
  | "arms"
  | "sleep"
  | "phone"
  | "magnify"
  | "laptop"
  | "run"
  | "facepalm"
  | "idea"
  | "celebrate"
  | "scared"
  | "bye"
  | "checklist"
  | "tired"
  | "peek"
  | "ok"
  | "trophy"
  | "sweat";

export interface MascotLine {
  pose: Pose;
  /** What the speech bubble says; none keeps it quiet. */
  text?: string;
  /** How long the reaction lasts before the mascot goes back to what the page is doing. */
  ms?: number;
}

const EVENT = "playguard:mascot";

/** Any part of the site can make the mascot react: a check done, a link that does not match. */
export const mascotSay = (line: MascotLine): void => {
  window.dispatchEvent(new CustomEvent<MascotLine>(EVENT, { detail: line }));
};

export const onMascotSay = (listener: (line: MascotLine) => void): (() => void) => {
  const handler = (event: Event): void => listener((event as CustomEvent<MascotLine>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};

const HIDDEN_KEY = "playable-lab.mascot-hidden";
const SOUND_KEY = "playable-lab.finish-sound";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
};

export const mascotHidden = (): boolean => read(HIDDEN_KEY) === "1";
export const setMascotHidden = (hidden: boolean): void => {
  write(HIDDEN_KEY, hidden ? "1" : "0");
  window.dispatchEvent(new Event("playguard:mascot-visibility"));
};

export const finishSoundOn = (): boolean => read(SOUND_KEY) !== "0";
export const setFinishSound = (on: boolean): void => write(SOUND_KEY, on ? "1" : "0");

// ---- The sound of a finished check ------------------------------------------
// Browsers only let a page make sound after the person clicked something on
// it, so the audio is opened on the first click and kept for later.

let audio: AudioContext | null = null;
const unlock = (): void => {
  if (audio) {
    void audio.resume();
    return;
  }
  try {
    const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    audio = Context ? new Context() : null;
  } catch {
    audio = null;
  }
};
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

let lastChime = 0;

/**
 * Two soft notes up for a good result, one note down for a bad one. Only when
 * the tab is in the background: whoever looks at the page already sees it.
 */
export const chime = (status: "pass" | "warn" | "fail", always = false): void => {
  if (!finishSoundOn() || (!always && !document.hidden) || !audio || Date.now() - lastChime < 3000) {
    return;
  }
  lastChime = Date.now();
  const context = audio;
  void context.resume();
  const notes = status === "fail" ? [523.25, 392] : status === "warn" ? [587.33, 587.33] : [659.25, 987.77];
  notes.forEach((frequency, index) => {
    const start = context.currentTime + index * 0.18;
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    tone.connect(volume).connect(context.destination);
    tone.start(start);
    tone.stop(start + 0.55);
  });
};
