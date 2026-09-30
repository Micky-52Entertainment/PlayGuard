import Anthropic from "@anthropic-ai/sdk";
import type { CheckResult } from "@playable-lab/checks";
import type { Orientation } from "@playable-lab/protocol";
import OpenAI from "openai";

export type Lang = "en" | "ru" | "fr";
export type Severity = "blocker" | "major" | "minor";

export interface AiIssue {
  severity: Severity;
  text: string;
  /** Turn of the playthrough the issue was seen on; absent for a screenshot review. */
  turn?: number;
}

export interface AiTurn {
  turn: number;
  /** Ms since the playable's load. */
  at: number;
  see: string;
  actions: string[];
  /** Whether the screen differed from the previous turn's. */
  changed?: boolean;
}

export type AiOutcome = "store" | "finished" | "stuck" | "steps" | "budget" | "error" | "reviewed";

/** What the AI tester did and found on one screen. */
export interface AiRunInfo {
  mode: "play" | "review";
  provider: string;
  model: string;
  turns: AiTurn[];
  issues: AiIssue[];
  outcome: AiOutcome;
  note?: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Shared by every model call of one run, so the whole run has one ceiling. */
export interface TokenBudget {
  limit: number;
  used: number;
  calls: number;
  input: number;
  output: number;
}

export type AiAction =
  | { kind: "tap"; x: number; y: number }
  | { kind: "drag"; x: number; y: number; x2: number; y2: number }
  | { kind: "hold"; x: number; y: number; ms: number }
  | { kind: "wait"; ms: number };

export interface AiDecision {
  see: string;
  actions: AiAction[];
  issues: Array<{ severity: Severity; text: string }>;
  status: "playing" | "finished" | "stuck";
}

export const MAX_ACTIONS = 5;
export const MAX_WAIT_MS = 3000;

const SEVERITIES: Severity[] = ["blocker", "major", "minor"];

const ISSUE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["severity", "text"],
    properties: {
      severity: { type: "string", enum: SEVERITIES },
      text: { type: "string" },
    },
  },
};

export const PLAY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["see", "actions", "issues", "status"],
  properties: {
    see: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
    issues: ISSUE_SCHEMA,
    status: { type: "string", enum: ["playing", "finished", "stuck"] },
  },
};

export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["see", "issues"],
  properties: {
    see: { type: "string" },
    issues: ISSUE_SCHEMA,
  },
};

const LANGUAGE: Record<Lang, string> = { en: "English", ru: "Russian", fr: "French" };

const DEFECTS =
  "text or UI cut off by the screen edge, overlapping or off-screen elements, stretched or squashed art, " +
  "large empty or black areas, unreadable text, content shown sideways for this orientation";

const SEVERITY_RULE =
  "severity: blocker = the ad cannot be played or installed; major = clearly broken layout or behaviour; minor = cosmetic.";

export const playSystemPrompt = (lang: Lang): string =>
  `You are a QA tester playing a mobile playable ad: a short interactive ad that ends with an install button. Each turn you get one screenshot of the ad on a specific screen. Play it like a first-time user, all the way to the end card, press the install button, and watch for defects on the way.

Reply fields:
- see: what is on screen now, 12 words at most.
- actions: 1 to ${MAX_ACTIONS} inputs, executed in order before your next screenshot. Formats:
  "tap X Y" | "drag X1 Y1 X2 Y2" (a swipe, or pull and release) | "hold X Y MS" | "wait MS" (${MAX_WAIT_MS} at most)
  X and Y are percentages of the screenshot: 0 0 is the top-left corner, 100 100 the bottom-right.
  Send several at once when the next moves are obvious; send one when you need to see its result. Follow tutorial hints (hands, arrows, highlighted objects). If the last turn changed nothing, try something different.
- issues: defects you have evidence of in this screenshot or in how the ad responded: ${DEFECTS}, no reaction to correct input, a game that cannot be finished, a missing or unreachable install button. Leave out matters of taste and anything listed under "Already reported". Usually empty.
  ${SEVERITY_RULE}
- status: "finished" once the ad has nothing more to do; "stuck" when you have no new idea after turns that changed nothing; otherwise "playing".

Write see and the issue texts in ${LANGUAGE[lang]}.`;

