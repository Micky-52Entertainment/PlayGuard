import assert from "node:assert/strict";
import test from "node:test";
import type { CheckResult } from "@playable-lab/checks";
import type { Orientation } from "@playable-lab/protocol";
import type { DeviceRun, RunReport } from "./report.ts";
import { summarize, summaryLines } from "./summary.ts";

const check = (id: string, status: CheckResult["status"]): CheckResult => ({
  id,
  title: id,
  status,
  message: `${id} message`,
});

const screen = (name: string, orientation: Orientation, checks: CheckResult[], ai?: DeviceRun["ai"]): DeviceRun => ({
  id: `${name}-${orientation}`,
  device: { id: name, name, group: "android", os: "android", width: 400, height: 900, dpr: 2 },
  orientation,
  cssWidth: 400,
  cssHeight: 900,
  status: checks.some((item) => item.status === "fail")
    ? "fail"
    : checks.some((item) => item.status === "warn")
      ? "warn"
      : "pass",
  checks,
  shots: [],
  evidence: { loaded: true, pageErrors: [], consoleErrors: [], requests: [], adEvents: [], inputs: 1, expectCta: false },
  console: [],
  ai,
});

const report = (runs: DeviceRun[], fileChecks: CheckResult[] = []): RunReport => {
  const all = [...fileChecks.map((item) => item.status), ...runs.map((run) => run.status)];
  return {
    generatedAt: "",
    status: all.includes("fail") ? "fail" : all.includes("warn") ? "warn" : "pass",
    playable: { name: "p.html", bytes: 1, engine: "vanilla" },
    fileChecks,
    runs,
  };
};

const clean = [check("load", "pass"), check("js-errors", "pass"), check("responds", "pass"), check("cta", "pass")];

test("a clean run is ready and every answer is yes", () => {
  const summary = summarize(report([screen("A", "portrait", clean), screen("A", "landscape", clean)]), "en");
  assert.equal(summary.verdict, "ready");
  assert.ok(summary.rows.every((row) => row.answer === "yes"));
  assert.deepEqual(
    summary.orientations.map((item) => item.status),
    ["pass", "pass"]
  );
});

test("a failure names the question, the orientation and the screens", () => {
  const broken = [check("load", "pass"), check("js-errors", "fail"), check("responds", "pass"), check("cta", "pass")];
  const summary = summarize(
    report([
      screen("Phone", "portrait", clean),
      screen("Tablet", "portrait", clean),
      screen("Phone", "landscape", clean),
      screen("Tablet", "landscape", broken),
    ]),
    "en"
  );
  assert.equal(summary.verdict, "fix");
  assert.ok(summary.headline.includes("1 problem"));
  assert.equal(summary.rows[0].id, "crash");
  assert.equal(summary.rows[0].answer, "no");
  assert.equal(summary.rows[0].where, "Landscape: Tablet");
  assert.equal(summary.orientations[0].status, "pass");
  assert.equal(summary.orientations[1].status, "fail");
});

test("untested input and store are shown as not tested, other gaps are left out", () => {
  const smoke = [check("load", "pass"), check("responds", "skip"), check("cta", "skip"), check("performance", "info")];
  const summary = summarize(report([screen("A", "portrait", smoke)]), "en");
  assert.equal(summary.verdict, "ready");
  assert.deepEqual(
    summary.rows.map((row) => `${row.id}:${row.answer}`),
    ["responds:unknown", "cta:unknown", "load:yes"]
  );
});

test("file checks land under size or the network's rules", () => {
  const summary = summarize(
    report([screen("A", "portrait", clean)], [check("size", "fail"), check("store-links", "warn")]),
    "en"
  );
  const size = summary.rows.find((row) => row.id === "size");
  const rules = summary.rows.find((row) => row.id === "rules");
  assert.equal(size?.answer, "no");
  assert.deepEqual(size?.items, ["size: size message"]);
  assert.equal(rules?.answer, "partly");
});

test("AI findings are quoted with their screen, in the summary's language", () => {
  const ai: DeviceRun["ai"] = {
    mode: "play",
    provider: "claude",
    model: "m",
    turns: [],
    issues: [{ severity: "major", text: "Кнопка обрезана" }],
    outcome: "stuck",
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
  };
  const summary = summarize(report([screen("Pixel", "landscape", [...clean, check("ai", "warn")], ai)]), "ru");
  const look = summary.rows.find((row) => row.id === "look");
  assert.equal(look?.answer, "partly");
  assert.equal(look?.items?.[0], "Pixel, горизонтально: Кнопка обрезана");
  assert.equal(look?.items?.length, 2);
  assert.ok(summaryLines(summary)[0].startsWith("Работает, но нужно проверить"));
});
