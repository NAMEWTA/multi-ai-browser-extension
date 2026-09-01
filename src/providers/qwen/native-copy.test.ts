import { describe, expect, it } from "vitest";
import { qwenNativeCopyAdapter } from "./native-copy";

describe("qwenNativeCopyAdapter", () => {
  it("enumerates a Qwen answer and selects its feedback-toolbar copy action", () => {
    document.body.innerHTML = `
      <section class="chat-round" data-chat="current-chat">
        <div class="chat-answers-card-wrap" data-chat-answers-wrap="current-answer">
          <div class="answer-text md-text-card"><div class="qk-markdown">Complete answer</div></div>
          <div data-answer-feedback-toolbar>
            <button aria-label="复制回复">copy</button>
          </div>
        </div>
      </section>
    `;

    expect(qwenNativeCopyAdapter.listTargets?.({ document, window })).toEqual([
      expect.objectContaining({
        key: "qwen-copy-chat:current-chat",
        response: document.querySelector(".chat-round"),
        button: document.querySelector("button"),
      }),
    ]);
  });

  it("excludes code copy controls from the answer action", () => {
    document.body.innerHTML = `
      <section class="chat-round" data-chat="current-chat">
        <div class="chat-answers-card-wrap" data-chat-answers-wrap="current-answer">
          <div class="answer-text md-text-card">
            <div class="qk-markdown"><pre><code>ls</code><button aria-label="复制代码"></button></pre></div>
          </div>
          <div data-answer-feedback-toolbar><button aria-label="复制回复"></button></div>
        </div>
      </section>
    `;

    expect(qwenNativeCopyAdapter.listTargets?.({ document, window })?.[0]?.button).toBe(
      document.querySelector("[data-answer-feedback-toolbar] button"),
    );
  });
});