export const reviewSystemPrompt = (lang: Lang): string =>
  `You are a QA tester checking how a mobile playable ad fits one screen. You get screenshots of the ad on that screen: right after loading, then at the end of an automated replay of a tester's inputs.

Report only layout defects you can see: ${DEFECTS}, an install button that is missing from an end card or partly off-screen. The replayed taps are approximate on this screen, so the game being at another stage or unfinished is not a defect.

Reply fields:
- see: the last screenshot in 12 words at most.
- issues: usually empty. ${SEVERITY_RULE}

Write see and the issue texts in ${LANGUAGE[lang]}.`;

export interface PlayTurnContext {
  width: number;
  height: number;
  orientation: Orientation;
  turn: number;
  maxTurns: number;
  /** Ms since the playable's load. */
  at: number;
  previous: AiTurn[];
  lastChanged?: boolean;
  reported: string[];
}

const HISTORY_TURNS = 6;

/** The per-turn text: everything the model needs besides the screenshot, and nothing more. */
export const playTurnText = (context: PlayTurnContext): string => {
  const lines: string[] = [
    `Screen ${context.width}x${context.height} ${context.orientation}. Turn ${context.turn} of ${context.maxTurns}${context.turn === context.maxTurns ? " (the last one)" : ""}. ${(context.at / 1000).toFixed(1)} s since the ad loaded.`,
  ];
  const previous = context.previous;
  if (previous.length > 0 && context.lastChanged !== undefined) {
    lines.push(
      `Your last turn ${context.lastChanged ? "changed the screen" : "did NOT change the screen"}.`
    );
  }
  if (previous.length > 0) {
    lines.push("Turns so far:");
    const from = Math.max(0, previous.length - HISTORY_TURNS);
    for (let i = from; i < previous.length; i += 1) {
      lines.push(`${previous[i].turn}. ${previous[i].see} | ${previous[i].actions.join("; ") || "no input"}`);
    }
  }
  if (context.reported.length > 0) {
    lines.push(`Already reported: ${context.reported.join("; ")}`);
  }
  return lines.join("\n");
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Reads one action string. Returns null for anything it cannot act on. */
export const parseAction = (raw: string): AiAction | null => {
  const text = String(raw).trim().toLowerCase();
  const kind = (/^(tap|drag|hold|wait)\b/.exec(text) || [])[1];
  const numbers = (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const pct = (index: number): number => clamp(numbers[index], 0, 100);
  if (kind === "tap" && numbers.length >= 2) {
    return { kind, x: pct(0), y: pct(1) };
  }
  if (kind === "drag" && numbers.length >= 4) {
    return { kind, x: pct(0), y: pct(1), x2: pct(2), y2: pct(3) };
  }
  if (kind === "hold" && numbers.length >= 2) {
    return { kind, x: pct(0), y: pct(1), ms: clamp(numbers[2] ?? 800, 100, MAX_WAIT_MS) };
  }
  if (kind === "wait" && numbers.length >= 1) {
    return { kind, ms: clamp(numbers[0], 0, MAX_WAIT_MS) };
  }
  return null;
};

export const formatAction = (action: AiAction): string => {
  const n = (value: number): string => String(Math.round(value));
  if (action.kind === "tap") {
    return `tap ${n(action.x)} ${n(action.y)}`;
  }
  if (action.kind === "drag") {
    return `drag ${n(action.x)} ${n(action.y)} ${n(action.x2)} ${n(action.y2)}`;
  }
  if (action.kind === "hold") {
    return `hold ${n(action.x)} ${n(action.y)} ${n(action.ms)}`;
  }
  return `wait ${n(action.ms)}`;
};

const parseIssues = (raw: unknown): AiDecision["issues"] => {
  const issues: AiDecision["issues"] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i += 1) {
    const text = String(list[i]?.text ?? "").trim();
    const severity = SEVERITIES.includes(list[i]?.severity) ? (list[i].severity as Severity) : "minor";
    if (text) {
      issues.push({ severity, text });
    }
  }
  return issues;
};

/** Model output is data from outside: keep what is usable, drop the rest. */
export const parseDecision = (raw: unknown): AiDecision => {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const actions: AiAction[] = [];
  const list = Array.isArray(value.actions) ? value.actions : [];
  for (let i = 0; i < list.length && actions.length < MAX_ACTIONS; i += 1) {
    const action = parseAction(String(list[i]));
    if (action) {
      actions.push(action);
    }
  }
  const status = value.status === "finished" || value.status === "stuck" ? value.status : "playing";
  return {
    see: String(value.see ?? "").trim().slice(0, 160),
    actions,
    issues: parseIssues(value.issues),
    status,
  };
};

/** Adds the issues that were not reported yet; returns how many were new. */
export const mergeIssues = (
  known: AiIssue[],
  found: AiDecision["issues"],
  turn?: number
): number => {
  let added = 0;
  for (let i = 0; i < found.length; i += 1) {
    const key = found[i].text.toLowerCase();
    if (!known.some((issue) => issue.text.toLowerCase() === key)) {
      known.push({ ...found[i], turn });
      added += 1;
    }
  }
  return added;
};

const OUTCOME_TEXT: Record<AiOutcome, string> = {
  store: "played through and opened the store",
  finished: "finished without a store call",
  stuck: "could not get further: the screen stopped reacting",
  steps: "ran out of turns before the end card",
  budget: "stopped at the token budget",
  error: "stopped on a model error",
  reviewed: "reviewed the replay's screenshots",
};

/** The AI tester's findings as one row of the screens x checks matrix. */
export const aiCheck = (info: AiRunInfo): CheckResult => {
  const blockers = info.issues.filter((issue) => issue.severity === "blocker").length;
  const majors = info.issues.filter((issue) => issue.severity === "major").length;
  const incomplete = info.outcome === "stuck" || info.outcome === "error";
  const head =
    info.mode === "play"
      ? `Played ${info.turns.length} turn${info.turns.length === 1 ? "" : "s"}, ${OUTCOME_TEXT[info.outcome]}`
      : `Looked at the screen after the replay`;
  return {
    id: "ai",
    title: "AI tester",
    status: blockers > 0 ? "fail" : majors > 0 || incomplete ? "warn" : "pass",
    message:
      `${head}${info.note ? ` (${info.note})` : ""}. ` +
      (info.issues.length > 0
        ? `${info.issues.length} issue${info.issues.length === 1 ? "" : "s"} reported.`
        : "No issues reported."),
    details: info.issues.map((issue) => `${issue.severity}: ${issue.text}`),
  };
};

export interface AiRequest {
  kind: "play" | "review";
  system: string;
  text: string;
  /** JPEG, base64. */
  images: string[];
  schema: Record<string, unknown>;
}

export interface AiReply {
  json: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  id: string;
  model: string;
  ask(request: AiRequest): Promise<AiReply>;
}

const parseJson = (text: string, stopped: string | null | undefined): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The model's reply was not valid JSON (stop reason: ${stopped || "unknown"}).`);
  }
};

