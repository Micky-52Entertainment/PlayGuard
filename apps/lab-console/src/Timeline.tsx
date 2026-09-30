import { useEffect, useRef, useState } from "react";
import { FPS_ZONES, fpsZone, summarizeFps } from "@playable-lab/checks";
import type { FpsZone } from "@playable-lab/checks";
import type { AdEvent, PerfSample } from "@playable-lab/protocol";
import { useI18n } from "./i18n";
import type { Key } from "./i18n";

const PLOT_HEIGHT = 96;
const TRACK_HEIGHT = 18;
const MARGIN = { top: 8, right: 12, bottom: 18, left: 30 };
const HEIGHT = MARGIN.top + PLOT_HEIGHT + TRACK_HEIGHT + MARGIN.bottom;
const ZONES: FpsZone[] = ["green", "yellow", "red"];
const ZONE_MARK: Record<FpsZone, { className: string; glyph: string }> = {
  green: { className: "pass", glyph: "✓" },
  yellow: { className: "warn", glyph: "!" },
  red: { className: "fail", glyph: "✕" },
};

export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

interface TimelineProps {
  samples: PerfSample[];
  /** Touch-down times, ms since the playable loaded on the phone. */
  taps: number[];
  ctas: AdEvent[];
}

/**
 * One time axis for the whole session: the phone's frame rate over its three
 * zones, with the player's touches and the store call marked underneath.
 */
const OPEN_KEY = "playable-lab.timeline-open";

