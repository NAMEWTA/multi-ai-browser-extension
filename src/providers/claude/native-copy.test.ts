import { describe, expect, it } from "vitest";
import { claudeNativeCopyAdapter } from "./native-copy";

describe("claudeNativeCopyAdapter", () => {
  it("expands from the assistant body to the containing response action group", () => {
    document.body.innerHTML = `
      <section data-message-id="claude-current">
        <div data-testid="assistant-message" class="font-claude-response">
          <p>Complete Claude answer</p>
          <pre><button aria-label="Copy">code copy</button></pre>
        </div>
        <div data-testid="message-actions" role="group">
          <button data-testid="action-bar-copy" aria-label="Copy response"></button>
          <button data-testid="feedback-up"></button>
        </div>
      </section>
    `;

    expect(claudeNativeCopyAdapter.listTargets?.({ document, window })).toEqual([
      expect.objectContaining({
        response: document.querySelector("section"),
        button: document.querySelector("[data-testid='action-bar-copy']"),
      }),
    ]);
  });
});
