import type {
  FrameContext,
  ProbeResult,
  PromptPayload,
  ProviderDefinition,
  ProviderSelectors,
  ProviderStrategy,
} from "./contracts";
import { findFirstUsable, waitForElement } from "./dom";
import { ProviderError } from "./errors";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

export abstract class BaseDomStrategy implements ProviderStrategy {
  private activeComposer?: HTMLElement;

  protected constructor(
    readonly definition: ProviderDefinition,
    protected readonly selectors: ProviderSelectors,
    private readonly writer = new CompositeComposerWriter(),
    private readonly submitter = new ButtonSubmitter(),
  ) {}

  async probe(ctx: FrameContext): Promise<ProbeResult> {
    if (findFirstUsable(ctx.document, this.selectors.composer)) return { status: "ready" };
    if (this.selectors.login && findFirstUsable(ctx.document, this.selectors.login)) {
      return { status: "needs-login", detail: "请先在官方网站完成登录" };
    }
    return { status: "loading", detail: "正在等待输入框" };
  }

  async waitUntilReady(ctx: FrameContext): Promise<void> {
    const probe = await this.probe(ctx);
    if (probe.status === "needs-login") {
      throw new ProviderError("LOGIN_REQUIRED", probe.detail ?? "需要登录");
    }
    await waitForElement(ctx.document, this.selectors.composer, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
  }

  async writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    const composer = await waitForElement(ctx.document, this.selectors.composer, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
    this.writer.write(composer, prompt.text);
    this.activeComposer = composer;
  }

  async submit(ctx: FrameContext): Promise<void> {
    const button = await waitForElement(ctx.document, this.selectors.submit, {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
      anchor: this.activeComposer,
    }).catch((error: unknown) => {
      throw new ProviderError("SUBMIT_MISSING", "未找到可用的发送按钮", { cause: error });
    });
    this.submitter.submit(button);
  }
}
