import { beforeEach, describe, expect, it, vi } from "vitest";
import { QwenStrategy } from "./strategy";

describe("QwenStrategy", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("ignores an occupied conversation search box and binds the real chat composer", async () => {
    document.body.innerHTML = `
      <aside role="search">
        <textarea placeholder="搜索会话">不要当成用户草稿</textarea>
      </aside>
      <section class="chat-composer">
        <textarea class="actual" placeholder="搜索网页或问点什么"></textarea>
        <button class="send-button" type="button">发送</button>
      </section>
    `;
    const search = document.querySelector<HTMLTextAreaElement>("aside textarea")!;
    const actual = document.querySelector<HTMLTextAreaElement>(".actual")!;
    const send = document.querySelector<HTMLButtonElement>(".send-button")!;
    send.addEventListener("click", () => {
      actual.value = "";
    });
    const click = vi.spyOn(send, "click");
    const strategy = new QwenStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await expect(strategy.prepareSubmit(ctx)).resolves.toEqual({ count: 0, lastText: "" });
    const lateDecoy = document.createElement("textarea");
    lateDecoy.id = "chat-input";
    document.body.prepend(lateDecoy);
    await strategy.stagePrompt(ctx, { text: "只写入真正的千问输入框" });
    await strategy.submit(ctx);

    expect(search.value).toBe("不要当成用户草稿");
    expect(lateDecoy.value).toBe("");
    expect(actual.value).toBe("");
    expect(click).toHaveBeenCalledOnce();
  });

  it("treats Slate placeholder nodes and zero-width markers as an empty composer", async () => {
    document.body.innerHTML = `
      <section class="chat-input-shell" aria-hidden="true">
        <div role="textbox" contenteditable="true" data-placeholder="向千问提问"
             data-slate-editor="true" data-slate-node="value">
          <p data-slate-node="element">
            <span data-slate-node="text"><span data-slate-leaf="true">
              <span data-slate-zero-width="n" data-slate-length="0">\uFEFF<br></span>
              <span data-slate-placeholder="true" contenteditable="false">向千问提问</span>
            </span></span>
          </p>
        </div>
        <button class="send-button" type="button">发送</button>
      </section>
    `;
    const composer = document.querySelector<HTMLElement>("[data-slate-editor]")!;
    const strategy = new QwenStrategy();
    const ctx = { document, window, timeoutMs: 100 };

    await expect(strategy.prepareSubmit(ctx)).resolves.toEqual({ count: 0, lastText: "" });
    await strategy.stagePrompt(ctx, { text: "正式问题" });

    expect(composer).toHaveTextContent("正式问题");
  });

  it("still protects a real user draft in the semantic chat composer", async () => {
    document.body.innerHTML = `
      <textarea placeholder="搜索会话"></textarea>
      <section class="chat-composer">
        <textarea id="chat-input">用户尚未发送的草稿</textarea>
        <button class="send-button" type="button">发送</button>
      </section>
    `;

    await expect(
      new QwenStrategy().prepareSubmit({ document, window, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "COMPOSER_NOT_EMPTY" });
    expect(document.querySelector<HTMLTextAreaElement>("#chat-input")?.value).toBe(
      "用户尚未发送的草稿",
    );
  });

  it("fails safely instead of switching composers when the bound node is replaced", async () => {
    document.body.innerHTML = `
      <section class="chat-composer">
        <textarea class="actual" placeholder="问点什么"></textarea>
        <button class="send-button" type="button">发送</button>
      </section>
    `;
    const actual = document.querySelector<HTMLTextAreaElement>(".actual")!;
    const strategy = new QwenStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    actual.remove();
    const replacement = document.createElement("textarea");
    replacement.id = "chat-input";
    document.body.prepend(replacement);

    await expect(strategy.stagePrompt(ctx, { text: "不能误写" })).rejects.toMatchObject({
      code: "COMPOSER_NOT_READY",
    });
    expect(replacement.value).toBe("");
  });

  it("reports candidate structure and lengths without recording their text", () => {
    document.body.innerHTML = `
      <textarea placeholder="搜索会话">private-search-text</textarea>
      <section class="chat-composer">
        <textarea id="chat-input"></textarea>
        <button class="send-button" type="button">发送</button>
      </section>
    `;
    const diagnostics = new QwenStrategy().diagnoseComposerCandidates({ document, window });
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.find((candidate) => candidate.reason === "search")).toMatchObject({
      eligible: false,
      normalizedLength: 19,
    });
    expect(diagnostics.find((candidate) => candidate.selected)?.descriptor).toBe(
      "textarea#chat-input",
    );
    expect(serialized).not.toContain("private-search-text");
  });
});
