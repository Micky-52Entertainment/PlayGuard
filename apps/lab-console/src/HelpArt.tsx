import { StepArt } from "./StepArt";

export type HelpTopic = "start" | "share" | "archive" | "phone" | "verdicts" | "team" | "storage" | "names";

const Defs = ({ id }: { id: string }) => (
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

const tick = (x: number, y: number, r: number) => `M${x - r * 0.45} ${y}l${r * 0.3} ${r * 0.3} ${r * 0.58}-${r * 0.62}`;

/** Four steps light up in turn: upload, play, checks, result. */
const Start = () => (
  <>
    <path className="ha-line" d="M22 50H138" />
    <path className="ha-progress" d="M22 50H138" />
    {[22, 61, 99, 138].map((x, i) => (
      <g key={x} className={`ha-step s${i}`}>
        <circle cx={x} cy={50} r={13} className="ha-step-bg" />
        <circle cx={x} cy={50} r={13} className="ha-step-on" fill="url(#ha-start-a)" />
        <text x={x} y={55} textAnchor="middle" className="ha-num">
          {i + 1}
        </text>
      </g>
    ))}
  </>
);

/** An archive opens and its builds fan out, each with its network's colour. */
const Archive = () => (
  <>
    <g className="ha-zip">
      <rect x="62" y="56" width="36" height="34" rx="5" fill="url(#ha-archive-a)" />
      <path d="M80 56v34" stroke="#fff" strokeWidth="2" strokeDasharray="3 3" opacity="0.8" />
    </g>
    {[
      { x: 18, c: "#f59e0b" },
      { x: 54, c: "#a855f7" },
      { x: 90, c: "#ef4444" },
      { x: 126, c: "#22c55e" },
    ].map((file, i) => (
      <g key={file.x} className={`ha-build s${i}`}>
        <path d={`M${file.x} 8h14l6 6v24h-20z`} fill="url(#ha-archive-b)" />
        <rect x={file.x + 3} y={28} width={14} height={5} rx="2" fill={file.c} />
        <circle cx={file.x + 18} cy={10} r={6} fill="url(#ha-archive-c)" className="ha-build-ok" />
        <path d={tick(file.x + 18, 10, 6)} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" className="ha-build-ok" />
      </g>
    ))}
  </>
);

/** Phone and computer find each other over the same Wi-Fi. */
const Phone = () => (
  <>
    <rect x="12" y="30" width="46" height="32" rx="4" fill="url(#ha-phone-a)" />
    <rect x="16" y="34" width="38" height="24" rx="2" fill="url(#ha-phone-b)" />
    <rect x="6" y="64" width="58" height="5" rx="2.5" fill="#1e5bff" />
    <rect x="120" y="22" width="26" height="48" rx="6" fill="url(#ha-phone-a)" />
    <rect x="123.5" y="27" width="19" height="38" rx="3" fill="url(#ha-phone-b)" />
    <g className="ha-wifi">
      <path d="M72 24a24 24 0 0 1 32 0" className="ha-arc a2" />
      <path d="M77 31a16 16 0 0 1 22 0" className="ha-arc a1" />
      <path d="M82 38a8 8 0 0 1 12 0" className="ha-arc a0" />
      <circle cx="88" cy="43" r="2.4" className="ha-dot" />
    </g>
    <path className="ha-link" d="M62 58Q88 76 118 58" />
    <g className="ha-linked">
      <circle cx="88" cy="70" r="8" fill="url(#ha-phone-c)" />
      <path d={tick(88, 70, 8)} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </>
);

/** The three verdicts, one after another. */
const Verdicts = () => (
  <>
    {[
      { x: 30, c: "url(#ha-verdicts-c)", glyph: "✓" },
      { x: 80, c: "#f0b429", glyph: "!" },
      { x: 130, c: "#ef4444", glyph: "✕" },
    ].map((item, i) => (
      <g key={item.x} className={`ha-verdict s${i}`}>
        <circle cx={item.x} cy={46} r={19} fill={item.c} />
        <text x={item.x} y={54} textAnchor="middle" className="ha-glyph">
          {item.glyph}
        </text>
      </g>
    ))}
  </>
);

/** One computer runs PlayGuard; teammates join from their own. */
const Team = () => (
  <>
    <rect x="62" y="34" width="36" height="26" rx="4" fill="url(#ha-team-a)" />
    <rect x="65.5" y="37.5" width="29" height="19" rx="2" fill="url(#ha-team-b)" />
    <rect x="56" y="61" width="48" height="4" rx="2" fill="#1e5bff" />
    {[
      { x: 20, y: 22 },
      { x: 140, y: 22 },
      { x: 20, y: 78 },
      { x: 140, y: 78 },
    ].map((person, i) => (
      <g key={i} className={`ha-mate s${i}`}>
        <path className="ha-wire" d={`M${person.x} ${person.y}L${person.x < 80 ? 60 : 100} ${person.y < 50 ? 40 : 58}`} />
        <circle cx={person.x} cy={person.y - 5} r={5} fill="url(#ha-team-a)" />
        <path d={`M${person.x - 8} ${person.y + 9}a8 7 0 0 1 16 0z`} fill="url(#ha-team-a)" />
      </g>
    ))}
  </>
);

/** Old reports go to the bin; the folder stays. */
const Storage = () => (
  <>
    <path d="M18 34h22l6 6h38v42H18z" fill="url(#ha-storage-a)" />
    {[0, 1, 2].map((i) => (
      <g key={i} className={`ha-doc s${i}`}>
        <rect x={34 + i * 10} y={22} width={20} height={26} rx="3" fill="#fff" />
        <path d={`M${38 + i * 10} 30h12M${38 + i * 10} 35h12M${38 + i * 10} 40h8`} stroke="#9fb4d8" strokeWidth="2" strokeLinecap="round" />
      </g>
    ))}
    <g className="ha-bin">
      <path d="M116 40h28l-3 42h-22z" fill="url(#ha-storage-b)" />
      <rect x="112" y="33" width="36" height="6" rx="3" fill="url(#ha-storage-a)" className="ha-lid" />
    </g>
  </>
);

/** A book of words; the page turns. */
const Names = () => (
  <>
    <path d="M24 26q28-8 56 4v58q-28-12-56-4z" fill="url(#ha-names-b)" />
    <path d="M136 26q-28-8-56 4v58q28-12 56-4z" fill="url(#ha-names-a)" />
    <g className="ha-page">
      <path d="M80 30q22-10 48-4v56q-26-6-48 6z" className="ha-page-fill" />
      <path d="M92 44h24M92 52h20M92 60h24M92 68h14" className="ha-page-lines" />
    </g>
    <text x="52" y="64" textAnchor="middle" className="ha-letters">
      Aa
    </text>
  </>
);

/** A moving picture for one answer of Help: what the words describe, at a glance. */
export const HelpArt = ({ topic }: { topic: HelpTopic }) => {
  if (topic === "share") {
    return (
      <div className="help-art">
        <StepArt step={4} caption={false} />
      </div>
    );
  }
  const id = `ha-${topic}`;
  return (
    <div className={`help-art ${id}`} aria-hidden="true">
      <svg viewBox="0 0 160 100">
        <Defs id={id} />
        {topic === "start" && <Start />}
        {topic === "archive" && <Archive />}
        {topic === "phone" && <Phone />}
        {topic === "verdicts" && <Verdicts />}
        {topic === "team" && <Team />}
        {topic === "storage" && <Storage />}
        {topic === "names" && <Names />}
      </svg>
    </div>
  );
};
