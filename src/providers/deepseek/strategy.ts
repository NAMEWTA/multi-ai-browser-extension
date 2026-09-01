import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import type { FrameContext, ResponseBaseline } from "../../core/providers/contracts";
import { findFirstUsable, readComposerValue, waitForElement } from "../../core/providers/dom";
import { ProviderError } from "../../core/providers/errors";
import { deepseekDefinition } from "./definition";
import { deepseekNativeCopyAdapter } from "./native-copy";
import { deepseekSelectors } from "./selectors";

export class DeepSeekStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = deepseekNativeCopyAdapter;
  private busyControlSignature: string | undefined;

  constructor() {
    super(deepseekDefinition, deepseekSelectors);
  }

  override async prepareSubmit(ctx: FrameContext): Promise<ResponseBaseline> {
    const baseline = await super.prepareSubmit(ctx);
    const composer = await waitForElement(ctx.document, deepseekSelectors.composer, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
    });
    const control = findFirstUsable(ctx.document, deepseekSelectors.submit, composer);
    const signature = controlSignature(control);
    if (!readComposerValue(composer).trim() && signature && isSharedDeepSeekControl(control)) {
      this.busyControlSignature = signature;
    } else if (this.busyControlSignature && signature !== this.busyControlSignature) {
      this.busyControlSignature = undefined;
    }
    return baseline;
  }

  override async submit(ctx: FrameContext): Promise<void> {
    if (this.busyControlSignature) {
      const current = findFirstUsable(ctx.document, deepseekSelectors.submit, this.activeComposer);
      if (controlSignature(current) === this.busyControlSignature) {
        throw new ProviderError("PROVIDER_BUSY", "DeepSeek 当前回答仍在生成，请稍后再发送");
      }
      this.busyControlSignature = undefined;
    }
    await super.submit(ctx);
  }

  protected override validateStagedSubmitControl(control: HTMLElement): void {
    if (this.busyControlSignature && controlSignature(control) === this.busyControlSignature) {
      throw new ProviderError("PROVIDER_BUSY", "DeepSeek 当前回答仍在生成，请稍后再发送");
    }
    this.busyControlSignature = undefined;
  }

  protected override responseKey(element: HTMLElement, index: number): string | undefined {
    const virtualItem = element.closest<HTMLElement>("[data-virtual-list-item-key]");
    const virtualKey = virtualItem?.getAttribute("data-virtual-list-item-key")?.trim();
    if (virtualKey) return `deepseek-turn:${virtualKey}`;

    const message = element.closest<HTMLElement>("[data-message-id], [data-id]");
    const messageId =
      message?.getAttribute("data-message-id")?.trim() ?? message?.getAttribute("data-id")?.trim();
    return messageId ? `deepseek-message:${messageId}` : super.responseKey(element, index);
  }
}

function controlSignature(element: HTMLElement | undefined): string | undefined {
  if (!element) return undefined;
  return element.querySelector("svg")?.innerHTML.replace(/\s+/g, " ").trim() || element.innerHTML;
}

function isSharedDeepSeekControl(element: HTMLElement | undefined): boolean {
  return Boolean(element?.matches("div[role='button'].ds-button--primary.ds-button--circle"));
}
