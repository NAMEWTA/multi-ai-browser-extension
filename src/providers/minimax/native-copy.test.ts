import { describe, expect, it } from "vitest";
import { minimaxNativeCopyAdapter } from "./native-copy";

describe("minimaxNativeCopyAdapter", () => {
  it("binds the MiniMax answer Copy and excludes a nested code Copy", () => {
    document.body.innerHTML = `
      <article data-role="assistant" data-message-id="minimax-current">
        <div class="markdown-body"><p>Complete MiniMax answer</p></div>
        <pre><button aria-label="Copy code"></button></pre>
        <div class="message-toolbar"><button aria-label="Copy response"></button></div>
      </article>
    `;

    expect(minimaxNativeCopyAdapter.listTargets?.({ document, window })).toEqual([
      expect.objectContaining({
        response: document.querySelector("article"),
        button: document.querySelector(".message-toolbar button"),
      }),
    ]);
  });
});
