import { useI18n } from "./i18n";
import type { Key } from "./i18n";

export type ArtStep = 1 | 2 | 3 | 4;

const Gradients = ({ id }: { id: string }) => (
  <defs>
    <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#1e5bff" />
      <stop offset="1" stopColor="#1fb8f0" />
    </linearGradient>
    <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#8be9ff" />
      <stop offset="1" stopColor="#3b82f6" />
    </linearGradient>
    <linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#4ade80" />
      <stop offset="1" stopColor="#14b8a6" />
    </linearGradient>
  </defs>
);

const Tick = ({ x, y, r, fill, className }: { x: number; y: number; r: number; fill: string; className?: string }) => (
  <g className={className}>
    <circle cx={x} cy={y} r={r} fill={fill} />
    <path
      d={`M${x - r * 0.45} ${y + r * 0.02}l${r * 0.3} ${r * 0.3} ${r * 0.58}-${r * 0.62}`}
      fill="none"
      stroke="#fff"
      strokeWidth={r * 0.24}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </g>
);

/** Step 1: a file drops into the box and is taken. */
const Upload = ({ id }: { id: string }) => (
  <>
    <rect className="art-box" x="34" y="46" width="92" height="46" rx="10" />
    <g className="art-file">
      <path d="M66 8h20l10 10v28H66z" fill={`url(#${id}-a)`} />
      <path d="M86 8v10h10" fill="#8be9ff" />
      <rect x="71" y="30" width="20" height="7" rx="2" fill="#fff" opacity="0.9" />
    </g>
    <Tick className="art-pop" x={116} y={52} r={9} fill={`url(#${id}-c)`} />
  </>
);

/** Step 2: a tap upright, the phone turns, a tap on its side. */
const Play = ({ id }: { id: string }) => (
  <>
    <g className="art-phone">
      <rect x="62" y="8" width="36" height="84" rx="8" fill={`url(#${id}-a)`} />
      <rect x="66" y="15" width="28" height="70" rx="5" fill={`url(#${id}-b)`} />
      <rect x="71" y="66" width="18" height="8" rx="4" fill="#fff" opacity="0.95" />
      <circle className="art-ring" cx="80" cy="70" r="6" fill="none" stroke="#fff" strokeWidth="2" />
      <circle className="art-finger" cx="80" cy="70" r="3" fill="#1e5bff" />
    </g>
    <Tick className="art-pop late" x={124} y={20} r={9} fill={`url(#${id}-c)`} />
  </>
);

/** Step 3: screens of every shape light up one after another. */
const SCREENS = [
  { x: 10, y: 30, w: 20, h: 40 },
  { x: 36, y: 24, w: 24, h: 52 },
  { x: 66, y: 38, w: 40, h: 24 },
  { x: 112, y: 28, w: 36, h: 44 },
];
const Checks = ({ id }: { id: string }) => (
  <>
    {SCREENS.map((screen, index) => (
      <g key={index} className={`art-screen s${index}`}>
        <rect className="art-screen-off" x={screen.x} y={screen.y} width={screen.w} height={screen.h} rx="4" />
        <rect className="art-screen-on" x={screen.x} y={screen.y} width={screen.w} height={screen.h} rx="4" fill={`url(#${id}-b)`} />
        <Tick className="art-screen-tick" x={screen.x + screen.w} y={screen.y} r={6} fill={`url(#${id}-c)`} />
      </g>
    ))}
    <rect className="art-scan" x="6" y="84" width="148" height="4" rx="2" />
  </>
);

/** Manager, client, developer. */
const PEOPLE = [
  {
    y: 20,
    draw: (
      <>
        <circle cx="130" cy="17" r="3" fill="#fff" />
        <path d="M124.5 25a5.5 5 0 0 1 11 0z" fill="#fff" />
      </>
    ),
  },
  {
    y: 50,
    draw: (
      <>
        <rect x="124" y="47" width="12" height="9" rx="2" fill="#fff" />
        <rect x="127.5" y="44.5" width="5" height="3.5" rx="1" fill="none" stroke="#fff" strokeWidth="1.4" />
      </>
    ),
  },
  {
    y: 80,
    draw: (
      <path d="M126 76l-3.5 4 3.5 4M134 76l3.5 4-3.5 4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
];

/** Step 4: the verdict, then it flies to a manager, a client and a developer. */
const Result = ({ id }: { id: string }) => (
  <>
    <Tick className="art-verdict" x={40} y={50} r={22} fill={`url(#${id}-c)`} />
    {PEOPLE.map((icon, index) => (
      <g key={index} className={`art-send s${index}`}>
        <path className="art-trail" d={`M66 50 Q92 ${icon.y} 118 ${icon.y}`} fill="none" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="130" cy={icon.y} r="11" fill={`url(#${id}-a)`} />
        {icon.draw}
      </g>
    ))}
  </>
);

/** A small scene that plays by itself and shows what a step of the wizard does. */
export const StepArt = ({ step, caption = true, inline = false }: { step: ArtStep; caption?: boolean; inline?: boolean }) => {
  const { t } = useI18n();
  const id = `art${step}`;
  return (
    <figure className={`step-art art-${step}${inline ? " inline" : ""}`}>
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <Gradients id={id} />
        {step === 1 && <Upload id={id} />}
        {step === 2 && <Play id={id} />}
        {step === 3 && <Checks id={id} />}
        {step === 4 && <Result id={id} />}
      </svg>
      {caption && <figcaption>{t(`art.${step}` as Key)}</figcaption>}
    </figure>
  );
};
