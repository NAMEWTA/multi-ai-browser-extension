import { describe, expect, it } from "vitest";
import { kimiNativeCopyAdapter } from "./native-copy";

describe("kimiNativeCopyAdapter", () => {
  it("selects the assistant copy action nearest to the exact current prompt", () => {
    document.body.innerHTML = `
      <article class="chat-content-item-user" data-message-id="user-old">old prompt</article>
      <article class="chat-content-item-assistant" data-message-id="assistant-old">
        <div class="segment-content"><div class="markdown">old answer</div></div>
        <button aria-label="复制">copy old</button>
      </article>
      <article class="chat-content-item-user" data-message-id="user-current">current prompt</article>
      <article class="chat-content-item-assistant" data-message-id="assistant-current">
        <div class="segment-content"><div class="markdown">current answer</div></div>
        <button><svg name="Copy"></svg></button>
      </article>
    `;
    const ctx = { document, window };
    const targets = kimiNativeCopyAdapter.listTargets?.(ctx) ?? [];

    expect(targets).toHaveLength(2);
    expect(
      kimiNativeCopyAdapter.selectTarget?.(ctx, targets, {
        baseline: { count: 0, lastText: "" },
        prompt: "current prompt",
      }),
    ).toMatchObject({
      key: "kimi-copy:assistant-current",
      button: document.querySelector("[data-message-id='assistant-current'] button"),
    });
  });

  it("does not treat a code-block copy action as the answer action", () => {
    document.body.innerHTML = `
      <article class="chat-content-item-assistant" data-message-id="assistant-current">
        <div class="segment-content"><div class="markdown"><pre><code>ls</code><button aria-label="复制代码"></button></pre></div></div>
        <button aria-label="复制">copy answer</button>
      </article>
    `;

    expect(kimiNativeCopyAdapter.listTargets?.({ document, window })?.[0]?.button).toBe(
      document.querySelector("article > button"),
    );
  });
});
