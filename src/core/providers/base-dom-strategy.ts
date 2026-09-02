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
  AcquisitionSelectionError,
  acquireConversation,
  messageBody,
  type ConversationSnapshot,
  type Message,
  type ProviderAcquisitionAdapter,
} from "../acquisition";
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
import { captureNativeTarget } from "./native-copy";
import {
  readResponseContent,
  responseElementToMarkdown,
  responseElementToText,
  type ResponseContentSnapshot,
} from "./response-content";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

export abstract class BaseDomStrategy implements ProviderStrategy {
  protected activeComposer: HTMLElement | undefined;
  protected stagedSubmitControl: HTMLElement | undefined;
  protected readonly nativeCopyAdapter?: NativeCopyAdapter;
  protected readonly acquisitionAdapter?: ProviderAcquisitionAdapter;
  protected readonly acquisitionAdapterVersion: string = "dom-capture-v2";

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
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate> {
    const adapter = this.nativeCopyAdapter;
    const timeoutMs = this.selectors.responseTimeoutMs ?? ctx.responseTimeoutMs ?? 180_000;
    const pollMs = this.selectors.responsePollMs ?? 1_000;
    const terminalStableMs = Math.max(
      250,
      Math.min(adapter?.capturePolicy?.terminalStableMs ?? 1_500, 10_000),
    );
    const quietStableMs = Math.max(
      terminalStableMs,
      Math.min(this.selectors.responseQuietMs ?? 6_000, 15_000),
    );
    const startedAt = Date.now();
    const capturePlan = this.selectors.responseCapture;

    return await new Promise<ResponseCaptureUpdate>((resolve) => {
      let settled = false;
      let checking = false;
      let checkAgain = false;
      let deadlineReached = false;
      let scheduledCheck: number | undefined;
      let stableTimer: number | undefined;
      let stableCheckAt: number | undefined;
      let terminalFingerprint: string | undefined;
      let terminalObservedAt: number | undefined;
      let captureAttempted = false;
      let generationObserved = false;
      let nextProviderAttemptAt = startedAt + Math.min(500, pollMs);

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
        finish({
          status: "failed",
          terminalReason: "aborted",
          message: "回复采集已取消，未保存未完成的 DOM 内容",
        });
      };

      const cleanup = (): void => {
        observer.disconnect();
        ctx.window.clearInterval(poll);
        ctx.window.clearTimeout(deadline);
        if (scheduledCheck !== undefined) ctx.window.clearTimeout(scheduledCheck);
        if (stableTimer !== undefined) ctx.window.clearTimeout(stableTimer);
        ctx.signal?.removeEventListener("abort", abort);
      };

      const finish = (update: ResponseCaptureUpdate): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(update);
      };

      const scheduleCheck = (delayMs = 0): void => {
        if (settled) return;
        checkAgain = true;
        if (checking || scheduledCheck !== undefined) return;
        scheduledCheck = ctx.window.setTimeout(() => {
          scheduledCheck = undefined;
          void runCheck();
        }, delayMs);
      };

      const scheduleStableCheck = (delayMs: number): void => {
        const normalizedDelay = Math.max(0, delayMs);
        const requestedAt = Date.now() + normalizedDelay;
        if (
          stableTimer !== undefined &&
          stableCheckAt !== undefined &&
          stableCheckAt <= requestedAt
        ) {
          return;
        }
        if (stableTimer !== undefined) ctx.window.clearTimeout(stableTimer);
        stableCheckAt = requestedAt;
        stableTimer = ctx.window.setTimeout(() => {
          stableTimer = undefined;
          stableCheckAt = undefined;
          scheduleCheck();
        }, normalizedDelay);
      };

      const resetTerminalStability = (): void => {
        terminalFingerprint = undefined;
        terminalObservedAt = undefined;
      };

      const runCheck = async (): Promise<void> => {
        if (settled || checking) return;
        checking = true;
        checkAgain = false;
        try {
          if (this.findBlocked(ctx.document)) {
            finish({
              status: "failed",
              terminalReason: "verification",
              message: "官网要求完成人工验证；验证前不会保存页面 DOM 片段",
            });
            return;
          }

          const target = selectNativeCopyTarget(adapter, ctx, baseline, prompt?.text);
          const snapshots = this.responseSnapshots(ctx.document);
          const snapshot = selectChangedResponseSnapshot(snapshots, baseline);
          const now = Date.now();
          const generating = this.isGenerating(ctx.document);
          if (generating) generationObserved = true;
          if (
            !generating &&
            this.acquisitionAdapter &&
            ctx.acquisitionNetwork &&
            prompt?.text &&
            now >= nextProviderAttemptAt
          ) {
            nextProviderAttemptAt = now + Math.max(1_000, pollMs);
            const providerResponse = await this.acquireProviderResponse(
              ctx,
              baseline,
              prompt,
            ).catch(() => undefined);
            if (providerResponse) {
              finish(providerResponse);
              return;
            }
          }
          const nativeTerminal = Boolean(
            target && adapter?.isTerminalTarget?.(ctx, target) === true,
          );
          const stableWithoutGenerating =
            capturePlan?.allowStableCompletionWithoutGenerating === true;
          const canSettle =
            !generating &&
            Boolean(snapshot || target) &&
            (nativeTerminal || generationObserved || stableWithoutGenerating);

          if (canSettle && !captureAttempted) {
            const fingerprint = target
              ? nativeCopyTargetFingerprint(target)
              : responseSnapshotFingerprint(snapshot!);
            if (terminalFingerprint !== fingerprint) {
              terminalFingerprint = fingerprint;
              terminalObservedAt = now;
            }
            const stableFor = now - (terminalObservedAt ?? now);
            const requiredStableMs =
              nativeTerminal || generationObserved ? terminalStableMs : quietStableMs;
            if (stableFor >= requiredStableMs) {
              captureAttempted = true;
              const acquired = await this.acquireTerminalResponse(
                ctx,
                baseline,
                prompt,
                target,
                snapshot,
              ).catch(() => undefined);
              if (acquired) {
                finish(acquired);
                return;
              }
              if (
                (target && (!target.response.isConnected || !target.button.isConnected)) ||
                (snapshot && !snapshot.element.isConnected)
              ) {
                captureAttempted = false;
                resetTerminalStability();
                scheduleStableCheck(250);
                return;
              }
              finish({
                status: "failed",
                terminalReason: "failed",
                message: "官网回复已结束，但 API、原生 Copy 和当前轮 DOM 均未通过完整性校验",
              });
              return;
            }
            scheduleStableCheck(requiredStableMs - stableFor);
          } else if (!captureAttempted) {
            resetTerminalStability();
          }

          if (deadlineReached || now - startedAt >= timeoutMs) {
            finish({
              status: "timeout",
              terminalReason: "timeout",
              message: "等待本轮回复进入可验证终态超时",
            });
          }
        } catch {
          finish({
            status: "failed",
            terminalReason: "failed",
            message: "回复采集引擎运行失败",
          });
        } finally {
          checking = false;
          if (checkAgain && !settled) scheduleCheck();
        }
      };

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
          "aria-disabled",
          "data-state",
          "data-message-id",
          ...new Set(capturePlan?.observeAttributes ?? []),
        ],
      });
      scheduleCheck();
    });
  }

  protected async acquireTerminalResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    prompt: PromptPayload | undefined,
    target?: NativeCopyTarget,
    snapshot?: ResponseContentSnapshot,
  ): Promise<ResponseCaptureUpdate | undefined> {
    const acquisitionContext = {
      providerId: this.definition.id,
      document: ctx.document,
      window: ctx.window,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      data: {
        baseline,
        prompt: prompt?.text,
        url: ctx.window.location.href,
        network: ctx.acquisitionNetwork,
        acquisitionObservedAfter: baseline.acquisitionObservedAfter,
      },
    } as const;

    const providerResponse = await this.acquireProviderResponse(ctx, baseline, prompt);
    if (providerResponse) return providerResponse;

    if (target && this.nativeCopyAdapter && ctx.nativeCopy) {
      const scopedSnapshot =
        bestResponseSnapshot(
          this.responseSnapshots(ctx.document).filter((candidate) =>
            responseContains(target.response, candidate.element),
          ),
        ) ?? snapshot;
      const native = await captureNativeTarget(
        this.nativeCopyAdapter,
        ctx,
        target,
        scopedSnapshot,
        prompt,
      ).catch(() => undefined);
      if (native?.text || native?.markdown) {
        const canonical = singleResponseSnapshot(
          this.definition.id,
          ctx.window.location.href,
          target.key,
          native.text ?? native.markdown ?? "",
          native.markdown ?? native.text ?? "",
          "native-copy",
          "native-copy-current-turn",
        );
        return {
          ...native,
          acquisition: {
            snapshot: canonical,
            providerMessageId: target.key,
            adapterVersion: `${this.definition.id}-native-copy-v2`,
            verification: "verified",
          },
        };
      }
    }

    const domSnapshot =
      (target
        ? bestResponseSnapshot(
            this.responseSnapshots(ctx.document).filter((candidate) =>
              responseContains(target.response, candidate.element),
            ),
          )
        : undefined) ??
      snapshot ??
      selectChangedResponseSnapshot(this.responseSnapshots(ctx.document), baseline);
    const domOptions = responseContentOptions(this.selectors);
    const domText =
      domSnapshot?.text.trim() ||
      (target ? responseElementToText(target.response, domOptions).trim() : "");
    if (!domText) return undefined;
    const domMarkdown =
      domSnapshot?.markdown.trim() ||
      (target ? responseElementToMarkdown(target.response, domOptions).trim() : "") ||
      domText;
    const canonical = singleResponseSnapshot(
      this.definition.id,
      ctx.window.location.href,
      domSnapshot?.key ?? target?.key ?? `dom:${Date.now()}`,
      domText,
      domMarkdown,
      "dom",
      "scoped-terminal-dom",
    );
    const fallbackAdapter: ProviderAcquisitionAdapter = {
      providerId: this.definition.id,
      strategiesByPriority: [
        {
          id: "scoped-terminal-dom",
          source: "dom",
          acquire: async () => canonical,
        },
      ],
      qualityPolicy: { requireComplete: true },
    };
    try {
      const selected = await acquireConversation(fallbackAdapter, acquisitionContext);
      const current = selected.snapshot.messages[0];
      return current
        ? responseUpdateFromSnapshot(
            selected.snapshot,
            current,
            "scoped-terminal-dom-v2",
            "bounded",
          )
        : undefined;
    } catch (error) {
      if (error instanceof AcquisitionSelectionError) return undefined;
      throw error;
    }
  }

  protected async acquireProviderResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    prompt: PromptPayload | undefined,
  ): Promise<ResponseCaptureUpdate | undefined> {
    if (!this.acquisitionAdapter || !prompt?.text) return undefined;
    const acquisitionContext = {
      providerId: this.definition.id,
      document: ctx.document,
      window: ctx.window,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      data: {
        baseline,
        prompt: prompt.text,
        url: ctx.window.location.href,
        network: ctx.acquisitionNetwork,
        acquisitionObservedAfter: baseline.acquisitionObservedAfter,
      },
    } as const;
    try {
      const selected = await acquireConversation(this.acquisitionAdapter, acquisitionContext);
      const current = selectAssistantForPrompt(selected.snapshot, prompt.text);
      return current
        ? responseUpdateFromSnapshot(selected.snapshot, current, this.acquisitionAdapterVersion)
        : undefined;
    } catch (error) {
      if (error instanceof AcquisitionSelectionError) return undefined;
      throw error;
    }
  }

  async finalizeResponse(
    ctx: FrameContext,
    baseline: ResponseBaseline,
    prompt?: PromptPayload,
  ): Promise<ResponseCaptureUpdate | undefined> {
    const adapter = this.nativeCopyAdapter;
    const target = selectNativeCopyTarget(adapter, ctx, baseline, prompt?.text);
    const snapshot = selectChangedResponseSnapshot(this.responseSnapshots(ctx.document), baseline);
    if (this.isGenerating(ctx.document) || (!target && !snapshot && !this.acquisitionAdapter)) {
      return undefined;
    }
    return await this.acquireTerminalResponse(ctx, baseline, prompt, target, snapshot).catch(
      () => undefined,
    );
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
      ...(this.acquisitionAdapter ? { acquisitionObservedAfter: Date.now() } : {}),
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

  protected isGenerating(document: Document): boolean {
    return Boolean(
      this.selectors.generating?.length && findFirstUsable(document, this.selectors.generating),
    );
  }

  protected findBlocked(document: Document): HTMLElement | undefined {
    return this.selectors.blocked ? findFirstUsable(document, this.selectors.blocked) : undefined;
  }
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

function responseSnapshotFingerprint(snapshot: ResponseContentSnapshot): string {
  return `${snapshot.key}\u0000${snapshot.candidateId}\u0000${textFingerprint(snapshot.text)}`;
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

function selectChangedResponseSnapshot(
  snapshots: readonly ResponseContentSnapshot[],
  baseline: ResponseBaseline,
): ResponseContentSnapshot | undefined {
  const previous = new Map((baseline.entries ?? []).map((entry) => [entry.key, entry.text]));
  const changed = snapshots.filter(
    (snapshot) =>
      !snapshot.statusOnly &&
      Boolean(snapshot.text.trim()) &&
      (!previous.has(snapshot.key) || previous.get(snapshot.key) !== snapshot.text),
  );
  return bestResponseSnapshot(changed);
}

function responseContentOptions(selectors: ProviderSelectors) {
  const capturePlan = selectors.responseCapture;
  return {
    ...(capturePlan?.finalContainers ? { finalContainers: capturePlan.finalContainers } : {}),
    ...(capturePlan?.contentBlocks
      ? { contentBlocks: capturePlan.contentBlocks }
      : selectors.responseContent
        ? { content: selectors.responseContent }
        : {}),
    ...(capturePlan?.exclude
      ? { exclude: capturePlan.exclude }
      : selectors.responseExclude
        ? { exclude: selectors.responseExclude }
        : {}),
    ...(capturePlan?.statusOnly ? { statusOnly: capturePlan.statusOnly } : {}),
  };
}

function singleResponseSnapshot(
  providerId: ProviderDefinition["id"],
  url: string,
  messageId: string,
  text: string,
  markdown: string,
  source: ConversationSnapshot["source"],
  strategyId: string,
): ConversationSnapshot {
  const normalizedText = text.replace(/\r\n?/g, "\n").trim();
  const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n").trim();
  return {
    schemaVersion: 1,
    providerId,
    conversationId: conversationIdentity(providerId, url),
    url,
    capturedAt: Date.now(),
    messages: [
      {
        id: messageId,
        role: "assistant",
        content: [
          {
            kind: "paragraph",
            text: normalizedText,
            markdown: normalizedMarkdown || normalizedText,
          },
        ],
      },
    ],
    source,
    completeness: {
      state: "complete",
      capturedMessageCount: 1,
      expectedMessageCount: 1,
      capturedContentChars: normalizedText.length,
      expectedContentChars: normalizedText.length,
      hasBeginning: true,
      hasEnd: true,
    },
    evidence: {
      stableMessageKeys: [messageId],
      signals: ["terminal-dom-stable", strategyId],
    },
    diagnostics: { strategyId, entries: [] },
  };
}

function selectAssistantForPrompt(
  snapshot: ConversationSnapshot,
  prompt: string | undefined,
): Message | undefined {
  const messages = snapshot.messages;
  if (!prompt) return messages.findLast((message) => message.role === "assistant");
  const expected = comparablePrompt(prompt);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || comparablePrompt(messageBody(message)) !== expected) continue;
    return messages.slice(index + 1).findLast((candidate) => candidate.role === "assistant");
  }
  return undefined;
}

