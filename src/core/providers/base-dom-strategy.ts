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
  findFirstUsable,
  findUsableByText,
  isElementUsable,
  normalizeComposerValue,
  readComposerValue,
  waitForCondition,
  waitForElement,
  waitForResolvedElement,
} from "./dom";
import { ProviderError } from "./errors";
import { readResponseContent, type ResponseContentSnapshot } from "./response-content";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

export abstract class BaseDomStrategy implements ProviderStrategy {
  protected activeComposer: HTMLElement | undefined;
  protected stagedSubmitControl: HTMLElement | undefined;

  protected constructor(
    readonly definition: ProviderDefinition,
    protected readonly selectors: ProviderSelectors,
    private readonly writer = new CompositeComposerWriter(),
    private readonly submitter = new ButtonSubmitter(),
  ) {}

  async probe(ctx: FrameContext): Promise<ProbeResult> {
    if (this.selectors.blocked && findFirstUsable(ctx.document, this.selectors.blocked)) {
      return { status: "blocked", detail: "官网要求完成人工验证，请验证后重试" };
    }
    if (this.findComposer(ctx.document)) return { status: "ready" };
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
    if (probe.status === "blocked") {
      throw new ProviderError(
        "VERIFICATION_REQUIRED",
        probe.detail ?? "官网要求完成人工验证，请验证后重试",
      );
    }
    await this.waitForComposer(ctx);
  }

  async prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline> {
    this.activeComposer = undefined;
    this.stagedSubmitControl = undefined;
    await this.waitUntilReady(ctx);
    const composer = await this.waitForComposer(ctx);
    if (normalizeComposerValue(readComposerValue(composer))) {
      throw new ProviderError("COMPOSER_NOT_EMPTY", "官网输入框已有未发送内容，请先清空后重试");
    }
    if (this.selectors.generating && findFirstUsable(ctx.document, this.selectors.generating)) {
      throw new ProviderError("PROVIDER_BUSY", "官网仍在生成上一条回复，请等待完成后重试");
    }
    this.activeComposer = composer;
    return this.responseBaseline(ctx.document);
  }

