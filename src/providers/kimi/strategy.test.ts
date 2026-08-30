import { beforeEach, describe, expect, it, vi } from "vitest";
import { KimiStrategy } from "./strategy";

describe("KimiStrategy", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" data-lexical-editor="true"></div>
      <div class="send-button-container disabled" role="button" aria-disabled="true"></div>
    `;
  });

  it("writes through the Lexical editing surface and waits for its send control", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    const execCommand = vi.fn((_command: string, _showUi: boolean, text: string) => {
      composer.replaceChildren(document.createTextNode(text));
      submit.classList.remove("disabled");
      submit.removeAttribute("aria-disabled");
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    const strategy = new KimiStrategy();
    await strategy.writePrompt({ document, window, timeoutMs: 100 }, { text: "统一输入" });

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "统一输入");
    expect(composer).toHaveTextContent("统一输入");
  });

  it("prechecks before Kimi enables its send control, then stages without clicking", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    const click = vi.spyOn(submit, "click");
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((_command: string, _showUi: boolean, text: string) => {
        composer.replaceChildren(document.createTextNode(text));
        submit.classList.toggle("disabled", text.length === 0);
        submit.toggleAttribute("aria-disabled", text.length === 0);
        return true;
      }),
    });
    const strategy = new KimiStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await expect(strategy.prepareSubmit(ctx)).resolves.toEqual({ count: 0, lastText: "" });
    await strategy.stagePrompt(ctx, { text: "确认后再发送" });
    expect(composer).toHaveTextContent("确认后再发送");
    expect(click).not.toHaveBeenCalled();
  });

  it("confirms a Kimi submit only after the editor changes", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((_command: string, _showUi: boolean, text: string) => {
        composer.replaceChildren(document.createTextNode(text));
        submit.classList.remove("disabled");
        submit.removeAttribute("aria-disabled");
        return true;
      }),
    });
    const click = vi.fn(() => composer.replaceChildren());
    submit.addEventListener("click", click);

    const strategy = new KimiStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.writePrompt(ctx, { text: "发送确认" });
    await strategy.submit(ctx);

    expect(click).toHaveBeenCalledOnce();
    expect(composer).toHaveTextContent("");
  });

  it("reports when Lexical rejects the native editing transaction", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    await expect(
      new KimiStrategy().writePrompt({ document, window, timeoutMs: 100 }, { text: "失败" }),
    ).rejects.toMatchObject({ code: "COMPOSER_NOT_READY" });
  });
});
