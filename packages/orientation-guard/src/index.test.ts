import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSessionOrientation } from "./index.ts";

test("keeps a locked portrait session running", () => {
  const verdict = evaluateSessionOrientation("portrait", 390, 844);
  assert.equal(verdict.ok, true);
});

test("aborts when the device rotates mid-session", () => {
  const verdict = evaluateSessionOrientation("portrait", 844, 390);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "ORIENTATION_CHANGED");
    assert.match(verdict.reason, /Replay this step/);
  }
});

test("aborts if two orientations appear in one session", () => {
  const verdict = evaluateSessionOrientation("portrait", 390, 844, "landscape");
  assert.equal(verdict.ok, false);
});
