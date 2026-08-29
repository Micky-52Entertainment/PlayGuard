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
