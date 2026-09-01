export const providerIds = [
  "deepseek",
  "kimi",
  "coze",
  "chatgpt",
  "claude",
  "qwen",
  "minimax",
  "doubao",
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
  readonly blocked?: readonly string[];
  readonly responses?: readonly string[];
  readonly responseContent?: readonly string[];
  readonly responseExclude?: readonly string[];
  readonly responseTimeoutMs?: number;
  readonly responseQuietMs?: number;
  readonly responsePollMs?: number;
  readonly responseCapture?: ResponseCapturePlan;
  readonly generating?: readonly string[];
  readonly newConversation?: readonly string[];
  readonly newConversationLabels?: readonly string[];
}

export interface ResponseSelectorTier {
  readonly id: string;
  readonly selectors: readonly string[];
  readonly confidence: "canonical" | "semantic" | "fallback";
}

export interface ResponseCapturePlan {
  readonly turnTiers: readonly ResponseSelectorTier[];
  readonly finalContainers?: readonly string[];
  readonly contentBlocks?: readonly string[];
  readonly exclude?: readonly string[];
  readonly statusOnly?: readonly string[];
  readonly interrupted?: readonly string[];
  readonly interruptedLabels?: readonly string[];
  readonly observeAttributes?: readonly string[];
  readonly allowStableCompletionWithoutGenerating?: boolean;
}

export interface FrameContext {
  readonly document: Document;
  readonly window: Window;
  readonly nativeCopy?: NativeCopyClient;
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
  readonly keys?: readonly string[];
  readonly lastKey?: string;
  readonly entries?: readonly ResponseBaselineEntry[];
  readonly elements?: readonly HTMLElement[];
  readonly nativeCopyTargets?: readonly NativeCopyTarget[];
}

export interface ResponseBaselineEntry {
  readonly key: string;
  readonly text: string;
}

export type ResponseCaptureStatus =
  "waiting" | "streaming" | "completed" | "partial" | "timeout" | "failed" | "unsupported";

export type ResponseTerminalReason =
  | "completed"
  | "interrupted"
  | "aborted"
  | "timeout"
  | "navigation"
  | "verification"
  | "uncertain-final"
  | "failed"
  | "unsupported";

export type ResponseCaptureSource = "dom" | "native-copy" | "provider-api";

export type NativeCopyMimeType = "text/markdown" | "text/plain" | "text/html";

export interface NativeCopyPayload {
  readonly text: string;
  readonly mimeType: NativeCopyMimeType;
}

export interface NativeCopyRequest {
  readonly button: HTMLElement;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly suppressSystemClipboard?: boolean;
}

export interface NativeCopyClient {
  capture(request: NativeCopyRequest): Promise<NativeCopyPayload>;
}

export interface NativeCopyContext {
  readonly turnKey: string;
  readonly domText: string;
  readonly domMarkdown: string;
  readonly prompt?: string;
}

export interface NativeCopyTarget {
  readonly key: string;
  readonly response: HTMLElement;
  readonly button: HTMLElement;
}

export interface NativeCopyTargetSelectionContext {
  readonly baseline: ResponseBaseline;
  readonly prompt?: string;
}

export interface NativeCopyCapturePolicy {
  readonly maxAttempts?: number;
  readonly requireDomEndingAnchor?: boolean;
}

export interface NativeCopyAdapter {
  readonly id: string;
  readonly capturePolicy?: NativeCopyCapturePolicy;
  locateCopyButton(ctx: FrameContext, response: HTMLElement): HTMLElement | undefined;
  listTargets?(ctx: FrameContext): readonly NativeCopyTarget[];
  selectTarget?(
    ctx: FrameContext,
    targets: readonly NativeCopyTarget[],
    context: NativeCopyTargetSelectionContext,
  ): NativeCopyTarget | undefined;
  isTerminalTarget?(ctx: FrameContext, target: NativeCopyTarget): boolean;
  prepareCopy?(
    ctx: FrameContext,
    response: HTMLElement,
    button: HTMLElement | undefined,
  ): Promise<void>;
  isReady?(ctx: FrameContext, response: HTMLElement, button: HTMLElement): boolean;
  normalize?(payload: NativeCopyPayload, context: NativeCopyContext): NativeCopyPayload;
}

export interface ResponseCaptureUpdate {
  readonly status: ResponseCaptureStatus;
  readonly text?: string;
  readonly markdown?: string;
  readonly message?: string;
  readonly terminalReason?: ResponseTerminalReason;
  readonly captureSource?: ResponseCaptureSource;
  readonly nativeMimeType?: NativeCopyMimeType;
}

export interface ComposerCandidateDiagnostic {
  readonly descriptor: string;
  readonly score: number;
  readonly normalizedLength: number;
  readonly selected: boolean;
  readonly eligible: boolean;
  readonly reason?: "hidden" | "disabled" | "readonly" | "search" | "not-editable";
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
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate>;
  finalizeResponse?(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate | undefined>;
  startNewConversation(ctx: FrameContext): Promise<void>;
  diagnoseComposerCandidates?(ctx: FrameContext): readonly ComposerCandidateDiagnostic[];
}

export interface ProviderPlugin {
  readonly definition: ProviderDefinition;
  createStrategy(): ProviderStrategy;
}