export const Timeline = ({ samples, taps, ctas }: TimelineProps) => {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  // Folded to one line by default: while playing, the screens need the room.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = (): void => {
    setOpen((value) => {
      try {
        localStorage.setItem(OPEN_KEY, value ? "0" : "1");
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      return !value;
    });
  };

  useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const summary = summarizeFps(samples);
  if (!summary) {
    return (
      <div className="timeline empty" ref={box}>
        <span className="timeline-title">{t("timeline.title")}</span>
        <span className="hint">{t("timeline.empty")}</span>
      </div>
    );
  }

  const last = samples[samples.length - 1];
  const loaded = samples.find((sample) => sample.rt > 0);
  const loadAt = loaded ? loaded.at - loaded.rt : null;
  const yMax = Math.max(60, Math.ceil(summary.max / 30) * 30);
  const xMax = Math.max(30000, last.at);
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const x = (at: number): number => MARGIN.left + (Math.min(at, xMax) / xMax) * plotW;
  const y = (fps: number): number => MARGIN.top + (1 - Math.min(fps, yMax) / yMax) * PLOT_HEIGHT;
  const trackY = MARGIN.top + PLOT_HEIGHT + 4;
  const path = samples
    .map((sample, index) => `${index === 0 ? "M" : "L"}${x(sample.at).toFixed(1)},${y(sample.fps).toFixed(1)}`)
    .join("");
  const bands: Array<{ zone: FpsZone; from: number; to: number }> = [
    { zone: "green", from: yMax, to: FPS_ZONES.green },
    { zone: "yellow", from: FPS_ZONES.green, to: FPS_ZONES.yellow },
    { zone: "red", from: FPS_ZONES.yellow, to: 0 },
  ];
  const tickStep = xMax <= 60000 ? 10000 : xMax <= 180000 ? 30000 : 60000;
  const ticks: number[] = [];
  for (let at = 0; at <= xMax; at += tickStep) {
    ticks.push(at);
  }
  const point = hover === null ? null : samples[Math.min(hover, samples.length - 1)];
  const firstCta = ctas[0];

  const onMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left - MARGIN.left) / plotW) * xMax;
    let best = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if (Math.abs(samples[i].at - at) < Math.abs(samples[best].at - at)) {
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <div className="timeline" ref={box}>
      <div className="timeline-head">
        <span className="timeline-title">{t("timeline.fps")}</span>
        <span className={`mark ${ZONE_MARK[summary.zone].className}`}>{ZONE_MARK[summary.zone].glyph}</span>
        <span className="timeline-value">{summary.average.toFixed(0)}</span>
        <span>{t("timeline.average")}</span>
        <span>
          {t("timeline.now")} <b>{last.fps.toFixed(0)}</b>
        </span>
        <span>
          {t("timeline.min")} <b>{summary.min.toFixed(0)}</b>
        </span>
        <span className="timeline-sep" />
        <span>
          {t("common.touches", { n: taps.length })}
        </span>
        <span>
          {firstCta ? (
            <>
              {t("timeline.storeAt")} <b>{clock((loadAt ?? 0) + firstCta.rt)}</b>
            </>
          ) : (
            t("timeline.noStore")
          )}
        </span>
        {open && (
        <span className="timeline-zones">
          {ZONES.map((zone) => (
            <span key={zone} className="timeline-zone">
              <span className={`mark ${ZONE_MARK[zone].className}`}>{ZONE_MARK[zone].glyph}</span>
              {t(`zone.${zone}` as Key)} <b>{Math.round(summary.share[zone] * 100)}%</b>
            </span>
          ))}
        </span>
        )}
        <button className="ghost timeline-toggle" aria-expanded={open} onClick={toggle}>
          {open ? t("timeline.fold") : t("timeline.unfold")}
        </button>
      </div>
      {open && (
      <>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${t("timeline.fps")} ${clock(last.at)}: ${summary.average.toFixed(0)} fps, ${t("common.touches", { n: taps.length })}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {bands.map((band) => (
          <rect
            key={band.zone}
            className={`tl-band ${band.zone}`}
            x={MARGIN.left}
            y={y(band.from)}
            width={plotW}
            height={Math.max(0, y(band.to) - y(band.from) - 2)}
          />
        ))}
        {[0, FPS_ZONES.yellow, FPS_ZONES.green, yMax].map((value) => (
          <text key={value} className="tl-tick" x={MARGIN.left - 6} y={y(value) + 3.5} textAnchor="end">
            {value}
          </text>
        ))}
        {ticks.map((at) => (
          <text key={at} className="tl-tick" x={x(at)} y={HEIGHT - 4} textAnchor={at === 0 ? "start" : "middle"}>
            {clock(at)}
          </text>
        ))}
        {loadAt !== null && loadAt > 0 && (
          <>
            <line className="tl-rule" x1={x(loadAt)} x2={x(loadAt)} y1={MARGIN.top} y2={trackY + TRACK_HEIGHT - 4} />
            <text className="tl-tick" x={x(loadAt) + 4} y={MARGIN.top + 10}>
              loaded
            </text>
          </>
        )}
        <path className="tl-line" d={path} />
        {samples.length === 1 && <circle className="tl-dot" cx={x(last.at)} cy={y(last.fps)} r={4} />}

        <line className="tl-track" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={trackY + 7} y2={trackY + 7} />
        {loadAt !== null &&
          taps.map((rt, index) => (
            <rect key={index} className="tl-tap" x={x(loadAt + rt) - 1} y={trackY + 2} width={2} height={10} rx={1} />
          ))}
        {loadAt !== null &&
          ctas.map((cta, index) => (
            <g key={index} transform={`translate(${x(loadAt + cta.rt)}, ${trackY + 7})`}>
              <title>{`${cta.api} at ${clock(loadAt + cta.rt)}`}</title>
              <rect className="tl-cta" x={-5} y={-5} width={10} height={10} transform="rotate(45)" />
            </g>
          ))}

        {point && (
          <>
            <line className="tl-cross" x1={x(point.at)} x2={x(point.at)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} />
            <circle className="tl-dot" cx={x(point.at)} cy={y(point.fps)} r={4} />
          </>
        )}
      </svg>
      <div className="timeline-legend">
        <span>
          <span className="swatch tap" /> {t("timeline.touch")}
        </span>
        <span>
          <span className="swatch cta" /> {t("timeline.store")}
        </span>
      </div>
      {point && (
        <div
          className="timeline-tip"
          style={{ left: Math.min(Math.max(x(point.at) + 12, 0), width - 160), top: 40 }}
        >
          <b>{point.fps.toFixed(0)} fps</b> · {clock(point.at)}
          <br />
          {t(`zone.${fpsZone(point.fps)}` as Key)}
          <br />
          {t("timeline.longest", { n: point.worstFrameMs })}
        </div>
      )}
      </>
      )}
    </div>
  );
};
