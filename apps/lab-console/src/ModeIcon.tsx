/**
 * The four ways to play, drawn in the logo's style: soft volume, the
 * blue-to-cyan of the phone, the green of the tick.
 */
export const ModeIcon = ({ mode }: { mode: "phone" | "pc" | "ai" | "load" }) => {
  const id = `mode-${mode}`;
  return (
    <svg className={`mode-icon ${mode}`} viewBox="0 0 56 56" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e5bff" />
          <stop offset="1" stopColor="#1fb8f0" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8be9ff" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      {mode === "phone" && (
        <>
          <rect x="15" y="5" width="26" height="46" rx="7" fill={`url(#${id}-a)`} />
          <rect x="18" y="10" width="20" height="35" rx="4" fill={`url(#${id}-b)`} />
          <circle className="mode-ripple" cx="28" cy="30" r="5" fill="none" stroke="#fff" strokeWidth="2" />
          <circle cx="28" cy="30" r="2.6" fill="#fff" />
          <circle cx="42" cy="12" r="7" fill={`url(#${id}-c)`} />
          <path d="M38.8 12.2l2.1 2.1 4-4.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {mode === "pc" && (
        <>
          <rect x="6" y="9" width="44" height="29" rx="5" fill={`url(#${id}-a)`} />
          <rect x="9.5" y="12.5" width="37" height="22" rx="3" fill={`url(#${id}-b)`} />
          <rect x="21" y="41" width="14" height="4" rx="2" fill="#1e5bff" opacity="0.7" />
          <rect x="15" y="45" width="26" height="4" rx="2" fill="#1e5bff" />
          <path className="mode-cursor" d="M27 17l0 13 3.4-3.2 2.6 5.4 2.6-1.2-2.6-5.3 4.6-.5z" fill="#fff" stroke="#1e3a8a" strokeWidth="0.8" strokeLinejoin="round" />
        </>
      )}
      {mode === "ai" && (
        <>
          <rect x="10" y="16" width="36" height="28" rx="9" fill={`url(#${id}-a)`} />
          <rect x="15" y="21" width="26" height="15" rx="6" fill={`url(#${id}-b)`} />
          <circle className="mode-eye" cx="23" cy="28.5" r="2.6" fill="#fff" />
          <circle className="mode-eye" cx="33" cy="28.5" r="2.6" fill="#fff" />
          <rect x="26.5" y="9" width="3" height="7" rx="1.5" fill="#1e5bff" />
          <circle cx="28" cy="8" r="3.2" fill={`url(#${id}-c)`} />
          <path className="mode-spark" d="M46 8l1.2 3 3 1.2-3 1.2L46 16.4l-1.2-3-3-1.2 3-1.2z" fill="#4ade80" />
        </>
      )}
      {mode === "load" && (
        <>
          <circle cx="28" cy="28" r="21" fill={`url(#${id}-b)`} opacity="0.35" />
          <path className="mode-bolt" d="M31 6L15 31h11l-3 19 18-27H30z" fill={`url(#${id}-a)`} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
};
