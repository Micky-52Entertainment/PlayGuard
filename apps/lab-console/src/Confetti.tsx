import { useMemo } from "react";

const COLORS = ["#3b82f6", "#22c55e", "#06b6d4", "#a855f7", "#facc15", "#f472b6"];

/**
 * A short burst over a "Ready" verdict. Pure CSS pieces that remove
 * themselves from view; hidden entirely for people who asked for less motion.
 */
export const Confetti = ({ pieces = 44 }: { pieces?: number }) => {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, index) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        duration: 1.3 + Math.random() * 1.1,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 900,
        color: COLORS[index % COLORS.length],
        round: Math.random() < 0.35,
      })),
    [pieces]
  );
  return (
    <div className="confetti" aria-hidden="true">
      {items.map((item, index) => (
        <span
          key={index}
          className={item.round ? "round" : ""}
          style={
            {
              left: `${item.left}%`,
              background: item.color,
              animationDelay: `${item.delay}s`,
              animationDuration: `${item.duration}s`,
              "--drift": `${item.drift}px`,
              "--spin": `${item.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};
