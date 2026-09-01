import { beforeEach, describe, expect, it, vi } from "vitest";
import { KimiStrategy } from "./strategy";

describe("KimiStrategy", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" data-lexical-editor="true"></div>
      <div class="send-button-container disabled" role="button" aria-disabled="true"></div>
    `;
  });

  it("writes through the Lexical editing surface and waits for its send control", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    const execCommand = vi.fn((_command: string, _showUi: boolean, text: string) => {
      composer.replaceChildren(document.createTextNode(text));
      submit.classList.remove("disabled");
      submit.removeAttribute("aria-disabled");
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    const strategy = new KimiStrategy();
    await strategy.writePrompt({ document, window, timeoutMs: 100 }, { text: "统一输入" });

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "统一输入");
    expect(composer).toHaveTextContent("统一输入");
  });

  it("preserves multiline prompts when Lexical materializes lines as block elements", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((_command: string, _showUi: boolean, text: string) => {
        const [firstLine = "", ...remainingLines] = text.split("\n");
        composer.replaceChildren(
          document.createTextNode(firstLine),
          ...remainingLines.map((line) => {
            const block = document.createElement("div");
            block.append(line ? document.createTextNode(line) : document.createElement("br"));
            return block;
          }),
        );
        submit.classList.remove("disabled");
        submit.removeAttribute("aria-disabled");
        return true;
      }),
    });

    const prompt = "提示词A\n使用表格回答\n\n用户\n解释 Go channel";
    await new KimiStrategy().writePrompt({ document, window, timeoutMs: 100 }, { text: prompt });

    expect(composer).toHaveTextContent("提示词A使用表格回答用户解释 Go channel");
  });

  it("prechecks before Kimi enables its send control, then stages without clicking", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    const click = vi.spyOn(submit, "click");
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((_command: string, _showUi: boolean, text: string) => {
        composer.replaceChildren(document.createTextNode(text));
        submit.classList.toggle("disabled", text.length === 0);
        submit.toggleAttribute("aria-disabled", text.length === 0);
        return true;
      }),
    });
    const strategy = new KimiStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await expect(strategy.prepareSubmit(ctx)).resolves.toEqual({ count: 0, lastText: "" });
    await strategy.stagePrompt(ctx, { text: "确认后再发送" });
    expect(composer).toHaveTextContent("确认后再发送");
    expect(click).not.toHaveBeenCalled();
  });

  it("confirms a Kimi submit only after the editor changes", async () => {
    const composer = document.querySelector<HTMLElement>(".chat-input-editor")!;
    const submit = document.querySelector<HTMLElement>(".send-button-container")!;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((_command: string, _showUi: boolean, text: string) => {
        composer.replaceChildren(document.createTextNode(text));
        submit.classList.remove("disabled");
        submit.removeAttribute("aria-disabled");
        return true;
      }),
    });
    const click = vi.fn(() => composer.replaceChildren());
    submit.addEventListener("click", click);

    const strategy = new KimiStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.writePrompt(ctx, { text: "发送确认" });
    await strategy.submit(ctx);

    expect(click).toHaveBeenCalledOnce();
    expect(composer).toHaveTextContent("");
  });

  it("reports when Lexical rejects the native editing transaction", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    await expect(
      new KimiStrategy().writePrompt({ document, window, timeoutMs: 100 }, { text: "失败" }),
    ).rejects.toMatchObject({ code: "COMPOSER_NOT_READY" });
  });

  it("keeps the current assistant turn across reverse ordering and a virtualized remount", async () => {
    vi.useFakeTimers();
    try {
      const list = document.createElement("section");
      list.className = "chat-content-list";
      list.innerHTML = `
        <article class="chat-content-item-assistant" data-message-id="old-message">
          <div class="segment-content"><div class="markdown">你好，我是 Kimi</div></div>
        </article>
      `;
      document.body.append(list);
      const strategy = new KimiStrategy();
      const ctx = { document, window, timeoutMs: 100, responseTimeoutMs: 30_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      expect(baseline).toMatchObject({
        keys: ["kimi-turn:old-message"],
        lastKey: "kimi-turn:old-message",
        lastText: "你好，我是 Kimi",
      });
      const updates = vi.fn();
      const capture = strategy.captureResponse(ctx, baseline, updates);
      const submit = document.querySelector<HTMLElement>(".send-button-container")!;
      submit.classList.remove("disabled");
      submit.classList.add("stop");
      submit.removeAttribute("aria-disabled");

      const searchingTurn = document.createElement("article");
      searchingTurn.className = "chat-content-item-assistant";
      searchingTurn.dataset.messageId = "current-message";
      searchingTurn.innerHTML = `
        <div class="segment-content search-process" data-state="loading">
          <div class="markdown">正在获取网页</div>
        </div>
      `;
      list.prepend(searchingTurn);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(updates).not.toHaveBeenCalled();

      const finalTurn = document.createElement("article");
      finalTurn.className = "chat-content-item-assistant";
      finalTurn.dataset.messageId = "current-message";
      finalTurn.innerHTML = `
        <div class="segment-content search-status">已获取 5 个网页</div>
        <div class="segment-content"><div class="markdown"><h2>当前回答</h2><p>正文</p></div></div>
      `;
      searchingTurn.replaceWith(finalTurn);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      expect(updates).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "streaming",
          text: expect.stringContaining("当前回答"),
          markdown: expect.stringContaining("## 当前回答"),
        }),
      );

      submit.classList.remove("stop");
      submit.classList.add("disabled");
      submit.setAttribute("aria-disabled", "true");
      await vi.advanceTimersByTimeAsync(8_002);
      await expect(capture).resolves.toMatchObject({
        status: "completed",
        text: expect.stringContaining("当前回答"),
        markdown: expect.not.stringContaining("你好，我是 Kimi"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
