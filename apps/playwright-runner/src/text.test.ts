import assert from "node:assert/strict";
import test from "node:test";
import { languageChecks, readableStrings, textFitCheck } from "./text.ts";
import type { TextItem, TextSnapshot } from "./text.ts";

const item = (text: string, extra: Partial<TextItem> = {}): TextItem => ({
  text,
  x: 20,
  y: 20,
  w: 100,
  h: 20,
  px: 16,
  source: "dom",
  ...extra,
});
const snap = (items: TextItem[]): TextSnapshot => ({ label: "final", width: 360, height: 640, items });

test("text inside the screen, whole and large enough passes", () => {
  const check = textFitCheck([snap([item("Play now"), item("Find the words", { y: 300 })])]);
  assert.equal(check.status, "pass");
});

test("text past an edge, cut in its box, or too small is a remark", () => {
  const check = textFitCheck([
    snap([
      item("Finde die versteckten Wörter", { x: 20, w: 480 }),
      item("Jetzt spielen", { cut: true, w: 400 }),
      item("Terms apply", { px: 7 }),
    ]),
  ]);
  assert.equal(check.status, "warn");
  assert.equal(check.details!.length, 3);
  assert.match(check.details![0], /right edge/);
  assert.match(check.details![1], /cut off/);
  assert.match(check.details![2], /too small/);
});

test("text wholly off screen is off by design, not a remark", () => {
  assert.equal(textFitCheck([snap([item("Later", { x: 900 })])]).status, "pass");
});

test("no text at all is not a pass", () => {
  assert.equal(textFitCheck([snap([])]).status, "skip");
});

test("single letters and clocks are not words to translate", () => {
  assert.deepEqual(readableStrings([snap([item("G"), item("00:23"), item("CLUE")])]), ["CLUE"]);
});

test("languages: untranslated, partly translated and translated", () => {
  const verdicts = languageChecks({ code: "en", strings: ["Play now", "Find the words", "Terms apply"] }, [
    { code: "de", strings: ["Jetzt spielen", "Finde die Wörter", "Terms apply"] },
    { code: "ru", strings: ["Играть", "Найди слова", "Условия"] },
    { code: "ja", strings: ["Play now", "Find the words", "Terms apply"] },
  ]);
  assert.equal(verdicts.get("de")!.status, "warn");
  assert.match(verdicts.get("de")!.message, /Partly translated/);
  assert.equal(verdicts.get("ru")!.status, "pass");
  assert.equal(verdicts.get("ja")!.status, "warn");
  assert.match(verdicts.get("ja")!.message, /Not translated/);
});

test("an ad with one language is noted, not flagged", () => {
  const verdicts = languageChecks({ code: "en", strings: ["Play now"] }, [{ code: "de", strings: ["Play now"] }]);
  assert.equal(verdicts.get("de")!.status, "info");
  assert.equal(verdicts.get("en")!.status, "info");
});
