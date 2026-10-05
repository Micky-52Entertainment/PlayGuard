// Where a touch made on the recording phone belongs on another screen.
//
// The recording phone is replayed first, at its own size, so its touches land
// exactly where the player's did. Just before each touch a picture of that
// screen is kept. On every other screen, a picture is taken at the same moment
// of the playthrough and the neighbourhood of the touch is looked for in it, at
// the sizes the game could have been drawn at (normalised cross-correlation).
// The spot found is where the touch goes, and its size is how much the game was
// scaled, which a drag's distance is multiplied by.
//
// When the picture does not tell (a plain background, a different scene), the
// screen-wide layout decides: the scale and offset fitted to the touches found
// so far, or else the way the first picture of the game was fitted to the screen.

/** A grayscale picture of the screen: one sample per `unit` CSS pixels. */
export interface Gray {
  w: number;
  h: number;
  unit: number;
  px: Float32Array;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How the whole game is fitted to a screen of another shape. */
export interface Layout {
  kind: "stretch" | "fit-width" | "fit-height" | "fitted";
  /** CSS px on the target per CSS px on the source, per axis. */
  sx: number;
  sy: number;
  /** Target point of the source point (0, 0). */
  tx: number;
  ty: number;
  /** How well the source picture matches the target through it, -1..1. */
  score: number;
}

export interface Found extends Point {
  /** Target CSS px per source CSS px. */
  scale: number;
  score: number;
}

export const applyLayout = (layout: Layout, p: Point): Point => ({
  x: layout.tx + p.x * layout.sx,
  y: layout.ty + p.y * layout.sy,
});

const centred = (kind: Layout["kind"], from: Size, to: Size, s: number): Layout => ({
  kind,
  sx: s,
  sy: s,
  tx: to.w / 2 - (from.w / 2) * s,
  ty: to.h / 2 - (from.h / 2) * s,
  score: 0,
});

/** The ways a game commonly fits itself to a screen. */
export const candidateLayouts = (from: Size, to: Size): Layout[] => [
  { kind: "stretch", sx: to.w / from.w, sy: to.h / from.h, tx: 0, ty: 0, score: 0 },
  centred("fit-width", from, to, to.w / from.w),
  centred("fit-height", from, to, to.h / from.h),
];

/** Bilinear sample at a CSS position; NaN outside the picture. */
export const sampleAt = (g: Gray, x: number, y: number): number => {
  const fx = x / g.unit - 0.5;
  const fy = y / g.unit - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > g.w - 0.5 || fy > g.h - 0.5) {
    return Number.NaN;
  }
  const x0 = Math.max(0, Math.min(g.w - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(g.h - 1, Math.floor(fy)));
  const x1 = Math.min(g.w - 1, x0 + 1);
  const y1 = Math.min(g.h - 1, y0 + 1);
  const ax = Math.max(0, Math.min(1, fx - x0));
  const ay = Math.max(0, Math.min(1, fy - y0));
  const top = g.px[y0 * g.w + x0] * (1 - ax) + g.px[y0 * g.w + x1] * ax;
  const bottom = g.px[y1 * g.w + x0] * (1 - ax) + g.px[y1 * g.w + x1] * ax;
  return top * (1 - ay) + bottom * ay;
};

/** The same picture with `factor` times fewer samples a side (box average). */
export const shrink = (g: Gray, factor: number): Gray => {
  if (factor <= 1) {
    return g;
  }
  const w = Math.max(1, Math.floor(g.w / factor));
  const h = Math.max(1, Math.floor(g.h / factor));
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let j = 0; j < factor; j += 1) {
        const row = (y * factor + j) * g.w;
        for (let i = 0; i < factor; i += 1) {
          sum += g.px[row + x * factor + i];
        }
      }
      px[y * w + x] = sum / (factor * factor);
    }
  }
  return { w, h, unit: g.unit * factor, px };
};

const correlate = (a: number[], b: number[]): number => {
  const n = a.length;
  if (n < 16) {
    return -1;
  }
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  // A flat area matches anything: it says nothing.
  if (aa < n * 4 || bb < n * 4) {
    return -1;
  }
  return ab / Math.sqrt(aa * bb);
};

