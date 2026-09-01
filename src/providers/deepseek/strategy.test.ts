import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekStrategy } from "./strategy";

const fixture = (name: string) => readFileSync(`tests/fixtures/providers/deepseek/${name}`, "utf8");

describe("DeepSeekStrategy", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="ds-icon-button" aria-label="附件">附件</button>
      <section class="composer-shell">
        <textarea class="ds-scroll-area"></textarea>
        <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled">
          <svg><path d="send" /></svg>
        </div>
      </section>
    `;
  });

  it("clicks the enabled primary circle nearest to the active composer", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const send = document.querySelector<HTMLElement>("div[role='button']")!;
    const unrelated = document.querySelector<HTMLButtonElement>("button")!;
    composer.addEventListener("input", () => send.classList.remove("ds-button--disabled"));
    const sendClick = vi.fn(() => {
      composer.value = "";
      send.classList.add("ds-button--disabled");
    });
    const unrelatedClick = vi.spyOn(unrelated, "click");
    send.addEventListener("click", sendClick);

    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    await strategy.stagePrompt(ctx, { text: "发送到 DeepSeek" });
    await strategy.submit(ctx);

    expect(sendClick).toHaveBeenCalledOnce();
    expect(unrelatedClick).not.toHaveBeenCalled();
  });

  it("never clicks the shared control while it is still the stop action", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const control = document.querySelector<HTMLElement>("div[role='button']")!;
    control.classList.remove("ds-button--disabled");
    const click = vi.spyOn(control, "click");

    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    await expect(strategy.stagePrompt(ctx, { text: "下一轮问题" })).rejects.toMatchObject({
      code: "PROVIDER_BUSY",
    });
    expect(click).not.toHaveBeenCalled();

    composer.value = "下一轮问题";
  });

  it("allows sending after the shared control changes back from stop to send", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const control = document.querySelector<HTMLElement>("div[role='button']")!;
    control.classList.remove("ds-button--disabled");
    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    composer.addEventListener("input", () => {
      control.innerHTML = '<svg><path d="new-send" /></svg>';
    });
    await strategy.stagePrompt(ctx, { text: "等待后的问题" });
    control.addEventListener("click", () => {
      composer.value = "";
    });

    await expect(strategy.submit(ctx)).resolves.toBeUndefined();
  });

  it("tracks a whole virtualized turn and captures only its final answer", async () => {
    vi.useFakeTimers();
    try {
      document.body.insertAdjacentHTML(
        "beforeend",
        `
          <article data-virtual-list-item-key="old-turn">
            <div class="ds-assistant-message-main-content">
              <div class="ds-markdown">旧回复</div>
            </div>
          </article>
        `,
      );
      const strategy = new DeepSeekStrategy();
      const ctx = { document, window, timeoutMs: 100, responseTimeoutMs: 30_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      expect(baseline).toMatchObject({
        keys: ["deepseek-turn:old-turn"],
        lastKey: "deepseek-turn:old-turn",
        lastText: "旧回复",
      });
      const updates = vi.fn();
      const capture = strategy.captureResponse(ctx, baseline, updates);
      const control = document.querySelector<HTMLElement>("div[role='button']")!;
      control.classList.remove("ds-button--disabled");

      const thinkingTemplate = document.createElement("template");
      thinkingTemplate.innerHTML = fixture("thinking-turn.html");
      const thinkingTurn = thinkingTemplate.content.firstElementChild as HTMLElement;
      document.body.append(thinkingTurn);
      await vi.advanceTimersByTimeAsync(13_000);
      expect(updates).not.toHaveBeenCalled();

      const finalTemplate = document.createElement("template");
      finalTemplate.innerHTML = fixture("final-turn.html");
      const finalTurn = finalTemplate.content.firstElementChild as HTMLElement;
      thinkingTurn.replaceWith(finalTurn);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      expect(updates).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "streaming",
          text: expect.stringContaining("最终回答"),
          markdown: expect.stringContaining("## 最终回答"),
        }),
      );

      control.classList.add("ds-button--disabled");
      await vi.advanceTimersByTimeAsync(12_300);
      await expect(capture).resolves.toMatchObject({
        status: "completed",
        text: expect.stringContaining("最终回答"),
        markdown: expect.not.stringContaining("搜索计划"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the complete final container when the first Markdown block is only a heading", async () => {
    vi.useFakeTimers();
    try {
      const strategy = new DeepSeekStrategy();
      const baseline = await strategy.prepareSubmit({
        document,
        window,
        timeoutMs: 100,
        responseTimeoutMs: 30_000,
      });
      const updates = vi.fn();
      const capture = strategy.captureResponse(
        { document, window, responseTimeoutMs: 30_000 },
        baseline,
        updates,
      );
      const control = document.querySelector<HTMLElement>("div[role='button']")!;
      control.classList.remove("ds-button--disabled");

      const turnTemplate = document.createElement("template");
      turnTemplate.innerHTML = fixture("heading-first-final.html");
      const turn = turnTemplate.content.firstElementChild as HTMLElement;
      document.body.append(turn);
      await vi.advanceTimersByTimeAsync(1);

      control.classList.add("ds-button--disabled");
      await vi.advanceTimersByTimeAsync(12_500);

      await expect(capture).resolves.toMatchObject({
        status: "partial",
        terminalReason: "interrupted",
        text: expect.stringContaining("继续等待你的问题"),
        markdown: expect.stringContaining("继续等待你的问题"),
      });
      const finalUpdate = updates.mock.calls.at(-1)?.[0];
      expect(finalUpdate.markdown).toContain("哈哈，我正在全力以赴地陪你聊天呢！");
      expect(finalUpdate.markdown).not.toContain("内部推理");
      expect(finalUpdate.markdown).not.toContain("已停止");
    } finally {
      vi.useRealTimers();
    }
  });
});