const claudeProvider = (model: string): AiProvider => {
  const client = new Anthropic();
  // Haiku 4.5 has no effort control; everywhere else low effort keeps thinking short.
  const effort = /haiku/i.test(model) ? {} : { effort: "low" as const };
  return {
    id: "claude",
    model,
    ask: async (request) => {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system: request.system,
        messages: [
          {
            role: "user",
            content: [
              ...request.images.map(
                (data): Anthropic.ImageBlockParam => ({
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data },
                })
              ),
              { type: "text", text: request.text },
            ],
          },
        ],
        output_config: { ...effort, format: { type: "json_schema", schema: request.schema } },
      });
      if (response.stop_reason === "refusal") {
        throw new Error("The model declined to look at this screen.");
      }
      let text = "";
      for (const block of response.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
      const usage = response.usage;
      return {
        json: parseJson(text, response.stop_reason),
        inputTokens:
          usage.input_tokens + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
        outputTokens: usage.output_tokens,
      };
    },
  };
};

const gptProvider = (model: string, imageSide: number): AiProvider => {
  const client = new OpenAI();
  // "low" is a flat, small token cost per image; it downsamples to 512 px.
  const detail = imageSide <= 512 ? ("low" as const) : ("auto" as const);
  const reasoning = /^(gpt-5|o\d)/i.test(model) ? { reasoning_effort: "low" as const } : {};
  return {
    id: "gpt",
    model,
    ask: async (request) => {
      const response = await client.chat.completions.create({
        model,
        ...reasoning,
        messages: [
          { role: "system", content: request.system },
          {
            role: "user",
            content: [
              ...request.images.map((data) => ({
                type: "image_url" as const,
                image_url: { url: `data:image/jpeg;base64,${data}`, detail },
              })),
              { type: "text" as const, text: request.text },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: request.kind, strict: true, schema: request.schema },
        },
      });
      const choice = response.choices[0];
      if (!choice || choice.message.refusal) {
        throw new Error("The model declined to look at this screen.");
      }
      return {
        json: parseJson(choice.message.content || "", choice.finish_reason),
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    },
  };
};

/**
 * No model and no tokens: taps pseudo-random points. Finds crashes a careless
 * player would hit, and exercises the autoplay pipeline without an API key.
 */
const monkeyProvider = (seed: number): AiProvider => {
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    id: "monkey",
    model: "random taps",
    ask: async (request) => {
      if (request.kind === "review") {
        return { json: { see: "", issues: [] }, inputTokens: 0, outputTokens: 0 };
      }
      const actions: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        actions.push(`tap ${Math.round(8 + random() * 84)} ${Math.round(8 + random() * 84)}`);
      }
      return {
        json: { see: "random taps", actions, issues: [], status: "playing" },
        inputTokens: 0,
        outputTokens: 0,
      };
    },
  };
};

