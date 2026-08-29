import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceProfile } from "@playable-lab/protocol";
import { mapToTarget, viewportForDevice } from "./index.ts";

const phone: DeviceProfile = {
  id: "se",
  name: "SE",
  group: "ios",
  os: "ios",
  width: 375,
  height: 667,
  dpr: 2,
};

const tablet: DeviceProfile = {
  id: "pad",
  name: "Pad",
  group: "tablet",
  os: "ios",
  width: 834,
  height: 1194,
  dpr: 2,
};

test("maps the same normalized tap to each screen size", () => {
  const source = viewportForDevice(phone, "portrait");
  const target = viewportForDevice(tablet, "portrait");
  const onPhone = mapToTarget(0.5, 0.25, source);
  const onTablet = mapToTarget(0.5, 0.25, target);
  assert.equal(Math.round(onPhone.x), Math.round(source.cssWidth * 0.5));
  assert.equal(Math.round(onTablet.x), Math.round(target.cssWidth * 0.5));
  assert.notEqual(onPhone.x, onTablet.x);
});

test("swaps width and height for landscape", () => {
  const portrait = viewportForDevice(phone, "portrait");
  const landscape = viewportForDevice(phone, "landscape");
  assert.equal(portrait.cssWidth, 375);
  assert.equal(landscape.cssWidth, 667);
});
