import assert from "node:assert/strict";
import test from "node:test";
import { aiCheck, mergeIssues, parseAction, parseDecision, playTurnText } from "./ai.ts";
import type { AiIssue, AiRunInfo } from "./ai.ts";

const info = (patch: Partial<AiRunInfo>): AiRunInfo => ({
  mode: "play",
  provider: "claude",
  model: "m",
  turns: [],
  issues: [],
  outcome: "store",
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...patch,
});

test("parseAction reads each input format", () => {
  assert.deepEqual(parseAction("tap 50 80"), { kind: "tap", x: 50, y: 80 });
  assert.deepEqual(parseAction("Drag 10,20 → 90,20"), { kind: "drag", x: 10, y: 20, x2: 90, y2: 20 });
  assert.deepEqual(parseAction("hold 30 40 1200"), { kind: "hold", x: 30, y: 40, ms: 1200 });
  assert.deepEqual(parseAction("wait 500"), { kind: "wait", ms: 500 });
});

test("parseAction keeps coordinates on the screen and waits short", () => {
  assert.deepEqual(parseAction("tap 140 -5"), { kind: "tap", x: 100, y: 0 });
  assert.deepEqual(parseAction("wait 60000"), { kind: "wait", ms: 3000 });
});

test("parseAction rejects what it cannot act on", () => {
  assert.equal(parseAction("tap the button"), null);
  assert.equal(parseAction("swipe 1 2 3 4"), null);
  assert.equal(parseAction("drag 1 2"), null);
});

test("parseDecision drops bad actions, caps the batch and defaults the rest", () => {
  const decision = parseDecision({
    see: "start screen",
    actions: ["tap 1 1", "nonsense", "tap 2 2", "tap 3 3", "tap 4 4", "tap 5 5", "tap 6 6"],
    issues: [{ severity: "huge", text: "logo cut off" }, { severity: "major", text: " " }],
    status: "winning",
  });
  assert.equal(decision.actions.length, 5);
  assert.deepEqual(decision.issues, [{ severity: "minor", text: "logo cut off" }]);
  assert.equal(decision.status, "playing");
  assert.deepEqual(parseDecision(null).actions, []);
});

test("mergeIssues reports each issue once", () => {
  const known: AiIssue[] = [];
  assert.equal(mergeIssues(known, [{ severity: "major", text: "Text cut off" }], 1), 1);
  assert.equal(mergeIssues(known, [{ severity: "minor", text: "text cut off" }], 2), 0);
  assert.equal(known[0].turn, 1);
});

test("playTurnText carries only the recent turns", () => {
  const previous = Array.from({ length: 9 }, (_, index) => ({
    turn: index + 1,
    at: 0,
    see: `screen ${index + 1}`,
    actions: ["tap 1 1"],
  }));
  const text = playTurnText({
    width: 412,
    height: 915,
    orientation: "portrait",
    turn: 10,
    maxTurns: 14,
    at: 12400,
    previous,
    lastChanged: false,
    reported: ["logo cut off"],
  });
  assert.ok(text.includes("412x915 portrait"));
  assert.ok(text.includes("did NOT change"));
  assert.ok(!text.includes("screen 3 "));
  assert.ok(text.includes("9. screen 9"));
  assert.ok(text.includes("Already reported: logo cut off"));
});

test("aiCheck fails on a blocker, warns on a major issue or a stuck game", () => {
  assert.equal(aiCheck(info({})).status, "pass");
  assert.equal(aiCheck(info({ issues: [{ severity: "minor", text: "a" }] })).status, "pass");
  assert.equal(aiCheck(info({ issues: [{ severity: "major", text: "a" }] })).status, "warn");
  assert.equal(aiCheck(info({ outcome: "stuck" })).status, "warn");
  assert.equal(aiCheck(info({ issues: [{ severity: "blocker", text: "a" }] })).status, "fail");
});
