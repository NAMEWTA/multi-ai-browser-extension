import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import type { FrameContext, PromptPayload } from "../../core/providers/contracts";
import {
  normalizeComposerValue,
  readComposerValue,
  waitForCondition,
  waitForElement,
} from "../../core/providers/dom";
import { ProviderError } from "../../core/providers/errors";
import { kimiDefinition } from "./definition";
import { kimiNativeCopyAdapter } from "./native-copy";
import { kimiSelectors } from "./selectors";

export class KimiStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = kimiNativeCopyAdapter;

  constructor() {
    super(kimiDefinition, kimiSelectors);
  }

  override async writePrompt(ctx: FrameContext, prompt: PromptPayload): Promise<void> {
    const composer = await waitForElement(ctx.document, kimiSelectors.composer, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
    if (composer.getAttribute("data-lexical-editor") !== "true") {
      await super.writePrompt(ctx, prompt);
      return;
    }

    composer.focus({ preventScroll: true });
    const selection = ctx.window.getSelection();
    const range = ctx.document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const command = prompt.text ? "insertText" : "delete";
    const accepted = ctx.document.execCommand(command, false, prompt.text);
    selection?.removeAllRanges();
    if (!accepted) {
      throw new ProviderError("COMPOSER_NOT_READY", "Kimi 编辑器拒绝了浏览器输入操作");
    }

    await waitForCondition(
      () =>
        normalizeComposerValue(readComposerValue(composer)) === normalizeComposerValue(prompt.text),
      {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
      },
    ).catch((error: unknown) => {
      throw new ProviderError("PROMPT_MISMATCH", "Kimi 未确认输入内容", { cause: error });
    });

    if (prompt.text) {
      await waitForElement(ctx.document, kimiSelectors.submit, {
        signal: ctx.signal,
        timeoutMs: Math.min(ctx.timeoutMs ?? 15_000, 5_000),
        anchor: composer,
      }).catch((error: unknown) => {
        throw new ProviderError("SUBMIT_DISABLED", "Kimi 发送按钮未启用", { cause: error });
      });
    }
    this.activeComposer = composer;
  }

  protected override responseKey(element: HTMLElement, index: number): string | undefined {
    const turn = element.closest<HTMLElement>(
      "[data-message-id], [data-msg-id], [data-id], [data-index], [data-key]",
    );
    if (turn) {
      for (const attribute of [
        "data-message-id",
        "data-msg-id",
        "data-id",
        "data-index",
        "data-key",
      ]) {
        const value = turn.getAttribute(attribute)?.trim();
        if (value) return `kimi-turn:${value}`;
      }
    }
    return super.responseKey(element, index);
  }
}
