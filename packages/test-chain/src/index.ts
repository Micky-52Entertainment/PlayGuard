import { devicesForGroup } from "@playable-lab/device-catalog";
import type { TestChain, TestStep } from "@playable-lab/protocol";

const idsOf = (group: TestStep["group"], take: number): string[] => {
  const devices = devicesForGroup(group);
  const ids: string[] = [];
  const limit = Math.min(take, devices.length);
  for (let i = 0; i < limit; i += 1) {
    ids.push(devices[i].id);
  }
  return ids;
};

const step = (
  id: string,
  label: string,
  group: TestStep["group"],
  orientation: TestStep["orientation"],
  take: number
): TestStep => ({
  id,
  label,
  group,
  orientation,
  deviceIds: idsOf(group, take),
  mode: "live",
});

export const defaultTestChain = (): TestChain => ({
  id: "android-ios-tablets",
  name: "Android → iOS → Tablets",
  steps: [
    step("android-portrait", "Android phones · portrait", "android", "portrait", 4),
    step("android-landscape", "Android phones · landscape", "android", "landscape", 4),
    step("ios-portrait", "iOS phones · portrait", "ios", "portrait", 4),
    step("ios-landscape", "iOS phones · landscape", "ios", "landscape", 4),
    step("tablet-portrait", "Tablets · portrait", "tablet", "portrait", 4),
    step("tablet-landscape", "Tablets · landscape", "tablet", "landscape", 4),
  ],
});

export const assertStepOrientationIsolated = (chain: TestChain): string | null => {
  for (let i = 0; i < chain.steps.length; i += 1) {
    const current = chain.steps[i];
    if (current.orientation !== "portrait" && current.orientation !== "landscape") {
      return `Step ${current.id} must be portrait or landscape, never both.`;
    }
  }
  return null;
};

export const nextStep = (
  chain: TestChain,
  currentStepId?: string
): TestStep | null => {
  if (!currentStepId) {
    return chain.steps[0] ?? null;
  }
  for (let i = 0; i < chain.steps.length; i += 1) {
    if (chain.steps[i].id === currentStepId) {
      return chain.steps[i + 1] ?? null;
    }
  }
  return null;
};
