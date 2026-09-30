import assert from "node:assert/strict";
import test from "node:test";
import { wrapPlayableHtml } from "./index.ts";

test("keeps the doctype first so the playable stays in standards mode", () => {
  const wrapped = wrapPlayableHtml('<!DOCTYPE html><html lang="en"><head><title>x</title></head><body></body></html>', true);
  assert.ok(wrapped.startsWith('<!DOCTYPE html><html lang="en"><head><style>'));
  assert.ok(wrapped.includes("window.__playableLabIsSource=true"));
  assert.ok(wrapped.indexOf("__playableLabAds") < wrapped.indexOf("<title>"));
});

test("still injects into markup without a head", () => {
  assert.ok(wrapPlayableHtml("<!doctype html><canvas></canvas>", false).startsWith("<!doctype html><style>"));
  assert.ok(wrapPlayableHtml("<canvas></canvas>", false).startsWith("<style>"));
});

test("does not interpret replacement patterns in the playable source", () => {
  const html = "<html><head></head><body><script>var s = '$& $1 $$';</script></body></html>";
  assert.ok(wrapPlayableHtml(html, false).endsWith("<script>var s = '$& $1 $$';</script></body></html>"));
});
