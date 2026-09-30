import type { DeviceGroup, DeviceProfile } from "@playable-lab/protocol";

export const DEVICE_CATALOG: DeviceProfile[] = [
  {
    id: "pixel-7",
    name: "Pixel 7",
    group: "android",
    os: "android",
    width: 412,
    height: 915,
    dpr: 2.625,
  },
  {
    id: "pixel-8a",
    name: "Pixel 8a",
    group: "android",
    os: "android",
    width: 412,
    height: 915,
    dpr: 2.625,
  },
  {
    id: "s24-ultra",
    name: "Samsung S24 Ultra",
    group: "android",
    os: "android",
    width: 412,
    height: 915,
    dpr: 3.5,
  },
  {
    id: "xiaomi-14",
    name: "Xiaomi 14 Pro",
    group: "android",
    os: "android",
    width: 400,
    height: 900,
    dpr: 3,
  },
  {
    id: "xperia-1",
    name: "Sony Xperia 1 V",
    group: "android",
    os: "android",
    width: 411,
    height: 960,
    dpr: 3.5,
  },
  {
    id: "galaxy-s7",
    name: "Galaxy S7",
    group: "android",
    os: "android",
    width: 360,
    height: 640,
    dpr: 4,
  },
  {
    id: "z-fold-5-cover",
    name: "Galaxy Z Fold 5 (folded)",
    group: "android",
    os: "android",
    width: 344,
    height: 882,
    dpr: 3,
  },
  {
    id: "iphone-16-pro-max",
    name: "iPhone 16 Pro Max",
    group: "ios",
    os: "ios",
    width: 440,
    height: 956,
    dpr: 3,
  },
  {
    id: "iphone-16-pro",
    name: "iPhone 16 Pro",
    group: "ios",
    os: "ios",
    width: 402,
    height: 874,
    dpr: 3,
  },
  {
    id: "iphone-14",
    name: "iPhone 14",
    group: "ios",
    os: "ios",
    width: 390,
    height: 844,
    dpr: 3,
  },
  {
    id: "iphone-se",
    name: "iPhone SE (3rd gen)",
    group: "ios",
    os: "ios",
    width: 375,
    height: 667,
    dpr: 2,
  },
  {
    id: "ipad-pro-13",
    name: "iPad Pro 13 (M4)",
    group: "tablet",
    os: "ios",
    width: 1024,
    height: 1366,
    dpr: 2,
  },
  {
    id: "ipad-pro-11",
    name: "iPad Pro 11 (M4)",
    group: "tablet",
    os: "ios",
    width: 834,
    height: 1194,
    dpr: 2,
  },
  {
    id: "ipad-10",
    name: "iPad 10.2\"",
    group: "tablet",
    os: "ios",
    width: 810,
    height: 1080,
    dpr: 2,
  },
  {
    id: "z-fold-5-open",
    name: "Galaxy Z Fold 5 (unfolded)",
    group: "tablet",
    os: "android",
    width: 690,
    height: 829,
    dpr: 2.625,
  },
  {
    id: "tab-s9",
    name: "Galaxy Tab S9 11\"",
    group: "tablet",
    os: "android",
    width: 800,
    height: 1280,
    dpr: 2.4,
  },
  {
    id: "tab-s9-ultra",
    name: "Galaxy Tab S9 Ultra",
    group: "tablet",
    os: "android",
    width: 912,
    height: 1440,
    dpr: 2.4,
  },
];

/**
 * One screen per shape, from the narrowest phone to a near-square foldable.
 * Similar phones tell you nothing new; these show how the layout adapts.
 */
export const FORMAT_SET: string[] = [
  "xperia-1",
  "pixel-7",
  "iphone-se",
  "tab-s9",
  "ipad-10",
  "z-fold-5-open",
];

const RATIOS: Array<[string, number]> = [
  ["21:9", 21 / 9],
  ["20:9", 20 / 9],
  ["19.5:9", 19.5 / 9],
  ["18:9", 2],
  ["16:9", 16 / 9],
  ["16:10", 1.6],
  ["10:7", 10 / 7],
  ["4:3", 4 / 3],
  ["6:5", 1.2],
];

/** Nearest familiar aspect ratio of the screen, long side first. */
export const formatLabel = (device: DeviceProfile): string => {
  const ratio = Math.max(device.width, device.height) / Math.min(device.width, device.height);
  let best = RATIOS[0];
  for (let i = 1; i < RATIOS.length; i += 1) {
    if (Math.abs(RATIOS[i][1] - ratio) < Math.abs(best[1] - ratio)) {
      best = RATIOS[i];
    }
  }
  return best[0];
};

export const devicesById = (): Map<string, DeviceProfile> => {
  const map = new Map<string, DeviceProfile>();
  for (let i = 0; i < DEVICE_CATALOG.length; i += 1) {
    map.set(DEVICE_CATALOG[i].id, DEVICE_CATALOG[i]);
  }
  return map;
};

export const devicesForGroup = (group: DeviceGroup): DeviceProfile[] => {
  const result: DeviceProfile[] = [];
  for (let i = 0; i < DEVICE_CATALOG.length; i += 1) {
    if (DEVICE_CATALOG[i].group === group) {
      result.push(DEVICE_CATALOG[i]);
    }
  }
  return result;
};

/** The kinds of device a team turns on and off: what a check runs on. */
export type Platform = "android" | "ios" | "tablet" | "foldable";

export const PLATFORMS: Platform[] = ["android", "ios", "tablet", "foldable"];

export const platformOf = (device: DeviceProfile): Platform =>
  /fold/.test(device.id) ? "foldable" : device.group === "tablet" ? "tablet" : device.os === "ios" ? "ios" : "android";