export const AI_PROVIDERS = ["claude", "gpt", "monkey"];

export const createProvider = (
  id: string,
  model: string | undefined,
  options: { imageSide: number; seed: number }
): AiProvider => {
  if (id === "claude") {
    return claudeProvider(model || "claude-opus-5-5");
  }
  if (id === "gpt") {
    return gptProvider(model || process.env.OPENAI_MODEL || "gpt-5-mini", options.imageSide);
  }
  if (id === "monkey") {
    return monkeyProvider(options.seed);
  }
  throw new Error(`Unknown --ai "${id}". Use one of: ${AI_PROVIDERS.join(", ")}.`);
};

/** One model call, counted against the run's budget. */
export const askWithinBudget = async (
  provider: AiProvider,
  budget: TokenBudget,
  info: AiRunInfo,
  request: AiRequest
): Promise<unknown> => {
  const reply = await provider.ask(request);
  budget.calls += 1;
  budget.input += reply.inputTokens;
  budget.output += reply.outputTokens;
  budget.used += reply.inputTokens + reply.outputTokens;
  info.calls += 1;
  info.inputTokens += reply.inputTokens;
  info.outputTokens += reply.outputTokens;
  return reply.json;
};

export const describeAiError = (error: unknown): string => {
  if (error instanceof Anthropic.AuthenticationError || error instanceof OpenAI.AuthenticationError) {
    return "the API key was rejected";
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof OpenAI.RateLimitError) {
    return "rate limited";
  }
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return `API error ${error.status ?? ""}: ${error.message.split("\n")[0]}`.trim();
  }
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
};
