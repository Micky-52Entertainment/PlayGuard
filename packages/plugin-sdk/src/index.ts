import type { PointerSample, SessionTrace } from "@playable-lab/protocol";

export interface PluginContext {
  sessionId: string;
  tracesDir: string;
}

export interface LabPlugin {
  id: string;
  name: string;
  onSessionStart?(context: PluginContext): void;
  onInputEvent?(event: PointerSample, context: PluginContext): void;
  onSessionEnd?(trace: SessionTrace, context: PluginContext): void | Promise<void>;
}

export const FUTURE_PLUGIN_SLOTS = [
  "e2e",
  "smoke",
  "heatmap",
  "performance",
  "network",
] as const;

export type FuturePluginSlot = (typeof FUTURE_PLUGIN_SLOTS)[number];
