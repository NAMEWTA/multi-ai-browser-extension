import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import type { FrameContext, PromptPayload } from "../../core/providers/contracts";
import {
  isElementUsable,
  normalizeComposerValue,
  readComposerValue,
  waitForCondition,
  waitForElement,
} from "../../core/providers/dom";
import { ProviderError } from "../../core/providers/errors";
import { doubaoDefinition } from "./definition";
import { doubaoNativeCopyAdapter } from "./native-copy";
import {
  DOUBAO_ACQUISITION_ADAPTER_VERSION,
  doubaoAcquisitionAdapter,
} from "./runtime-acquisition";
import { doubaoSelectors } from "./selectors";

export class DoubaoStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = doubaoNativeCopyAdapter;
  protected override readonly acquisitionAdapter = doubaoAcquisitionAdapter;
  protected override readonly acquisitionAdapterVersion = DOUBAO_ACQUISITION_ADAPTER_VERSION;

  constructor() {
    super(doubaoDefinition, doubaoSelectors);
  }

  override async writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    const composer =
      this.activeComposer ??
      (await waitForElement(ctx.document, doubaoSelectors.composer, {
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      }));
    if (!composer.classList.contains("ProseMirror")) {
      await super.writePrompt(ctx, prompt);
      return;
    }

    composer.focus({ preventScroll: true });
    const selection = ctx.window.getSelection();
    const range = ctx.document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const accepted = ctx.document.execCommand(
      prompt.text ? "insertText" : "delete",
      false,
      prompt.text,
    );
    selection?.removeAllRanges();
    if (!accepted) {
      throw new ProviderError("COMPOSER_NOT_READY", "豆包编辑器拒绝了浏览器输入操作");
    }

    await waitForCondition(
      () =>
        normalizeComposerValue(readComposerValue(composer)) === normalizeComposerValue(prompt.text),
      {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
      },
    ).catch((error: unknown) => {
      throw new ProviderError("PROMPT_MISMATCH", "豆包未确认输入内容", { cause: error });
    });
    this.activeComposer = composer;
  }

  override async startNewConversation(ctx: FrameContext): Promise<void> {
    const control = findNamedControl(ctx.document, ["新对话", "New chat"]);
    if (!control) {
      await super.startNewConversation(ctx);
      return;
    }

    const responsesBefore = this.responseBaseline(ctx.document).count;
    const urlBefore = ctx.window.location.href;
    const clickedAt = Date.now();
    control.click();
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
      throw new ProviderError("NEW_CONVERSATION_UNCONFIRMED", "豆包未确认已新建对话", {
        cause: error,
      });
    });
    this.activeComposer = undefined;
    this.stagedSubmitControl = undefined;
  }

  protected override responseKey(element: HTMLElement, index: number): string | undefined {
    const message = element.closest<HTMLElement>(
      "[data-message-id], [data-local-message-id], [data-msg-id], [data-id]",
    );
    if (message) {
      for (const attribute of [
        "data-message-id",
        "data-local-message-id",
        "data-msg-id",
        "data-id",
      ]) {
        const value = message.getAttribute(attribute)?.trim();
        if (value) return `doubao-message:${value}`;
      }
    }
    return super.responseKey(element, index);
  }
}

function findNamedControl(document: Document, labels: readonly string[]): HTMLElement | undefined {
  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase());
  for (const candidate of document.querySelectorAll("span")) {
    const text = normalizeComposerValue(candidate.textContent ?? "").toLocaleLowerCase();
    if (!normalizedLabels.includes(text)) continue;
    let current = candidate.parentElement;
    while (current && current !== document.body) {
      if (
        (current.matches("button, a, [role='button']") ||
          current.classList.contains("cursor-pointer")) &&
        isElementUsable(current)
      ) {
        return current;
      }
      current = current.parentElement;
    }
  }
  return undefined;
}
