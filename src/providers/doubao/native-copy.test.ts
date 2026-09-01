import { beforeEach, describe, expect, it, vi } from "vitest";
import { doubaoNativeCopyAdapter } from "./native-copy";

describe("doubaoNativeCopyAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article data-message-id="assistant-1">
        <div class="flow-markdown-body">完整回答</div>
        <pre><code>code</code><button aria-label="复制代码"></button></pre>
        <div class="message-actions"><button aria-label="复制"></button></div>
      </article>
      <article data-message-id="assistant-2">
        <div class="flow-markdown-body">另一轮回答</div>
        <div class="message-actions"><button aria-label="复制"></button></div>
      </article>
    `;
  });

  it("selects the answer copy control scoped to the requested turn", () => {
    const response = document.querySelector<HTMLElement>(
      "[data-message-id='assistant-1'] .flow-markdown-body",
    )!;
    const button = doubaoNativeCopyAdapter.locateCopyButton({ document, window }, response);

    expect(button).toBe(
      document.querySelector("[data-message-id='assistant-1'] .message-actions button"),
    );
  });

  it("reveals a hidden toolbar through provider-local hover events", async () => {
    const response = document.querySelector<HTMLElement>("[data-message-id='assistant-1']")!;
    const button = doubaoNativeCopyAdapter.locateCopyButton({ document, window }, response)!;
    const hovered = vi.fn();
    response.addEventListener("mouseover", hovered);

    await doubaoNativeCopyAdapter.prepareCopy?.({ document, window }, response, button);

    expect(hovered).toHaveBeenCalled();
  });
});
