export const providerIds = [
  "deepseek",
  "kimi",
  "coze",
  "chatgpt",
  "claude",
  "qwen",
  "minimax",
] as const;

export type BuiltInProviderId = (typeof providerIds)[number];
export type ProviderId = BuiltInProviderId;
export type EmbedMode = "preferred" | "experimental" | "tab-only";

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly name: string;
  readonly shortName: string;
  readonly defaultUrl: string;
  readonly matches: readonly string[];
  readonly accent: string;
  readonly embedMode: EmbedMode;
}

export interface ProviderSelectors {
  readonly composer: readonly string[];
  readonly submit: readonly string[];
  readonly login?: readonly string[];
}

export interface FrameContext {
  readonly document: Document;
  readonly window: Window;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface PromptPayload {
  readonly text: string;
}

export type ProbeStatus = "ready" | "needs-login" | "loading" | "blocked";

export interface ProbeResult {
  readonly status: ProbeStatus;
  readonly detail?: string;
}

export interface ProviderStrategy {
  readonly definition: ProviderDefinition;
  probe(ctx: FrameContext): Promise<ProbeResult>;
  waitUntilReady(ctx: FrameContext): Promise<void>;
  writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  submit(ctx: FrameContext): Promise<void>;
}

export interface ProviderPlugin {
  readonly definition: ProviderDefinition;
  createStrategy(): ProviderStrategy;
}
