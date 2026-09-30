import assert from "node:assert/strict";
import test from "node:test";
import { OLD_PROFILES, oldBrowserScript, oldCodeCheck, scanFeatures } from "./compat.ts";

const [ios13, ios14, android] = OLD_PROFILES;

test("reads modern syntax and APIs out of the code", async () => {
  const found = await scanFeatures(["var a = b?.c ?? 1; list.at(-1); s.replaceAll('a','b'); x ||= 2; new AudioContext();"], false);
  assert.ok(found);
  for (const id of ["optional-chaining", "nullish", "array-at", "replace-all", "logical-assign", "audio-context"]) {
    assert.ok(found.has(id), `${id} was not found`);
  }
});

test("old code is fine for every old phone", async () => {
  const found = await scanFeatures(["var a = b && b.c; var ctx = new (window.AudioContext || window.webkitAudioContext)();"], false);
  for (const profile of OLD_PROFILES) {
    assert.equal(oldCodeCheck(profile, found).status, "pass", profile.name);
  }
});

test("syntax an old browser lacks stops the code; an API only warns", async () => {
  const syntax = await scanFeatures(["var a = b?.c;"], false);
  assert.equal(oldCodeCheck(ios13, syntax).status, "fail");
  assert.equal(oldCodeCheck(ios14, syntax).status, "pass", "Safari 14 knows optional chaining");
  assert.equal(oldCodeCheck(android, syntax).status, "fail");
  const api = await scanFeatures(["Object.hasOwn(a, 'b');"], false);
  assert.equal(oldCodeCheck(ios14, api).status, "warn");
});

test("WebP images do not show on iOS 13", async () => {
  const found = await scanFeatures([""], true);
  assert.equal(oldCodeCheck(ios13, found).status, "warn");
  assert.equal(oldCodeCheck(ios14, found).status, "pass");
});

test("the old-browser script takes away only what that browser lacks", () => {
  const gone = (script: string): string[] => JSON.parse(/var gone = (\[.*?\]);/.exec(script)![1]) as string[];
  assert.ok(gone(oldBrowserScript(ios13)).includes("replace-all"));
  assert.ok(!gone(oldBrowserScript(ios14)).includes("replace-all"), "Safari 14 has replaceAll");
  assert.ok(gone(oldBrowserScript(ios14)).includes("audio-context"), "Safari 14.0 has only webkitAudioContext");
});
