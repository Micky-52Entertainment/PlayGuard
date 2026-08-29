import type { EngineKind } from "@playable-lab/protocol";

export interface DetectedBuild {
  engine: EngineKind;
  entryFile: string;
}

export const detectEngine = (html: string, fileName: string): EngineKind => {
  const lower = html.toLowerCase();
  if (
    lower.includes("luna.unity") ||
    lower.includes("luna_playworks") ||
    lower.includes("lunaplayworks")
  ) {
    return "luna";
  }
  if (
    lower.includes("cc.game") ||
    lower.includes("cocos2d") ||
    lower.includes("application-canvas") ||
    fileName.toLowerCase().includes("cocos")
  ) {
    return "cocos";
  }
  return "vanilla";
};

export const describeEngine = (engine: EngineKind): string => {
  if (engine === "luna") {
    return "Luna Playworks (Unity HTML5)";
  }
  if (engine === "cocos") {
    return "Cocos Creator web-mobile";
  }
  return "Clear JS / vanilla HTML5";
};
