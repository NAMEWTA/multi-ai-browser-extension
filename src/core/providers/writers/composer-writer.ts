import { dispatchInputEvents, readComposerValue } from "../dom";
import { ProviderError } from "../errors";

export interface ComposerWriter {
  supports(element: HTMLElement): boolean;
  write(element: HTMLElement, text: string): void;
}

export class NativeInputWriter implements ComposerWriter {
  supports(element: HTMLElement): boolean {
    return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
  }

  write(element: HTMLElement, text: string): void {
    if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) return;
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, text);
    dispatchInputEvents(element, text);
  }
}

export class ContentEditableWriter implements ComposerWriter {
  supports(element: HTMLElement): boolean {
    return element.isContentEditable || element.getAttribute("contenteditable") === "true";
  }

  write(element: HTMLElement, text: string): void {
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      composed: true,
      cancelable: true,
      data: text,
      inputType: "insertText",
    });
    element.dispatchEvent(beforeInput);
    element.replaceChildren(document.createTextNode(text));
    dispatchInputEvents(element, text);
  }
}

export class CompositeComposerWriter {
  constructor(
    private readonly writers: readonly ComposerWriter[] = [
      new NativeInputWriter(),
      new ContentEditableWriter(),
    ],
  ) {}

  write(element: HTMLElement, text: string): void {
    const writer = this.writers.find((candidate) => candidate.supports(element));
    if (!writer) {
      throw new ProviderError("COMPOSER_NOT_READY", "当前输入框类型暂不支持");
    }
    writer.write(element, text);
    if (normalizeText(readComposerValue(element)) !== normalizeText(text)) {
      throw new ProviderError("PROMPT_MISMATCH", "网页输入框内容校验失败");
    }
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
