import assert from "node:assert/strict";
import test from "node:test";
import type { PointerSample, SessionTrace } from "@playable-lab/protocol";
import { buildReplayPlan } from "./plan.ts";

const sample = (partial: Partial<PointerSample>): PointerSample => ({
  t: 0,
  kind: "touch",
  phase: "down",
  pointerId: 1,
  nx: 0.5,
  ny: 0.5,
  pressure: 1,
  type: "pointer",
  ...partial,
});

const trace = (events: PointerSample[]): SessionTrace => ({
  version: 1,
  sessionId: "ses_test",
  playable: { id: "p", engine: "vanilla", name: "p.html", url: "/playables/p/index.html" },
  orientationLock: "portrait",
  sourceViewport: {
    cssWidth: 400,
    cssHeight: 800,
    dpr: 3,
    orientation: "portrait",
    fit: "stretch",
    contentRect: { x: 0, y: 0, w: 400, h: 800 },
  },
  startedAt: 0,
  events,
});

test("schedules on load-relative time and keeps long pauses", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ t: 1_700_000_000_000, rt: 4000, phase: "down" }),
      sample({ t: 1_700_000_000_050, rt: 4050, phase: "up" }),
      sample({ t: 1_700_000_009_000, rt: 13000, phase: "down" }),
      sample({ t: 1_700_000_009_040, rt: 13040, phase: "up" }),
    ])
  );
  assert.equal(plan.timing, "load");
  assert.deepEqual(plan.actions.map((action) => action.at), [4000, 4050, 13000, 13040]);
  assert.equal(plan.inputs, 2);
  assert.equal(plan.firstInputAt, 4000);
});

test("times an old trace from its first event instead of the epoch", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ t: 1_700_000_000_000, phase: "down" }),
      sample({ t: 1_700_000_000_300, phase: "up" }),
    ]),
    { leadInMs: 1000 }
  );
  assert.equal(plan.timing, "first-event");
  assert.deepEqual(plan.actions.map((action) => action.at), [1000, 1300]);
});

test("shortens idle gaps and applies speed", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ rt: 0, phase: "down" }),
      sample({ rt: 100, phase: "up" }),
      sample({ rt: 10100, phase: "down" }),
      sample({ rt: 10200, phase: "up" }),
    ]),
    { maxGapMs: 1000, speed: 2 }
  );
  assert.deepEqual(plan.actions.map((action) => action.at), [0, 50, 550, 600]);
});

test("replays two fingers as one multi-touch sequence", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ rt: 0, pointerId: 1, nx: 0.4, phase: "down" }),
      sample({ rt: 10, pointerId: 2, nx: 0.6, phase: "down", isPrimary: false }),
      sample({ rt: 20, pointerId: 2, nx: 0.8, phase: "move", isPrimary: false }),
      sample({ rt: 30, pointerId: 1, nx: 0.4, phase: "up" }),
      sample({ rt: 40, pointerId: 2, nx: 0.8, phase: "up", isPrimary: false }),
    ])
  );
  const touches = plan.actions.map((action) =>
    action.kind === "touch" ? [action.type, action.points.map((point) => point.id)] : null
  );
  assert.deepEqual(touches, [
    ["touchStart", [1]],
    ["touchStart", [1, 2]],
    ["touchMove", [1, 2]],
    ["touchEnd", [1]],
    ["touchEnd", [2]],
  ]);
  assert.deepEqual(
    plan.actions.map((action) => (action.kind === "touch" ? action.remaining : -1)),
    [1, 2, 2, 1, 0]
  );
  const moved = plan.actions[2];
  assert.ok(moved.kind === "touch" && moved.points[1].nx === 0.8);
});

test("skips derived gestures and lifts fingers a cut-off trace left down", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ rt: 0, phase: "down" }),
      sample({ rt: 5, type: "gesture", gesture: "tap", phase: "up" }),
      sample({ rt: 10, phase: "move" }),
    ])
  );
  assert.deepEqual(
    plan.actions.map((action) => (action.kind === "touch" ? action.type : action.kind)),
    ["touchStart", "touchMove", "touchEnd"]
  );
});

test("marks a bounded, spread-out set of lifts for screenshots", () => {
  const events: PointerSample[] = [];
  for (let i = 0; i < 20; i += 1) {
    events.push(sample({ rt: i * 100, phase: "down" }), sample({ rt: i * 100 + 50, phase: "up" }));
  }
  const plan = buildReplayPlan(trace(events), { maxShots: 4 });
  const shots = plan.actions.filter((action) => "shot" in action && action.shot);
  assert.equal(shots.length, 4);
  assert.equal(shots[shots.length - 1].at, 1950);
});

test("replays a session played with a mouse as one finger, without the hovering", () => {
  const plan = buildReplayPlan(
    trace([
      sample({ rt: 0, kind: "mouse", phase: "move" }),
      sample({ rt: 100, kind: "mouse", phase: "down", nx: 0.2 }),
      sample({ rt: 150, kind: "mouse", phase: "move", nx: 0.4 }),
      sample({ rt: 200, kind: "mouse", phase: "up", nx: 0.4 }),
      sample({ rt: 300, kind: "mouse", phase: "move", nx: 0.9 }),
    ])
  );
  assert.deepEqual(
    plan.actions.map((action) => (action.kind === "touch" ? action.type : action.kind)),
    ["touchStart", "touchMove", "touchEnd"]
  );
  assert.equal(plan.inputs, 1);
});
