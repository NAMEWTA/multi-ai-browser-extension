import { beforeEach, describe, expect, it, vi } from "vitest";
import { readComposerValue } from "../../core/providers/dom";
import { DoubaoStrategy } from "./strategy";

describe("DoubaoStrategy", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="tiptap ProseMirror" contenteditable="true" role="textbox">
        <p data-placeholder="发消息..."><br></p>
      </div>
      <button id="flow-end-msg-send" type="button" aria-disabled="true" data-disabled="true"></button>
    `;
    const composer = document.querySelector<HTMLElement>("[role='textbox']")!;
    const submit = document.querySelector<HTMLButtonElement>("#flow-end-msg-send")!;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((command: string, _showUi: boolean, text: string) => {
        if (command === "delete" || !text) {
          composer.innerHTML = '<p data-placeholder="发消息..."><br></p>';
          submit.setAttribute("aria-disabled", "true");
          submit.setAttribute("data-disabled", "true");
          return true;
        }
        composer.replaceChildren(
          ...text.split("\n").map((line) => {
            const paragraph = document.createElement("p");
            paragraph.dataset.placeholder = "发消息...";
            paragraph.append(line ? document.createTextNode(line) : document.createElement("br"));
            return paragraph;
          }),
        );
        submit.setAttribute("aria-disabled", "false");
        submit.setAttribute("data-disabled", "false");
        return true;
      }),
    });
  });

  it("writes multiline text through TipTap and submits once", async () => {
    const composer = document.querySelector<HTMLElement>("[role='textbox']")!;
    const submit = document.querySelector<HTMLButtonElement>("#flow-end-msg-send")!;
    const click = vi.fn(() => {
      composer.innerHTML = '<p data-placeholder="发消息..."><br></p>';
      submit.setAttribute("aria-disabled", "true");
      submit.setAttribute("data-disabled", "true");
    });
    submit.addEventListener("click", click);
    const strategy = new DoubaoStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await expect(strategy.prepareSubmit(ctx)).resolves.toEqual({ count: 0, lastText: "" });
    await strategy.stagePrompt(ctx, { text: "第一行\n第二行" });
    expect(readComposerValue(composer)).toBe("第一行\n第二行");
    await strategy.submit(ctx);

    expect(click).toHaveBeenCalledOnce();
    expect(readComposerValue(composer)).toBe("");
  });

  it("clears a staged TipTap prompt during transaction rollback", async () => {
    const composer = document.querySelector<HTMLElement>("[role='textbox']")!;
    const strategy = new DoubaoStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await strategy.prepareSubmit(ctx);
    await strategy.stagePrompt(ctx, { text: "等待其他站点预检" });
    await strategy.rollbackPrompt(ctx, { text: "等待其他站点预检" });

    expect(readComposerValue(composer)).toBe("");
  });

  it("uses the clickable sidebar wrapper to start a new chat", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="cursor-pointer nav-link-current">
          <div><span class="font-medium">新对话</span></div>
        </div>
        <article data-message-id="old"><div class="flow-markdown-body">旧回答</div></article>
      `,
    );
    const control = document.querySelector<HTMLElement>(".cursor-pointer")!;
    const click = vi.fn(() => document.querySelector("[data-message-id='old']")?.remove());
    control.addEventListener("click", click);

    await new DoubaoStrategy().startNewConversation({ document, window, timeoutMs: 100 });

    expect(click).toHaveBeenCalledOnce();
  });

  it("captures the latest visible Markdown answer after generation stops", async () => {
    vi.useFakeTimers();
    try {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<article data-message-id="old"><div class="flow-markdown-body">旧回答</div></article>',
      );
      const strategy = new DoubaoStrategy();
      const ctx = { document, window, timeoutMs: 100, responseTimeoutMs: 30_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      expect(baseline).toMatchObject({
        keys: ["doubao-message:old"],
        lastText: "旧回答",
      });
      const updates = vi.fn();
      const capture = strategy.captureResponse(ctx, baseline, updates);

      const breakButton = document.createElement("button");
      breakButton.className = "break-btn-current";
      document.body.append(breakButton);
      document.body.insertAdjacentHTML(
        "beforeend",
        `
          <article data-message-id="current">
            <div class="flow-markdown-body"><h2>豆包回答</h2><p>正文内容</p></div>
          </article>
        `,
      );
      await vi.advanceTimersByTimeAsync(6_001);
      expect(updates).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "streaming",
          text: expect.stringContaining("豆包回答"),
          markdown: expect.stringContaining("## 豆包回答"),
        }),
      );

      breakButton.remove();
      await vi.advanceTimersByTimeAsync(6_002);
      await expect(capture).resolves.toMatchObject({
        status: "completed",
        text: expect.stringContaining("正文内容"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