/** Which candidate layout carries the source picture onto the target one best. */
export const pickLayout = (source: Gray, target: Gray): Layout => {
  const from = { w: source.w * source.unit, h: source.h * source.unit };
  const to = { w: target.w * target.unit, h: target.h * target.unit };
  const grid = shrink(target, Math.max(1, Math.round(Math.max(target.w, target.h) / 96)));
  let best: Layout | undefined;
  for (const layout of candidateLayouts(from, to)) {
    const a: number[] = [];
    const b: number[] = [];
    for (let y = 0; y < grid.h; y += 1) {
      for (let x = 0; x < grid.w; x += 1) {
        const tx = (x + 0.5) * grid.unit;
        const ty = (y + 0.5) * grid.unit;
        const value = sampleAt(source, (tx - layout.tx) / layout.sx, (ty - layout.ty) / layout.sy);
        if (!Number.isNaN(value)) {
          a.push(value);
          b.push(grid.px[y * grid.w + x]);
        }
      }
    }
    // A layout that shows only a sliver of the source proves little.
    const covered = a.length / (grid.w * grid.h);
    const score = correlate(a, b) * Math.min(1, covered / 0.6);
    if (!best || score > best.score) {
      best = { ...layout, score };
    }
  }
  return best!;
};

/**
 * Least-squares uniform scale and offset through matched pairs (source → target).
 * Undefined with fewer than two pairs or when they disagree.
 */
export const fitLayout = (pairs: Array<{ from: Point; to: Point }>, tolerance: number): Layout | undefined => {
  if (pairs.length < 2) {
    return undefined;
  }
  const n = pairs.length;
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (const pair of pairs) {
    fx += pair.from.x;
    fy += pair.from.y;
    tx += pair.to.x;
    ty += pair.to.y;
  }
  fx /= n;
  fy /= n;
  tx /= n;
  ty /= n;
  let num = 0;
  let den = 0;
  for (const pair of pairs) {
    const ax = pair.from.x - fx;
    const ay = pair.from.y - fy;
    num += ax * (pair.to.x - tx) + ay * (pair.to.y - ty);
    den += ax * ax + ay * ay;
  }
  // Every touch on one spot fixes the offset but not the scale.
  if (den < 1e-6) {
    return undefined;
  }
  const s = num / den;
  if (!(s > 0)) {
    return undefined;
  }
  const layout: Layout = { kind: "fitted", sx: s, sy: s, tx: tx - fx * s, ty: ty - fy * s, score: 1 };
  const worst = Math.max(
    ...pairs.map((pair) => {
      const p = applyLayout(layout, pair.from);
      return Math.hypot(p.x - pair.to.x, p.y - pair.to.y);
    })
  );
  return worst <= tolerance ? layout : undefined;
};

/** The sizes the game could be drawn at on the target, in a geometric spread. */
export const candidateScales = (from: Size, to: Size, around?: number): number[] => {
  // Around the game's scale found so far first, but a control pinned to the
  // screen (a corner button) keeps its own size: the full spread stays in.
  const near = around ? [0.92, 0.96, 1, 1.04, 1.08].map((k) => around * k) : [];
  const ratios = [to.w / from.w, to.h / from.h, 1];
  const low = Math.min(...ratios) * 0.85;
  const high = Math.max(...ratios) * 1.15;
  const steps = 9;
  const out: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    out.push(low * Math.pow(high / low, i / (steps - 1)));
  }
  return [...near, ...out];
};

interface Template {
  n: number;
  /** Values minus their mean. */
  t: Float32Array;
  norm: number;
}

/** A square of the source around `at`, `side` CSS px wide, resampled to `n` samples a side. */
const template = (source: Gray, at: Point, side: number, n: number): Template | undefined => {
  if (n < 5) {
    return undefined;
  }
  const t = new Float32Array(n * n);
  let mean = 0;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const v = sampleAt(source, at.x + ((i + 0.5) / n - 0.5) * side, at.y + ((j + 0.5) / n - 0.5) * side);
      if (Number.isNaN(v)) {
        return undefined;
      }
      t[j * n + i] = v;
      mean += v;
    }
  }
  mean /= n * n;
  let norm = 0;
  for (let k = 0; k < t.length; k += 1) {
    t[k] -= mean;
    norm += t[k] * t[k];
  }
  // A plain patch (a flat background) would match anywhere.
  if (norm < n * n * 25) {
    return undefined;
  }
  return { n, t, norm: Math.sqrt(norm) };
};

