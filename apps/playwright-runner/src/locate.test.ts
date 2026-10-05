import assert from "node:assert/strict";
import test from "node:test";
import { applyLayout, candidateLayouts, candidateScales, findSpot, fitLayout, pickLayout } from "./locate.ts";
import type { Gray, Layout, Size } from "./locate.ts";

// A game scene in its own units: a few discs and bars on a gradient.
const scene = (x: number, y: number): number => {
  let v = 40 + 0.08 * y;
  const discs = [
    [120, 200, 40, 200],
    [300, 520, 60, 120],
    [200, 760, 35, 230],
    [80, 600, 25, 10],
    [330, 150, 30, 160],
  ];
  for (const [cx, cy, r, c] of discs) {
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) v = c;
  }
  if (x > 40 && x < 360 && y > 860 && y < 900) v = 250;
  if (Math.abs(x - y * 0.3 - 50) < 6) v = 0;
  return v;
};

// The scene drawn on a screen: `layout` maps scene units to screen CSS px.
const draw = (screen: Size, layout: Layout, unit = 4): Gray => {
  const w = Math.round(screen.w / unit);
  const h = Math.round(screen.h / unit);
  const px = new Float32Array(w * h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const x = ((i + 0.5) * unit - layout.tx) / layout.sx;
      const y = ((j + 0.5) * unit - layout.ty) / layout.sy;
      px[j * w + i] = x < 0 || y < 0 || x > 412 || y > 915 ? 0 : scene(x, y);
    }
  }
  return { w, h, unit, px };
};

const design = { w: 412, h: 915 };
const identity: Layout = { kind: "stretch", sx: 1, sy: 1, tx: 0, ty: 0, score: 1 };
const phone = draw(design, identity);
// An iPad in portrait: the game keeps its shape and fits the height, centred.
const ipad = { w: 820, h: 1180 };
const ipadLayout = candidateLayouts(design, ipad)[2];
const tablet = draw(ipad, ipadLayout);

test("the layout picked for a tablet is the one the game used", () => {
  const picked = pickLayout(phone, tablet);
  assert.equal(picked.kind, "fit-height");
  assert.ok(picked.score > 0.9, `score ${picked.score}`);
});

test("a touch on the phone is found at the same spot of the game on the tablet", () => {
  for (const at of [
    { x: 120, y: 200 },
    { x: 300, y: 520 },
    { x: 200, y: 880 },
  ]) {
    const expected = applyLayout(ipadLayout, at);
    const found = findSpot(phone, at, tablet, {
      // A poor guess on purpose: the picture has to correct it.
      prior: { x: (at.x / design.w) * ipad.w, y: (at.y / design.h) * ipad.h },
      scales: candidateScales(design, ipad),
      sides: [130, 70],
      minScore: 0.6,
    });
    assert.ok(found, `nothing found for ${JSON.stringify(at)}`);
    const off = Math.hypot(found.x - expected.x, found.y - expected.y);
    assert.ok(off < 8, `${JSON.stringify(at)}: ${off.toFixed(1)} px off`);
    assert.ok(Math.abs(found.scale - ipadLayout.sx) / ipadLayout.sx < 0.06, `scale ${found.scale}`);
  }
});

test("a plain spot is not matched", () => {
  const flat: Gray = { w: 100, h: 100, unit: 4, px: new Float32Array(100 * 100).fill(90) };
  const found = findSpot(flat, { x: 200, y: 200 }, tablet, {
    prior: { x: 400, y: 600 },
    scales: [1],
    sides: [100],
    minScore: 0.6,
  });
  assert.equal(found, undefined);
});

test("scale and offset are fitted through matched touches", () => {
  const truth: Layout = { kind: "fitted", sx: 1.5, sy: 1.5, tx: 30, ty: -12, score: 1 };
  const pairs = [
    { x: 10, y: 20 },
    { x: 200, y: 400 },
    { x: 350, y: 90 },
  ].map((from) => ({ from, to: applyLayout(truth, from) }));
  const fitted = fitLayout(pairs, 2)!;
  assert.ok(Math.abs(fitted.sx - 1.5) < 1e-6 && Math.abs(fitted.tx - 30) < 1e-6 && Math.abs(fitted.ty + 12) < 1e-6);
  // Pairs that disagree are no layout.
  assert.equal(fitLayout([...pairs, { from: { x: 0, y: 0 }, to: { x: 500, y: 500 } }], 10), undefined);
  assert.equal(fitLayout(pairs.slice(0, 1), 2), undefined);
});