function responseUpdateFromSnapshot(
  snapshot: ConversationSnapshot,
  message: Message,
  adapterVersion: string,
  verification: "verified" | "bounded" | "partial" | "unknown" = snapshotVerification(snapshot),
): ResponseCaptureUpdate {
  const text = messageBody(message);
  const markdown = message.content
    .map((block) => (block.markdown ?? block.text).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return {
    status: snapshot.completeness.state === "complete" ? "completed" : "partial",
    terminalReason: snapshot.completeness.state === "complete" ? "completed" : "uncertain-final",
    text,
    markdown: markdown || text,
    captureSource: snapshot.source,
    acquisition: {
      snapshot,
      providerMessageId: message.id,
      adapterVersion,
      verification,
    },
  };
}

function snapshotVerification(
  snapshot: ConversationSnapshot,
): "verified" | "bounded" | "partial" | "unknown" {
  const signal = snapshot.evidence.signals.find((entry) => entry.startsWith("verification:"));
  const declared = signal?.slice("verification:".length);
  if (
    declared === "verified" ||
    declared === "bounded" ||
    declared === "partial" ||
    declared === "unknown"
  ) {
    return declared;
  }
  if (snapshot.completeness.state === "unknown") return "unknown";
  if (snapshot.completeness.state === "partial") return "partial";
  return snapshot.source === "provider-api" || snapshot.source === "native-copy"
    ? "verified"
    : "bounded";
}

function conversationIdentity(providerId: ProviderDefinition["id"], value: string): string {
  const url = new URL(value);
  const queryId =
    url.searchParams.get("conversation_id") ??
    url.searchParams.get("conversationId") ??
    url.searchParams.get("chat_id") ??
    url.searchParams.get("session_id");
  if (queryId) return queryId;
  const segments = url.pathname.split("/").filter(Boolean);
  const tail = segments.at(-1);
  return tail && !["chat", "new", "conversation"].includes(tail.toLocaleLowerCase())
    ? tail
    : `${providerId}:${url.origin}${url.pathname}`;
}

function comparablePrompt(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function compareResponseSnapshots(
  left: ResponseContentSnapshot,
  right: ResponseContentSnapshot,
): number {
  return left.quality - right.quality || left.text.length - right.text.length;
}
