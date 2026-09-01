import { describe, expect, it, vi } from "vitest";
import type { FrameContext, NativeCopyPayload } from "../../core/providers/contracts";
import { deepseekNativeCopyAdapter } from "./native-copy";

function context(): FrameContext {
  return { document, window };
}

describe("deepseekNativeCopyAdapter", () => {
  it("locates the current turn copy control and excludes code-block copy controls", () => {
    document.body.innerHTML = `
      <article data-virtual-list-item-key="old-turn">
        <div class="ds-assistant-message-main-content"><p>Old answer</p></div>
        <div class="message-actions"><button aria-label="复制回答">old</button></div>
      </article>
      <article data-virtual-list-item-key="current-turn">
        <div class="ds-assistant-message-main-content">
          <pre><code>const value = 1;</code><button aria-label="复制">code</button></pre>
          <p>Current answer</p>
        </div>
        <div class="message-actions"><button aria-label="复制回答">current</button></div>
      </article>
    `;
    const response = document.querySelectorAll<HTMLElement>(
      ".ds-assistant-message-main-content",
    )[1]!;

    const button = deepseekNativeCopyAdapter.locateCopyButton(context(), response);

    expect(button?.textContent).toBe("current");
  });

  it.each([
    ["aria-label", "Copy response"],
    ["title", "Copy answer"],
    ["aria-label", "复制回复"],
    ["title", "复制内容"],
  ])("supports %s=%s copy labels", (attribute, label) => {
    document.body.innerHTML = `
      <article data-virtual-list-item-key="current-turn">
        <div class="ds-assistant-message-main-content"><p>Answer</p></div>
        <div class="message-actions"><button ${attribute}="${label}"></button></div>
      </article>
    `;
    const response = document.querySelector<HTMLElement>(".ds-assistant-message-main-content")!;

    expect(deepseekNativeCopyAdapter.locateCopyButton(context(), response)).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("does not use a code-block copy control as the response action", () => {
    document.body.innerHTML = `
      <article data-virtual-list-item-key="current-turn">
        <div class="ds-assistant-message-main-content">
          <pre><code>answer()</code><button title="Copy">Copy</button></pre>
        </div>
      </article>
    `;
    const response = document.querySelector<HTMLElement>(".ds-assistant-message-main-content")!;

    expect(deepseekNativeCopyAdapter.locateCopyButton(context(), response)).toBeUndefined();
  });

  it("hovers the current turn before using a toolbar that starts hidden", async () => {
    document.body.innerHTML = `
      <article data-virtual-list-item-key="current-turn">
        <div class="ds-assistant-message-main-content"><p>Answer</p></div>
        <div class="message-actions" style="display: none">
          <button aria-label="Copy response">Copy</button>
        </div>
      </article>
    `;
    const turn = document.querySelector<HTMLElement>("article")!;
    const response = document.querySelector<HTMLElement>(".ds-assistant-message-main-content")!;
    const toolbar = document.querySelector<HTMLElement>(".message-actions")!;
    const hovered = vi.fn(() => {
      toolbar.style.display = "flex";
    });
    turn.addEventListener("mouseenter", hovered);

    const button = deepseekNativeCopyAdapter.locateCopyButton(context(), response)!;
    expect(deepseekNativeCopyAdapter.isReady?.(context(), response, button)).toBe(true);

    await deepseekNativeCopyAdapter.prepareCopy?.(context(), response, button);

    expect(hovered).toHaveBeenCalled();
    expect(toolbar.style.display).toBe("flex");
  });

  it("rejects disconnected and disabled response controls", () => {
    document.body.innerHTML = `
      <article data-virtual-list-item-key="current-turn">
        <div class="ds-assistant-message-main-content"><p>Answer</p></div>
        <button aria-label="Copy response" aria-disabled="true"></button>
      </article>
    `;
    const response = document.querySelector<HTMLElement>(".ds-assistant-message-main-content")!;
    const button = deepseekNativeCopyAdapter.locateCopyButton(context(), response)!;
    expect(deepseekNativeCopyAdapter.isReady?.(context(), response, button)).toBe(false);

    button.setAttribute("aria-disabled", "false");
    button.remove();
    expect(deepseekNativeCopyAdapter.isReady?.(context(), response, button)).toBe(false);
  });

  it("trims native payloads and removes only standalone UI status lines", () => {
    const payload: NativeCopyPayload = {
      text: "  Copy\r\n# Hello\r\n\r\nThe process was stopped deliberately.\r\nStopped  ",
      mimeType: "text/markdown",
    };

    expect(
      deepseekNativeCopyAdapter.normalize?.(payload, {
        turnKey: "deepseek-turn:current",
        domText: "Hello The process was stopped deliberately.",
        domMarkdown: "# Hello\n\nThe process was stopped deliberately.",
      }),
    ).toEqual({
      text: "# Hello\n\nThe process was stopped deliberately.",
      mimeType: "text/markdown",
    });
  });
});
