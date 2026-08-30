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
  readonly responses?: readonly string[];
  readonly generating?: readonly string[];
  readonly newConversation?: readonly string[];
  readonly newConversationLabels?: readonly string[];
}

export interface FrameContext {
  readonly document: Document;
  readonly window: Window;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly responseTimeoutMs?: number;
}

export interface PromptPayload {
  readonly text: string;
}

export type ProbeStatus = "ready" | "needs-login" | "loading" | "blocked";

export interface ProbeResult {
  readonly status: ProbeStatus;
  readonly detail?: string;
}

export interface ResponseBaseline {
  readonly count: number;
  readonly lastText: string;
}

export type ResponseCaptureStatus =
  "waiting" | "streaming" | "completed" | "partial" | "timeout" | "failed" | "unsupported";

export interface ResponseCaptureUpdate {
  readonly status: ResponseCaptureStatus;
  readonly text?: string;
  readonly message?: string;
}

export interface ProviderStrategy {
  readonly definition: ProviderDefinition;
  probe(ctx: FrameContext): Promise<ProbeResult>;
  waitUntilReady(ctx: FrameContext): Promise<void>;
  /** Read-only validation. It must not require a send control or mutate the composer. */
  prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline>;
  writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  /** Writes and verifies the prompt, then waits until a usable send control exists. */
  stagePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  /** Clears only the prompt staged by this transaction. */
  rollbackPrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void>;
  submit(ctx: FrameContext): Promise<void>;
  captureResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    onUpdate: (update: ResponseCaptureUpdate) => void | Promise<void>,
  ): Promise<ResponseCaptureUpdate>;
  startNewConversation(ctx: FrameContext): Promise<void>;
}

export interface ProviderPlugin {
  readonly definition: ProviderDefinition;
  createStrategy(): ProviderStrategy;
}
