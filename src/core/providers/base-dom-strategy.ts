import type {
  FrameContext,
  ProbeResult,
  PromptPayload,
  ProviderDefinition,
  ProviderSelectors,
  ProviderStrategy,
  ResponseBaseline,
  ResponseCaptureUpdate,
} from "./contracts";
import {
  findAllUsable,
  findFirstUsable,
  findFirstVisible,
  findUsableByText,
  normalizeComposerValue,
  readComposerValue,
  waitForCondition,
  waitForElement,
} from "./dom";
import { ProviderError } from "./errors";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

export abstract class BaseDomStrategy implements ProviderStrategy {
  protected activeComposer: HTMLElement | undefined;

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

  async prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline> {
    await this.waitUntilReady(ctx);
    const composer = await waitForElement(ctx.document, this.selectors.composer, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
    if (normalizeComposerValue(readComposerValue(composer))) {
      throw new ProviderError("COMPOSER_NOT_EMPTY", "官网输入框已有未发送内容，请先清空后重试");
    }
    if (!findFirstVisible(ctx.document, this.selectors.submitCandidate ?? this.selectors.submit)) {
      throw new ProviderError("SUBMIT_MISSING", "未找到发送控件，站点页面结构可能已更新");
    }
    if (this.selectors.generating && findFirstUsable(ctx.document, this.selectors.generating)) {
      throw new ProviderError("PROVIDER_BUSY", "官网仍在生成上一条回复，请等待完成后重试");
    }
    this.activeComposer = undefined;
    return this.responseBaseline(ctx.document);
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
    const composer = this.activeComposer;
    const promptBeforeSubmit = composer ? normalizeComposerValue(readComposerValue(composer)) : "";
    const urlBeforeSubmit = ctx.window.location.href;
    const button = await waitForElement(ctx.document, this.selectors.submit, {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
      anchor: this.activeComposer,
    }).catch((error: unknown) => {
      throw new ProviderError("SUBMIT_MISSING", "未找到可用的发送按钮", { cause: error });
    });
    this.submitter.submit(button);
    await waitForCondition(
      () => {
        const currentValue = composer ? normalizeComposerValue(readComposerValue(composer)) : "";
        return (
          currentValue !== promptBeforeSubmit ||
          !composer?.isConnected ||
          ctx.window.location.href !== urlBeforeSubmit ||
          button.getAttribute("aria-disabled") === "true" ||
          button.classList.contains("disabled")
        );
      },
      {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 8_000),
      },
    ).catch((error: unknown) => {
      throw new ProviderError("SUBMIT_UNCONFIRMED", "网页未确认消息已发送", { cause: error });
    });
  }

  async captureResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    onUpdate: (update: ResponseCaptureUpdate) => void | Promise<void>,
  ): Promise<ResponseCaptureUpdate> {
    if (!this.selectors.responses?.length) {
      return { status: "unsupported", message: "当前站点尚未配置回复采集规则" };
    }

    const timeoutMs = ctx.responseTimeoutMs ?? 180_000;
    const startedAt = Date.now();
    let latestText = "";
    let lastChangedAt = startedAt;
    let lastReportedText = "";

    while (Date.now() - startedAt < timeoutMs) {
      if (ctx.signal?.aborted) throw new ProviderError("ABORTED", "回复采集已取消");
      const current = this.responseBaseline(ctx.document);
      const hasNewResponse =
        current.count > baseline.count || current.lastText !== baseline.lastText;
      if (hasNewResponse && current.lastText) {
        if (current.lastText !== latestText) {
          latestText = current.lastText;
          lastChangedAt = Date.now();
        }
        if (latestText !== lastReportedText) {
          lastReportedText = latestText;
          await onUpdate({ status: "streaming", text: latestText });
        }
        const generating = this.selectors.generating
          ? Boolean(findFirstUsable(ctx.document, this.selectors.generating))
          : false;
        if (!generating && Date.now() - lastChangedAt >= 1_800) {
          return { status: "completed", text: latestText };
        }
      }
      await new Promise<void>((resolve) => ctx.window.setTimeout(resolve, 250));
    }

    return latestText
      ? { status: "partial", text: latestText, message: "等待回复结束超时，已保存当前可见内容" }
      : { status: "timeout", message: "等待 AI 回复超时" };
  }

  async startNewConversation(ctx: FrameContext): Promise<void> {
    const button =
      (this.selectors.newConversation
        ? findFirstUsable(ctx.document, this.selectors.newConversation)
        : undefined) ??
      (this.selectors.newConversationLabels
        ? findUsableByText(ctx.document, this.selectors.newConversationLabels)
        : undefined);
    if (!button) throw new ProviderError("NEW_CONVERSATION_MISSING", "未找到官网的新建对话按钮");

    const responsesBefore = this.responseBaseline(ctx.document).count;
    const urlBefore = ctx.window.location.href;
    const clickedAt = Date.now();
    button.click();
    await waitForCondition(
      () => {
        const composer = findFirstUsable(ctx.document, this.selectors.composer);
        if (!composer || normalizeComposerValue(readComposerValue(composer))) return false;
        return (
          ctx.window.location.href !== urlBefore ||
          this.responseBaseline(ctx.document).count < responsesBefore ||
          (responsesBefore === 0 && Date.now() - clickedAt >= 300)
        );
      },
      { ...(ctx.signal ? { signal: ctx.signal } : {}), timeoutMs: ctx.timeoutMs ?? 15_000 },
    ).catch((error: unknown) => {
      throw new ProviderError("NEW_CONVERSATION_UNCONFIRMED", "官网未确认已新建对话", {
        cause: error,
      });
    });
    this.activeComposer = undefined;
  }

  protected responseBaseline(document: Document): ResponseBaseline {
    const responses = this.selectors.responses
      ? findAllUsable(document, this.selectors.responses)
      : [];
    const lastText = normalizeComposerValue(
      responses.at(-1)?.innerText ?? responses.at(-1)?.textContent ?? "",
    );
    return { count: responses.length, lastText };
  }
}
