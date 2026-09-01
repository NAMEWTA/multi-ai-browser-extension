import { describe, expect, it } from "vitest";
import { cozeNativeCopyAdapter } from "./native-copy";

describe("cozeNativeCopyAdapter", () => {
  it("uses the answer action in the current Coze assistant message", () => {
    document.body.innerHTML = `
      <article data-role="assistant" data-message-id="coze-current">
        <div class="markdown-body"><p>Complete Coze answer</p></div>
        <pre><button aria-label="复制代码"></button></pre>
        <div class="message-action-bar"><button aria-label="复制"></button></div>
      </article>
    `;

    expect(cozeNativeCopyAdapter.listTargets?.({ document, window })).toEqual([
      expect.objectContaining({
        response: document.querySelector("article"),
        button: document.querySelector(".message-action-bar button"),
      }),
    ]);
  });
});
