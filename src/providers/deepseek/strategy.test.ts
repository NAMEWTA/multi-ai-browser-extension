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
      const nativeCopy = {
        capture: vi.fn().mockResolvedValue({
          text: "## 最终回答\n\n这是正文。",
          mimeType: "text/markdown" as const,
        }),
      };
      const ctx = { document, window, nativeCopy, timeoutMs: 100, responseTimeoutMs: 30_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      expect(baseline).toMatchObject({
        keys: ["deepseek-turn:old-turn"],
        lastKey: "deepseek-turn:old-turn",
        lastText: "旧回复",
      });
      const capture = strategy.captureResponse(ctx, baseline);
      const control = document.querySelector<HTMLElement>("div[role='button']")!;
      control.classList.remove("ds-button--disabled");

      const thinkingTemplate = document.createElement("template");
      thinkingTemplate.innerHTML = fixture("thinking-turn.html");
      const thinkingTurn = thinkingTemplate.content.firstElementChild as HTMLElement;
      document.body.append(thinkingTurn);
      await vi.advanceTimersByTimeAsync(13_000);

      const finalTemplate = document.createElement("template");
      finalTemplate.innerHTML = fixture("final-turn.html");
      const finalTurn = finalTemplate.content.firstElementChild as HTMLElement;
      thinkingTurn.replaceWith(finalTurn);
      await vi.advanceTimersByTimeAsync(1);

      control.classList.add("ds-button--disabled");
      await vi.advanceTimersByTimeAsync(1_600);
      await expect(capture).resolves.toMatchObject({
        status: "completed",
        captureSource: "native-copy",
        text: expect.stringContaining("最终回答"),
        markdown: expect.not.stringContaining("搜索计划"),
      });
      expect(nativeCopy.capture).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the complete final container when the first Markdown block is only a heading", async () => {
    vi.useFakeTimers();
    try {
      const strategy = new DeepSeekStrategy();
      const nativeCopy = {
        capture: vi.fn().mockResolvedValue({
          text: "# 你好\n\n哈哈，我正在全力以赴地陪你聊天呢！\n\n1. 接收并读懂你的问题\n2. 组织完整回答\n3. 继续等待你的问题",
          mimeType: "text/markdown" as const,
        }),
      };
      const baseline = await strategy.prepareSubmit({
        document,
        window,
        nativeCopy,
        timeoutMs: 100,
        responseTimeoutMs: 30_000,
      });
      const capture = strategy.captureResponse(
        { document, window, nativeCopy, responseTimeoutMs: 30_000 },
        baseline,
      );
      const control = document.querySelector<HTMLElement>("div[role='button']")!;
      control.classList.remove("ds-button--disabled");

      const turnTemplate = document.createElement("template");
      turnTemplate.innerHTML = fixture("heading-first-final.html");
      const turn = turnTemplate.content.firstElementChild as HTMLElement;
      document.body.append(turn);
      await vi.advanceTimersByTimeAsync(1);

      control.classList.add("ds-button--disabled");
      await vi.advanceTimersByTimeAsync(1_600);

      await expect(capture).resolves.toMatchObject({
        status: "completed",
        terminalReason: "completed",
        captureSource: "native-copy",
        text: expect.stringContaining("继续等待你的问题"),
        markdown: expect.stringContaining("继续等待你的问题"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
