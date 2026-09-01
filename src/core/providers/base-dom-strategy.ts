import type {
  FrameContext,
  NativeCopyAdapter,
  NativeCopyTarget,
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
import { captureNativeResponse, captureNativeTarget } from "./native-copy";
import { readResponseContent, type ResponseContentSnapshot } from "./response-content";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

export abstract class BaseDomStrategy implements ProviderStrategy {
  protected activeComposer: HTMLElement | undefined;
  protected stagedSubmitControl: HTMLElement | undefined;
  protected readonly nativeCopyAdapter?: NativeCopyAdapter;

  protected constructor(
    readonly definition: ProviderDefinition,
    protected readonly selectors: ProviderSelectors,
    private readonly writer = new CompositeComposerWriter(),
    private readonly submitter = new ButtonSubmitter(),
  ) {}

  async probe(ctx: FrameContext): Promise<ProbeResult> {
    if (this.findBlocked(ctx.document)) {
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
    return this.responseBaseline(ctx.document, ctx);
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
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate> {
    if (!this.selectors.responses?.length && !this.selectors.responseCapture?.turnTiers.length) {
      return {
        status: "unsupported",
        terminalReason: "unsupported",
        message: "当前站点尚未配置回复采集规则",
      };
    }

    const timeoutMs = this.selectors.responseTimeoutMs ?? ctx.responseTimeoutMs ?? 180_000;
    const quietMs = this.selectors.responseQuietMs ?? 1_800;
    const pollMs = this.selectors.responsePollMs ?? 1_000;
    const startedAt = Date.now();
    const baselineKeys = new Set(baseline.keys ?? []);
    const baselineFallbackTexts = new Set(
      (baseline.entries ?? [])
        .filter(({ key, text }) => key.startsWith("index:") && Boolean(text))
        .map(({ text }) => text),
    );
    const baselineElements = new Set(baseline.elements ?? []);
    const baselineElementKeys = new Map(
      (baseline.elements ?? []).map(
        (element, index) => [element, baseline.entries?.[index]?.key] as const,
      ),
    );
    const responseSnapshots = (document: Document) => this.responseSnapshots(document);
    const responseGenerating = (document: Document, response: HTMLElement) =>
      this.isResponseGenerating(document, response);
    const responseInterrupted = (document: Document, response: HTMLElement) =>
      this.isResponseInterrupted(document, response);
    const anyResponseGenerating = (document: Document) =>
      this.selectors.generating
        ? Boolean(findFirstUsable(document, this.selectors.generating))
        : false;
    const findBlocked = (document: Document) => this.findBlocked(document);
    const nativeCopyAdapter = this.nativeCopyAdapter;
    const nativeCopyReady = (response: HTMLElement) => {
      if (!nativeCopyAdapter || !ctx.nativeCopy) return false;
      const button = nativeCopyAdapter.locateCopyButton(ctx, response);
      return Boolean(button && nativeCopyAdapter.isReady?.(ctx, response, button) !== false);
    };
    const capturePlan = this.selectors.responseCapture;

    return await new Promise<ResponseCaptureUpdate>((resolve, reject) => {
      let settled = false;
      let checking = false;
      let checkAgain = false;
      let deadlineReached = false;
      let selectedTurnKey: string | undefined;
      let bestSnapshot: ResponseContentSnapshot | undefined;
      let latestText = "";
      let latestMarkdown = "";
      let lastReportedText = "";
      let lastReportedMarkdown = "";
      let lastChangedAt = startedAt;
      let generatingSeen = false;
      let generatingStoppedAt: number | undefined;
      let scheduledCheck: number | undefined;
      let quietTimer: number | undefined;
      let quietCheckAt: number | undefined;
      let terminalFingerprint: string | undefined;
      let nativeTerminalFingerprint: string | undefined;
      let nativeTerminalObservedAt: number | undefined;
      let nativeCopyAttempted = false;
      let generationReported = false;

      const observer = new MutationObserver(() => scheduleCheck());
      const poll = ctx.window.setInterval(() => scheduleCheck(), pollMs);
      const deadline = ctx.window.setTimeout(() => {
        deadlineReached = true;
        scheduleCheck();
      }, timeoutMs);

      const abort = () => {
        const rescued = responseCaptureUpdateFromAbortReason(ctx.signal?.reason);
        if (rescued) {
          finish(rescued);
          return;
        }
        if (latestText) {
          finish({
            status: "partial",
            terminalReason: "aborted",
            text: latestText,
            markdown: latestMarkdown,
            captureSource: "dom",
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
        const normalizedDelay = Math.max(0, delayMs);
        const requestedAt = Date.now() + normalizedDelay;
        if (quietTimer !== undefined && quietCheckAt !== undefined && quietCheckAt <= requestedAt) {
          return;
        }
        if (quietTimer !== undefined) ctx.window.clearTimeout(quietTimer);
        quietCheckAt = requestedAt;
        quietTimer = ctx.window.setTimeout(() => {
          quietTimer = undefined;
          quietCheckAt = undefined;
          scheduleCheck();
        }, normalizedDelay);
      }

      async function runCheck(): Promise<void> {
        if (settled || checking) return;
        checking = true;
        checkAgain = false;
        try {
          const snapshots = responseSnapshots(ctx.document);
          const selected = selectResponseSnapshot(snapshots);
          const now = Date.now();
          const nativeTarget = selectNativeCopyTarget(
            nativeCopyAdapter,
            ctx,
            baseline,
            prompt?.text,
          );

          if (
            nativeTarget &&
            !nativeCopyAttempted &&
            nativeCopyAdapter?.isTerminalTarget?.(ctx, nativeTarget) === true
          ) {
            const fingerprint = nativeCopyTargetFingerprint(nativeTarget);
            const stableFor =
              nativeTerminalFingerprint === fingerprint && nativeTerminalObservedAt !== undefined
                ? now - nativeTerminalObservedAt
                : 0;
            if (stableFor >= 250) {
              nativeCopyAttempted = true;
              const targetSnapshot = bestResponseSnapshot(
                snapshots.filter((snapshot) =>
                  responseContains(nativeTarget.response, snapshot.element),
                ),
              );
              const native = await captureNativeTarget(
                nativeCopyAdapter,
                ctx,
                nativeTarget,
                targetSnapshot,
                prompt,
              ).catch(() => undefined);
              if (native) {
                finish(native);
                return;
              }
              if (!nativeTarget.response.isConnected || !nativeTarget.button.isConnected) {
                nativeCopyAttempted = false;
                nativeTerminalFingerprint = undefined;
                nativeTerminalObservedAt = undefined;
                scheduleQuietCheck(250);
                return;
              }
              if (targetSnapshot?.text) {
                finish({
                  status: "partial",
                  terminalReason: "uncertain-final",
                  text: targetSnapshot.text,
                  markdown: targetSnapshot.markdown,
                  captureSource: "dom",
                  message: "官网回复已结束，但原生复制失败，已保存当前可见内容",
                });
              } else {
                finish({
                  status: "failed",
                  terminalReason: "failed",
                  message: "官网回复已结束，但未能从该回复的复制按钮取得内容",
                });
              }
              return;
            }
            if (nativeTerminalFingerprint !== fingerprint) {
              nativeTerminalFingerprint = fingerprint;
              nativeTerminalObservedAt = now;
            }
            scheduleQuietCheck(250 - stableFor);
          } else if (!nativeCopyAttempted) {
            nativeTerminalFingerprint = undefined;
            nativeTerminalObservedAt = undefined;
          }

          if (selected) {
            selectedTurnKey = selected.key;
            const accepted = shouldAcceptSnapshot(selected, bestSnapshot);
            if (accepted) {
              bestSnapshot = selected;
              if (
                selected.text &&
                (selected.text !== latestText || selected.markdown !== latestMarkdown)
              ) {
                latestText = selected.text;
                latestMarkdown = selected.markdown;
                lastChangedAt = now;
                terminalFingerprint = undefined;
              }
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
              generationReported = true;
              generatingStoppedAt = undefined;
              terminalFingerprint = undefined;
            } else if (generatingSeen && generatingStoppedAt === undefined) {
              generatingStoppedAt = now;
            }

            const interrupted = responseInterrupted(ctx.document, selected.element);
            if (latestText && !generating && interrupted) {
              const fingerprint = `interrupted\u0000${responseFingerprint(selected)}`;
              if (accepted && terminalFingerprint === fingerprint) {
                finish(
                  await finalizeSnapshot(
                    selected,
                    "partial",
                    "interrupted",
                    latestText,
                    latestMarkdown,
                  ),
                );
                return;
              }
              terminalFingerprint = accepted ? fingerprint : undefined;
              scheduleQuietCheck(250);
            } else {
              const hasTerminalEvidence = generatingSeen
                ? generatingStoppedAt !== undefined
                : Boolean(
                    capturePlan?.allowStableCompletionWithoutGenerating &&
                    bestSnapshot?.hasFinalContainer,
                  ) || !capturePlan;
              if (latestText && !generating && hasTerminalEvidence) {
                const quietSince = Math.max(lastChangedAt, generatingStoppedAt ?? 0);
                const quietFor = now - quietSince;
                const requiredQuietMs =
                  generatingSeen &&
                  generatingStoppedAt !== undefined &&
                  nativeCopyReady(selected.element)
                    ? Math.min(quietMs, 750)
                    : quietMs;
                if (quietFor >= requiredQuietMs) {
                  const fingerprint = responseFingerprint(selected);
                  if (accepted && terminalFingerprint === fingerprint) {
                    finish(
                      await finalizeSnapshot(
                        selected,
                        "completed",
                        "completed",
                        latestText,
                        latestMarkdown,
                      ),
                    );
                    return;
                  }
                  terminalFingerprint = accepted ? fingerprint : undefined;
                  scheduleQuietCheck(250);
                } else {
                  terminalFingerprint = undefined;
                  scheduleQuietCheck(requiredQuietMs - quietFor);
                }
              }
            }
          } else if (!generationReported && anyResponseGenerating(ctx.document)) {
            generationReported = true;
            await onUpdate({ status: "streaming" });
          }

          if (findBlocked(ctx.document)) {
            finish(
              latestText
                ? {
                    status: "partial",
                    terminalReason: "verification",
                    text: latestText,
                    markdown: latestMarkdown,
                    message: "官网要求完成人工验证，已保存当前可见内容",
                  }
                : {
                    status: "failed",
                    terminalReason: "verification",
                    message: "官网要求完成人工验证，请验证后重新发送",
                  },
            );
            return;
          }

          if (deadlineReached || now - startedAt >= timeoutMs) {
            finish(
              latestText
                ? {
                    status: "partial",
                    terminalReason: generatingSeen ? "timeout" : "uncertain-final",
                    text: latestText,
                    markdown: latestMarkdown,
                    message: "等待回复结束超时，已保存当前可见内容",
                  }
                : {
                    status: "timeout",
                    terminalReason: "timeout",
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

      async function finalizeSnapshot(
        snapshot: ResponseContentSnapshot,
        status: "completed" | "partial",
        terminalReason: "completed" | "interrupted",
        text: string,
        markdown: string,
      ): Promise<ResponseCaptureUpdate> {
        const native = await captureNativeResponse(nativeCopyAdapter, ctx, snapshot, prompt).catch(
          () => undefined,
        );
        if (native) return { ...native, status, terminalReason };
        return { status, terminalReason, text, markdown, captureSource: "dom" };
      }

      function selectResponseSnapshot(
        snapshots: readonly ResponseContentSnapshot[],
      ): ResponseContentSnapshot | undefined {
        if (selectedTurnKey) {
          const selected = bestResponseSnapshot(
            snapshots.filter((snapshot) => snapshot.key === selectedTurnKey),
          );
          if (selected) return selected;
          selectedTurnKey = undefined;
        }
        const added = snapshots.filter((snapshot) => {
          const previousElementKey = baselineElementKeys.get(snapshot.element);
          if (
            baselineElements.has(snapshot.element) &&
            (previousElementKey === undefined ||
              previousElementKey === snapshot.key ||
              previousElementKey.startsWith("index:") ||
              snapshot.key.startsWith("index:"))
          ) {
            return false;
          }
          if (baselineKeys.has(snapshot.key)) {
            if (!snapshot.key.startsWith("index:")) return false;
            return !baselineFallbackTexts.has(snapshot.text);
          }
          return !(snapshot.key.startsWith("index:") && baselineFallbackTexts.has(snapshot.text));
        });
        if (added.length) {
          const lastKey = added.at(-1)!.key;
          return bestResponseSnapshot(added.filter((snapshot) => snapshot.key === lastKey));
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
          ...new Set(capturePlan?.observeAttributes ?? []),
        ],
      });
      scheduleCheck();
    });
  }

  async finalizeResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate | undefined> {
    const snapshots = this.responseSnapshots(ctx.document);
    const nativeTarget = selectNativeCopyTarget(
      this.nativeCopyAdapter,
      ctx,
      baseline,
      prompt?.text,
    );
    if (nativeTarget && this.nativeCopyAdapter?.isTerminalTarget?.(ctx, nativeTarget) === true) {
      const targetSnapshot = bestResponseSnapshot(
        snapshots.filter((snapshot) => responseContains(nativeTarget.response, snapshot.element)),
      );
      const native = await captureNativeTarget(
        this.nativeCopyAdapter,
        ctx,
        nativeTarget,
        targetSnapshot,
        prompt,
      ).catch(() => undefined);
      if (native) return native;
    }
    const snapshot = selectSnapshotAfterBaseline(snapshots, baseline);
    if (!snapshot?.text) return undefined;
    const native = await captureNativeResponse(this.nativeCopyAdapter, ctx, snapshot, prompt).catch(
      () => undefined,
    );
    if (native) return native;
    return {
      status: "partial",
      terminalReason: "uncertain-final",
      text: snapshot.text,
      markdown: snapshot.markdown,
      captureSource: "dom",
      message: "下一轮已开始；上一轮终态未确认，已保留当前可见内容",
    };
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

  protected responseBaseline(document: Document, ctx?: FrameContext): ResponseBaseline {
    const responses = this.responseSnapshots(document);
    const last = responses.at(-1);
    const nativeCopyTargets =
      ctx && this.nativeCopyAdapter?.listTargets
        ? [...this.nativeCopyAdapter.listTargets(ctx)]
        : [];
    return {
      count: responses.length,
      lastText: last?.text ?? "",
      ...(responses.length ? { keys: responses.map((response) => response.key) } : {}),
      ...(last ? { lastKey: last.key } : {}),
      ...(responses.length ? { entries: responses.map(({ key, text }) => ({ key, text })) } : {}),
      ...(responses.length ? { elements: responses.map(({ element }) => element) } : {}),
      ...(nativeCopyTargets.length ? { nativeCopyTargets } : {}),
    };
  }

  protected responseSnapshots(document: Document): ResponseContentSnapshot[] {
    const capturePlan = this.selectors.responseCapture;
    return readResponseContent(document, {
      roots: this.selectors.responses ?? [],
      ...(capturePlan?.turnTiers ? { tiers: capturePlan.turnTiers } : {}),
      ...(capturePlan?.finalContainers ? { finalContainers: capturePlan.finalContainers } : {}),
      ...(capturePlan?.contentBlocks
        ? { contentBlocks: capturePlan.contentBlocks }
        : this.selectors.responseContent
          ? { content: this.selectors.responseContent }
          : {}),
      ...(capturePlan?.exclude
        ? { exclude: capturePlan.exclude }
        : this.selectors.responseExclude
          ? { exclude: this.selectors.responseExclude }
          : {}),
      ...(capturePlan?.statusOnly ? { statusOnly: capturePlan.statusOnly } : {}),
      getKey: (element, index) => this.responseKey(element, index),
    });
  }

  protected responseKey(element: HTMLElement, index: number): string | undefined {
    void element;
    void index;
    return undefined;
  }

  protected findBlocked(document: Document): HTMLElement | undefined {
    return this.selectors.blocked ? findFirstUsable(document, this.selectors.blocked) : undefined;
  }

  protected isResponseGenerating(document: Document, response: HTMLElement): boolean {
    void response;
    return this.selectors.generating
      ? Boolean(findFirstUsable(document, this.selectors.generating))
      : false;
  }

  protected isResponseInterrupted(document: Document, response: HTMLElement): boolean {
    void document;
    const plan = this.selectors.responseCapture;
    if (!plan?.interrupted?.length) return false;
    const labels = new Set(plan.interruptedLabels ?? []);
    return [...response.querySelectorAll<HTMLElement>(plan.interrupted.join(","))].some(
      (element) =>
        isElementUsable(element) &&
        (!labels.size || labels.has(normalizeComposerValue(element.textContent ?? ""))),
    );
  }
}

function selectSnapshotAfterBaseline(
  snapshots: readonly ResponseContentSnapshot[],
  baseline: ResponseBaseline,
): ResponseContentSnapshot | undefined {
  const keys = new Set(baseline.keys ?? []);
  const elements = new Set(baseline.elements ?? []);
  const elementKeys = new Map(
    (baseline.elements ?? []).map(
      (element, index) => [element, baseline.entries?.[index]?.key] as const,
    ),
  );
  const fallbackTexts = new Set(
    (baseline.entries ?? [])
      .filter(({ key, text }) => key.startsWith("index:") && Boolean(text))
      .map(({ text }) => text),
  );
  const added = snapshots.filter((snapshot) => {
    const previousElementKey = elementKeys.get(snapshot.element);
    if (
      elements.has(snapshot.element) &&
      (previousElementKey === undefined ||
        previousElementKey === snapshot.key ||
        previousElementKey.startsWith("index:") ||
        snapshot.key.startsWith("index:"))
    ) {
      return false;
    }
    if (!keys.has(snapshot.key)) {
      return !(snapshot.key.startsWith("index:") && fallbackTexts.has(snapshot.text));
    }
    return snapshot.key.startsWith("index:") && !fallbackTexts.has(snapshot.text);
  });
  if (added.length) {
    const lastKey = added.at(-1)!.key;
    return bestResponseSnapshot(added.filter((snapshot) => snapshot.key === lastKey));
  }
  return undefined;
}

function selectNativeCopyTarget(
  adapter: NativeCopyAdapter | undefined,
  ctx: FrameContext,
  baseline: ResponseBaseline,
  prompt?: string,
): NativeCopyTarget | undefined {
  if (!adapter?.listTargets || !ctx.nativeCopy) return undefined;
  const baselineTargets = baseline.nativeCopyTargets ?? [];
  const baselineKeys = new Set(baselineTargets.map(({ key }) => key));
  const targets = [...adapter.listTargets(ctx)].filter((target) => !baselineKeys.has(target.key));
  if (!targets.length) return undefined;
  return (
    adapter.selectTarget?.(ctx, targets, { baseline, ...(prompt ? { prompt } : {}) }) ??
    targets.at(-1)
  );
}

const nativeCopyElementIds = new WeakMap<HTMLElement, number>();
let nextNativeCopyElementId = 1;

function nativeCopyTargetFingerprint(target: NativeCopyTarget): string {
  const content = (target.response.textContent ?? "").replace(/\s+/g, " ").trim();
  return `${target.key}\u0000${nativeCopyElementId(target.response)}\u0000${nativeCopyElementId(target.button)}\u0000${textFingerprint(content)}`;
}

function nativeCopyElementId(element: HTMLElement): number {
  const existing = nativeCopyElementIds.get(element);
  if (existing !== undefined) return existing;
  const id = nextNativeCopyElementId++;
  nativeCopyElementIds.set(element, id);
  return id;
}

function textFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${hash >>> 0}`;
}

function responseContains(response: HTMLElement, candidate: HTMLElement): boolean {
  return response === candidate || response.contains(candidate) || candidate.contains(response);
}

function responseCaptureUpdateFromAbortReason(reason: unknown): ResponseCaptureUpdate | undefined {
  if (!reason || typeof reason !== "object" || !("status" in reason)) return undefined;
  return reason as ResponseCaptureUpdate;
}

function bestResponseSnapshot(
  snapshots: readonly ResponseContentSnapshot[],
): ResponseContentSnapshot | undefined {
  return snapshots.toSorted(compareResponseSnapshots).at(-1);
}

function compareResponseSnapshots(
  left: ResponseContentSnapshot,
  right: ResponseContentSnapshot,
): number {
  return left.quality - right.quality || left.text.length - right.text.length;
}

function shouldAcceptSnapshot(
  next: ResponseContentSnapshot,
  current: ResponseContentSnapshot | undefined,
): boolean {
  if (!next.text || next.statusOnly) return false;
  if (!current || next.key !== current.key || next.quality > current.quality) return true;
  if (next.quality < current.quality) return false;
  return next.text.length >= current.text.length;
}

function responseFingerprint(snapshot: ResponseContentSnapshot): string {
  return [
    snapshot.key,
    snapshot.candidateId,
    snapshot.quality,
    snapshot.text,
    snapshot.markdown,
  ].join("\u0000");
}