  async writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    const composer = this.activeComposer ?? (await this.waitForComposer(ctx));
    if (!composer.isConnected || !isElementUsable(composer)) {
      throw new ProviderError("COMPOSER_NOT_READY", "预检选定的官网输入框已被页面替换，请重新发送");
    }
    this.writer.write(composer, prompt.text);
    this.activeComposer = composer;
  }

  async stagePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    await this.writePrompt(ctx, prompt);
    const button = await waitForElement(ctx.document, this.selectors.submit, {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
      anchor: this.activeComposer,
    }).catch((error: unknown) => {
      throw new ProviderError("SUBMIT_MISSING", "写入内容后仍未找到可用的发送按钮", {
        cause: error,
      });
    });
    this.validateStagedSubmitControl(button);
    this.stagedSubmitControl = button;
  }

  async rollbackPrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    const composer = this.activeComposer;
    if (
      composer?.isConnected &&
      normalizeComposerValue(readComposerValue(composer)) === normalizeComposerValue(prompt.text)
    ) {
      await this.writePrompt(ctx, { text: "" });
    }
    this.activeComposer = undefined;
    this.stagedSubmitControl = undefined;
  }

  async submit(ctx: FrameContext): Promise<void> {
    const composer = this.activeComposer;
    const promptBeforeSubmit = composer ? normalizeComposerValue(readComposerValue(composer)) : "";
    const urlBeforeSubmit = ctx.window.location.href;
    const button =
      this.stagedSubmitControl?.isConnected &&
      findFirstUsable(ctx.document, this.selectors.submit, this.activeComposer) ===
        this.stagedSubmitControl
        ? this.stagedSubmitControl
        : await waitForElement(ctx.document, this.selectors.submit, {
            signal: ctx.signal,
            timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
            anchor: this.activeComposer,
          }).catch((error: unknown) => {
            throw new ProviderError("SUBMIT_MISSING", "未找到可用的发送按钮", { cause: error });
          });
    this.validateStagedSubmitControl(button);
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
    this.stagedSubmitControl = undefined;
  }

  async captureResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    onUpdate: (update: ResponseCaptureUpdate) => void | Promise<void>,
  ): Promise<ResponseCaptureUpdate> {
    if (!this.selectors.responses?.length) {
      return { status: "unsupported", message: "当前站点尚未配置回复采集规则" };
    }

    const timeoutMs = this.selectors.responseTimeoutMs ?? ctx.responseTimeoutMs ?? 180_000;
    const quietMs = this.selectors.responseQuietMs ?? 1_800;
    const pollMs = this.selectors.responsePollMs ?? 1_000;
    const startedAt = Date.now();
    const baselineKeys = new Set(baseline.keys ?? []);
    const blockedSelectors = this.selectors.blocked;
    const responseSnapshots = (document: Document) => this.responseSnapshots(document);
    const responseGenerating = (document: Document, response: HTMLElement) =>
      this.isResponseGenerating(document, response);

    return await new Promise<ResponseCaptureUpdate>((resolve, reject) => {
      let settled = false;
      let checking = false;
      let checkAgain = false;
      let deadlineReached = false;
      let selectedKey: string | undefined;
      let latestText = "";
      let latestMarkdown = "";
      let lastReportedText = "";
      let lastReportedMarkdown = "";
      let lastChangedAt = startedAt;
      let generatingSeen = false;
      let generatingStoppedAt: number | undefined;
      let scheduledCheck: number | undefined;
      let quietTimer: number | undefined;

      const observer = new MutationObserver(() => scheduleCheck());
      const poll = ctx.window.setInterval(() => scheduleCheck(), pollMs);
      const deadline = ctx.window.setTimeout(() => {
        deadlineReached = true;
        scheduleCheck();
      }, timeoutMs);

      const abort = () => {
        if (latestText) {
          finish({
            status: "partial",
            text: latestText,
            markdown: latestMarkdown,
            message: "回复采集已取消，已保存当前可见内容",
          });
          return;
        }
        finishWithError(new ProviderError("ABORTED", "回复采集已取消"));
      };

      function cleanup(): void {
        observer.disconnect();
        ctx.window.clearInterval(poll);
        ctx.window.clearTimeout(deadline);
        if (scheduledCheck !== undefined) ctx.window.clearTimeout(scheduledCheck);
        if (quietTimer !== undefined) ctx.window.clearTimeout(quietTimer);
        ctx.signal?.removeEventListener("abort", abort);
      }

      function finish(update: ResponseCaptureUpdate): void {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(update);
      }

      function finishWithError(error: unknown): void {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          error instanceof ProviderError
            ? error
            : new ProviderError("RESPONSE_CAPTURE_FAILED", "回复采集失败", { cause: error }),
        );
      }

      function scheduleCheck(delayMs = 0): void {
        if (settled) return;
        checkAgain = true;
        if (checking || scheduledCheck !== undefined) return;
        scheduledCheck = ctx.window.setTimeout(() => {
          scheduledCheck = undefined;
          void runCheck();
        }, delayMs);
      }

      function scheduleQuietCheck(delayMs: number): void {
        if (quietTimer !== undefined) ctx.window.clearTimeout(quietTimer);
        quietTimer = ctx.window.setTimeout(
          () => {
            quietTimer = undefined;
            scheduleCheck();
          },
          Math.max(0, delayMs),
        );
      }

      async function runCheck(): Promise<void> {
        if (settled || checking) return;
        checking = true;
        checkAgain = false;
        try {
          if (blockedSelectors && findFirstUsable(ctx.document, blockedSelectors)) {
            finish(
              latestText
                ? {
                    status: "partial",
                    text: latestText,
                    markdown: latestMarkdown,
                    message: "官网要求完成人工验证，已保存当前可见内容",
                  }
                : {
                    status: "failed",
                    message: "官网要求完成人工验证，请验证后重新发送",
                  },
            );
            return;
          }

          const snapshots = responseSnapshots(ctx.document);
          const selected = selectResponseSnapshot(snapshots);
          const now = Date.now();

          if (selected) {
            selectedKey = selected.key;
            if (
              selected.text &&
              (selected.text !== latestText || selected.markdown !== latestMarkdown)
            ) {
              latestText = selected.text;
              latestMarkdown = selected.markdown;
              lastChangedAt = now;
            }
            if (
              latestText &&
              (latestText !== lastReportedText || latestMarkdown !== lastReportedMarkdown)
            ) {
              lastReportedText = latestText;
              lastReportedMarkdown = latestMarkdown;
              await onUpdate({ status: "streaming", text: latestText, markdown: latestMarkdown });
            }

            const generating = responseGenerating(ctx.document, selected.element);
            if (generating) {
              generatingSeen = true;
              generatingStoppedAt = undefined;
            } else if (generatingSeen && generatingStoppedAt === undefined) {
              generatingStoppedAt = now;
            }

            if (latestText && !generating) {
              const quietSince = Math.max(lastChangedAt, generatingStoppedAt ?? 0);
              const quietFor = now - quietSince;
              if (quietFor >= quietMs) {
                finish({ status: "completed", text: latestText, markdown: latestMarkdown });
                return;
              }
              scheduleQuietCheck(quietMs - quietFor);
            }
          }

          if (deadlineReached || now - startedAt >= timeoutMs) {
            finish(
              latestText
                ? {
                    status: "partial",
                    text: latestText,
                    markdown: latestMarkdown,
                    message: "等待回复结束超时，已保存当前可见内容",
                  }
                : {
                    status: "timeout",
                    message: "未检测到新的回复内容，请检查官网页面或更新采集规则",
                  },
            );
          }
        } catch (error) {
          finishWithError(error);
        } finally {
          checking = false;
          if (checkAgain && !settled) scheduleCheck();
        }
      }

      function selectResponseSnapshot(
        snapshots: readonly ResponseContentSnapshot[],
      ): ResponseContentSnapshot | undefined {
        if (selectedKey) {
          return snapshots.find((snapshot) => snapshot.key === selectedKey);
        }
        const added = snapshots.filter((snapshot) => !baselineKeys.has(snapshot.key));
        if (added.length) return added.at(-1);
        const last = snapshots.at(-1);
        if (
          last &&
          (snapshots.length > baseline.count ||
            last.text !== baseline.lastText ||
            (baseline.lastKey !== undefined && last.key !== baseline.lastKey))
        ) {
          return last;
        }
        return undefined;
      }

      ctx.signal?.addEventListener("abort", abort, { once: true });
      if (ctx.signal?.aborted) {
        abort();
        return;
      }
      observer.observe(ctx.document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "class",
          "hidden",
          "aria-hidden",
          "aria-label",
          "data-chat",
          "data-chat-answers-wrap",
          "data-message-id",
        ],
      });
      scheduleCheck();
    });
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
        const composer = this.findComposer(ctx.document);
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
    this.stagedSubmitControl = undefined;
  }

  protected validateStagedSubmitControl(button: HTMLElement): void {
    void button;
  }

  protected findComposer(document: Document): HTMLElement | undefined {
    return findFirstUsable(document, this.selectors.composer);
  }

  protected async waitForComposer(ctx: FrameContext): Promise<HTMLElement> {
    return await waitForResolvedElement(ctx.document, () => this.findComposer(ctx.document), {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
  }

  protected responseBaseline(document: Document): ResponseBaseline {
    const responses = this.responseSnapshots(document);
    const last = responses.at(-1);
    return {
      count: responses.length,
      lastText: last?.text ?? "",
      ...(responses.length ? { keys: responses.map((response) => response.key) } : {}),
      ...(last ? { lastKey: last.key } : {}),
    };
  }

  protected responseSnapshots(document: Document): ResponseContentSnapshot[] {
    return readResponseContent(document, {
      roots: this.selectors.responses ?? [],
      ...(this.selectors.responseContent ? { content: this.selectors.responseContent } : {}),
      ...(this.selectors.responseExclude ? { exclude: this.selectors.responseExclude } : {}),
      getKey: (element, index) => this.responseKey(element, index),
    });
  }

  protected responseKey(element: HTMLElement, index: number): string | undefined {
    void element;
    void index;
    return undefined;
  }

  protected isResponseGenerating(document: Document, response: HTMLElement): boolean {
    void response;
    return this.selectors.generating
      ? Boolean(findFirstUsable(document, this.selectors.generating))
      : false;
  }
}