/** Normalised cross-correlation of the template with the target window at (a, b), in samples. */
const nccAt = (g: Gray, tpl: Template, a: number, b: number): number => {
  const { n, t } = tpl;
  let sum = 0;
  let sq = 0;
  let dot = 0;
  for (let j = 0; j < n; j += 1) {
    const row = (b + j) * g.w + a;
    for (let i = 0; i < n; i += 1) {
      const v = g.px[row + i];
      sum += v;
      sq += v * v;
      dot += v * t[j * n + i];
    }
  }
  const count = n * n;
  const variance = sq - (sum * sum) / count;
  if (variance <= count) {
    return -1;
  }
  // The template has zero mean, so the window's own mean drops out of the dot product.
  return dot / (Math.sqrt(variance) * tpl.norm);
};

export interface FindOptions {
  /** Where the screen-wide layout puts the touch: matches far from it score lower. */
  prior: Point;
  scales: number[];
  /** Sides of the source square looked for, CSS px, tried in order. */
  sides: number[];
  /** Accept a match at or above this correlation. */
  minScore: number;
}

/**
 * The spot on `target` that looks like the neighbourhood of `at` on `source`.
 * Undefined when nothing matches well enough.
 */
export const findSpot = (source: Gray, at: Point, target: Gray, options: FindOptions): Found | undefined => {
  const to = { w: target.w * target.unit, h: target.h * target.unit };
  const from = { w: source.w * source.unit, h: source.h * source.unit };
  const diagonal = Math.hypot(to.w, to.h);
  // Coarse pass on roughly 100 samples across the screen, then a fine one around the best.
  const factor = Math.max(1, Math.round(Math.min(target.w, target.h) / 100));
  const coarse = shrink(target, factor);
  for (const wanted of options.sides) {
    // A touch near the edge is looked for with a square kept inside the picture,
    // the touch off its centre by `off` (source CSS px).
    const side = Math.min(wanted, from.w, from.h);
    const centre = {
      x: Math.min(Math.max(at.x, side / 2), from.w - side / 2),
      y: Math.min(Math.max(at.y, side / 2), from.h - side / 2),
    };
    const off = { x: at.x - centre.x, y: at.y - centre.y };
    const spots: Found[] = [];
    let top = -Infinity;
    for (const scale of options.scales) {
      const n = Math.round((side * scale) / coarse.unit);
      const tpl = template(source, centre, side, n);
      if (!tpl || n >= coarse.w || n >= coarse.h) {
        continue;
      }
      for (let b = 0; b + n <= coarse.h; b += 1) {
        for (let a = 0; a + n <= coarse.w; a += 1) {
          const x = (a + n / 2) * coarse.unit + off.x * scale;
          const y = (b + n / 2) * coarse.unit + off.y * scale;
          const d = Math.hypot(x - options.prior.x, y - options.prior.y) / diagonal;
          const score = nccAt(coarse, tpl, a, b) - 0.3 * d * d;
          if (score > top - 0.04) {
            spots.push({ x, y, scale, score });
            top = Math.max(top, score);
          }
        }
      }
    }
    // Along an edge or a row of the same things, several spots match about as
    // well: the picture cannot tell them apart, the layout can.
    let best: Found | undefined;
    for (const spot of spots) {
      if (spot.score < top - 0.03) {
        continue;
      }
      if (
        !best ||
        Math.hypot(spot.x - options.prior.x, spot.y - options.prior.y) <
          Math.hypot(best.x - options.prior.x, best.y - options.prior.y)
      ) {
        best = spot;
      }
    }
    if (!best) {
      continue;
    }
    // Fine pass on the full picture, around the coarse spot, at nearby scales.
    let fine: Found | undefined;
    for (const k of [0.92, 0.95, 0.98, 1, 1.02, 1.05, 1.08]) {
      const scale = best.scale * k;
      const n = Math.round((side * scale) / target.unit);
      const tpl = template(source, centre, side, n);
      if (!tpl) {
        continue;
      }
      const ca = Math.round((best.x - off.x * best.scale) / target.unit - n / 2);
      const cb = Math.round((best.y - off.y * best.scale) / target.unit - n / 2);
      const reach = factor * 2;
      for (let b = Math.max(0, cb - reach); b <= Math.min(target.h - n, cb + reach); b += 1) {
        for (let a = Math.max(0, ca - reach); a <= Math.min(target.w - n, ca + reach); a += 1) {
          const score = nccAt(target, tpl, a, b);
          if (!fine || score > fine.score) {
            fine = { x: (a + n / 2) * target.unit + off.x * scale, y: (b + n / 2) * target.unit + off.y * scale, scale, score };
          }
        }
      }
    }
    if (fine && fine.score >= options.minScore) {
      return fine;
    }
  }
  return undefined;
};
