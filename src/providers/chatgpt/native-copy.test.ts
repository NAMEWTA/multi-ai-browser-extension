import { beforeEach, describe, expect, it } from "vitest";
import { chatgptNativeCopyAdapter } from "./native-copy";

describe("chatgptNativeCopyAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="user">old prompt</div>
      </article>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="assistant"><p>old answer</p></div>
        <div role="group"><button data-testid="copy-turn-action-button"></button></div>
      </article>
      <article data-testid="conversation-turn-3">
        <div data-message-author-role="user">current prompt</div>
      </article>
      <article data-testid="conversation-turn-4">
        <div data-message-author-role="assistant">
          <p>complete answer</p>
          <pre><button aria-label="Copy">code copy</button></pre>
        </div>
        <div role="group"><button data-testid="copy-turn-action-button" aria-label="Copy response"></button></div>
      </article>
    `;
  });

  it("binds the current assistant turn to its response Copy action", () => {
    const targets = chatgptNativeCopyAdapter.listTargets?.({ document, window }) ?? [];
    const selected = chatgptNativeCopyAdapter.selectTarget?.({ document, window }, targets, {
      baseline: { count: 0, lastText: "" },
      prompt: "current prompt",
    });

    expect(selected?.response).toBe(document.querySelector("[data-testid='conversation-turn-4']"));
    expect(selected?.button).toBe(
      document.querySelector(
        "[data-testid='conversation-turn-4'] [data-testid='copy-turn-action-button']",
      ),
    );
  });
});
