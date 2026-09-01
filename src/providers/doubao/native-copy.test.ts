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

  it("discovers the current Doubao message container and its official copy action", () => {
    document.body.innerHTML = `
      <section data-testid="union_message" data-message-id="doubao-current">
        <div data-testid="message-block-container">
          <div class="md-box-root"><h2>Current answer</h2><p>Complete body</p></div>
        </div>
        <div class="message-actions">
          <button type="button"><svg name="Copy"></svg></button>
        </div>
      </section>
    `;

    expect(doubaoNativeCopyAdapter.listTargets?.({ document, window })).toEqual([
      expect.objectContaining({
        key: "doubao-copy:doubao-current",
        response: document.querySelector("[data-testid='union_message']"),
        button: document.querySelector("button"),
      }),
    ]);
  });

  it("binds the current virtual-list row instead of a historical or code Copy", () => {
    document.body.innerHTML = `
      <div class="list_items">
        <div class="v_list_row">
          <div class="bg-g-send-msg-bubble">current prompt</div>
          <button aria-label="复制用户消息"></button>
        </div>
        <div class="v_list_row" data-message-id="doubao-current">
          <div class="flow-markdown-body"><p>Complete current answer</p></div>
          <pre><button aria-label="复制代码"></button></pre>
          <div class="message-action-bar"><button class="copy-answer"></button></div>
        </div>
      </div>
    `;

    const targets = doubaoNativeCopyAdapter.listTargets?.({ document, window }) ?? [];
    expect(targets).toEqual([
      expect.objectContaining({
        key: "doubao-copy:doubao-current",
        response: document.querySelector("[data-message-id='doubao-current']"),
        button: document.querySelector(".copy-answer"),
      }),
    ]);
  });
});
