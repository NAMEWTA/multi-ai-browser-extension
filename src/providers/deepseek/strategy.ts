import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import type { FrameContext, ResponseBaseline } from "../../core/providers/contracts";
import { findFirstUsable, readComposerValue, waitForElement } from "../../core/providers/dom";
import { ProviderError } from "../../core/providers/errors";
import { deepseekDefinition } from "./definition";
import { deepseekSelectors } from "./selectors";

export class DeepSeekStrategy extends BaseDomStrategy {
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
}

function controlSignature(element: HTMLElement | undefined): string | undefined {
  if (!element) return undefined;
  return element.querySelector("svg")?.innerHTML.replace(/\s+/g, " ").trim() || element.innerHTML;
}

function isSharedDeepSeekControl(element: HTMLElement | undefined): boolean {
  return Boolean(element?.matches("div[role='button'].ds-button--primary.ds-button--circle"));
}
