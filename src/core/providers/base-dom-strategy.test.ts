import { describe, expect, it, vi } from "vitest";
import { BaseDomStrategy } from "./base-dom-strategy";
import { waitForElement } from "./dom";
import { normalizeProviderError, ProviderError } from "./errors";
import { ButtonSubmitter } from "./submitters/button-submitter";
import { CompositeComposerWriter } from "./writers/composer-writer";

const definition = {
  id: "deepseek",
  name: "Test",
  shortName: "T",
  defaultUrl: "https://example.com/",
  matches: ["https://example.com/*"],
  accent: "#000000",
  embedMode: "preferred",
} as const;

class TestStrategy extends BaseDomStrategy {
  constructor() {
    super(definition, {
      composer: ["#composer"],
      submit: ["#send"],
      login: ["#login"],
      blocked: ["#verification"],
      responses: [".assistant-response"],
      newConversationLabels: ["New chat"],
    });
  }
}

class NativeTargetOnlyStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = {
    id: "test-target-only-native-copy",
    capturePolicy: { maxAttempts: 2, requireDomEndingAnchor: false, terminalStableMs: 250 },
    locateCopyButton: (_ctx: unknown, response: HTMLElement) =>
      response.querySelector<HTMLElement>(".copy") ?? undefined,
    listTargets: (ctx: { document: Document }) =>
      [...ctx.document.querySelectorAll<HTMLElement>(".copy-turn")].flatMap((response) => {
        const button = response.querySelector<HTMLElement>(".copy");
        return button ? [{ key: response.dataset.turnId ?? "anonymous", response, button }] : [];
      }),
    isTerminalTarget: () => true,
  };

  constructor() {
    super(definition, {
      composer: ["#composer"],
      submit: ["#send"],
      blocked: ["#verification"],
      responses: [".selector-that-does-not-match-the-copy-turn"],
      responsePollMs: 20,
    });
  }
}

describe("BaseDomStrategy", () => {
  it("reports a website login state", async () => {
    document.body.innerHTML = '<a id="login">Login</a>';
    const strategy = new TestStrategy();
    const ctx = { document, window, timeoutMs: 10 };
    await expect(strategy.probe(ctx)).resolves.toMatchObject({ status: "needs-login" });
    await expect(strategy.waitUntilReady(ctx)).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("prioritizes a visible verification challenge over a usable composer", async () => {
    document.body.innerHTML = '<textarea id="composer"></textarea><div id="verification"></div>';
    const strategy = new TestStrategy();
    const ctx = { document, window, timeoutMs: 10 };

    await expect(strategy.probe(ctx)).resolves.toMatchObject({ status: "blocked" });
    await expect(strategy.waitUntilReady(ctx)).rejects.toMatchObject({
      code: "VERIFICATION_REQUIRED",
    });
  });

  it("waits for a composer and can clear it during prompt synchronization", async () => {
    document.body.replaceChildren();
    const pending = waitForElement(document, ["#composer"], { timeoutMs: 100 });
    const composer = document.createElement("textarea");
    composer.id = "composer";
    composer.value = "old";
    document.body.append(composer);
    await expect(pending).resolves.toBe(composer);
    await new TestStrategy().writePrompt({ document, window }, { text: "" });
    expect(composer.value).toBe("");
  });

  it("does not steal focus while synchronizing native and contenteditable composers", () => {
    document.body.innerHTML = `
      <input id="workspace-input" />
      <textarea id="native-composer"></textarea>
      <div id="rich-composer" contenteditable="true"></div>
    `;
    const workspaceInput = document.querySelector<HTMLInputElement>("#workspace-input")!;
    const nativeComposer = document.querySelector<HTMLElement>("#native-composer")!;
    const richComposer = document.querySelector<HTMLElement>("#rich-composer")!;
    const writer = new CompositeComposerWriter();
    workspaceInput.focus();

    writer.write(nativeComposer, "native");
    expect(document.activeElement).toBe(workspaceInput);

    writer.write(richComposer, "rich");
    expect(document.activeElement).toBe(workspaceInput);
  });

  it("normalizes abort, regular and unknown failures", () => {
    expect(normalizeProviderError(new ProviderError("TIMEOUT", "late")).code).toBe("TIMEOUT");
    expect(normalizeProviderError(new DOMException("stop", "AbortError")).code).toBe("ABORTED");
    expect(normalizeProviderError(new Error("bad")).message).toBe("bad");
    expect(normalizeProviderError("bad").code).toBe("UNKNOWN");
  });

  it("rejects unsupported composers and disabled buttons", () => {
    expect(() => new CompositeComposerWriter().write(document.createElement("div"), "x")).toThrow(
      "暂不支持",
    );
    const button = document.createElement("button");
    button.disabled = true;
    expect(() => new ButtonSubmitter().submit(button)).toThrow("发送按钮当前不可用");
  });

  it("clicks a submit control without moving focus or scrolling to it", () => {
    document.body.innerHTML = '<input id="workspace-input"><button id="send">send</button>';
    const input = document.querySelector<HTMLInputElement>("#workspace-input")!;
    const button = document.querySelector<HTMLButtonElement>("#send")!;
    const focus = vi.spyOn(button, "focus");
    const click = vi.spyOn(button, "click");
    input.focus();

    new ButtonSubmitter().submit(button);

    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(click).toHaveBeenCalledOnce();
  });

  it("returns a standardized submit error when no button appears", async () => {
    document.body.innerHTML = '<textarea id="composer"></textarea>';
    await expect(
      new TestStrategy().submit({ document, window, timeoutMs: 5 }),
    ).rejects.toMatchObject({
      code: "SUBMIT_MISSING",
    });
  });

  it("preflights without mutating the page and rejects an occupied composer", async () => {
    document.body.innerHTML =
      '<textarea id="composer">draft</textarea><button id="send">send</button>';
    const strategy = new TestStrategy();
    await expect(strategy.prepareSubmit({ document, window })).rejects.toMatchObject({
      code: "COMPOSER_NOT_EMPTY",
    });
    expect(document.querySelector<HTMLTextAreaElement>("#composer")?.value).toBe("draft");
  });

  it("preflights an empty composer before the website renders its send button", async () => {
    document.body.innerHTML = '<textarea id="composer"></textarea>';
    const strategy = new TestStrategy();
    await expect(strategy.prepareSubmit({ document, window, timeoutMs: 10 })).resolves.toEqual({
      count: 0,
      lastText: "",
    });
    expect(document.querySelector<HTMLTextAreaElement>("#composer")?.value).toBe("");
  });

  it("ignores editor placeholder nodes and zero-width markers when checking for a draft", async () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">
        <span data-placeholder="Ask anything">Ask anything</span>
        <span data-slate-zero-width="z">\u200B</span>
      </div>
    `;
    await expect(
      new TestStrategy().prepareSubmit({ document, window, timeoutMs: 10 }),
    ).resolves.toEqual({ count: 0, lastText: "" });
  });

  it("keeps the composer selected during precheck bound through staging", async () => {
    document.body.innerHTML = `
      <textarea id="composer"></textarea>
      <button id="send">send</button>
    `;
    const original = document.querySelector<HTMLTextAreaElement>("#composer")!;
    const strategy = new TestStrategy();
    await strategy.prepareSubmit({ document, window, timeoutMs: 100 });
    original.id = "bound-composer";
    const replacement = document.createElement("textarea");
    replacement.id = "composer";
    document.body.prepend(replacement);

    await strategy.stagePrompt({ document, window, timeoutMs: 100 }, { text: "bound" });
    expect(original.value).toBe("bound");
    expect(replacement.value).toBe("");
  });

  it("stages content, waits for the enabled control, and can roll it back without clicking", async () => {
    document.body.innerHTML = `
      <textarea id="composer"></textarea>
      <button id="send" disabled>send</button>
    `;
    const composer = document.querySelector<HTMLTextAreaElement>("#composer")!;
    const send = document.querySelector<HTMLButtonElement>("#send")!;
    const click = vi.spyOn(send, "click");
    composer.addEventListener("input", () => {
      send.disabled = composer.value.length === 0;
    });
    const strategy = new TestStrategy();
    await strategy.prepareSubmit({ document, window, timeoutMs: 100 });
    await strategy.stagePrompt({ document, window, timeoutMs: 100 }, { text: "atomic" });
    expect(composer.value).toBe("atomic");
    expect(click).not.toHaveBeenCalled();

    await strategy.rollbackPrompt({ document, window, timeoutMs: 100 }, { text: "atomic" });
    expect(composer.value).toBe("");
    expect(click).not.toHaveBeenCalled();
  });

  it("requires a provider native Copy adapter for response bodies", async () => {
    const result = await new TestStrategy().captureResponse(
      { document, window },
      { count: 0, lastText: "" },
    );

    expect(result).toEqual({
      status: "unsupported",
      terminalReason: "unsupported",
      message: "当前站点未提供原生 Copy 回复采集能力",
    });
  });

  it("waits for a stable terminal target and returns only the native Copy payload", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<textarea id="composer"></textarea><button id="send"></button>';
      const strategy = new NativeTargetOnlyStrategy();
      const nativeCopy = {
        capture: vi.fn().mockResolvedValue({
          text: "# Complete provider answer\n\nFinal paragraph.",
          mimeType: "text/markdown" as const,
        }),
      };
      const ctx = { document, window, nativeCopy, responseTimeoutMs: 3_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      const capture = strategy.captureResponse(ctx, baseline, { text: "prompt" });
      document.body.insertAdjacentHTML(
        "beforeend",
        '<article class="copy-turn" data-turn-id="current"><p>Final paragraph.</p><button class="copy">copy</button></article>',
      );

      await vi.advanceTimersByTimeAsync(249);
      expect(nativeCopy.capture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);

      await expect(capture).resolves.toMatchObject({
        status: "completed",
        terminalReason: "completed",
        captureSource: "native-copy",
        nativeMimeType: "text/markdown",
        markdown: expect.stringContaining("Final paragraph"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets terminal stability when the target content changes", async () => {
    vi.useFakeTimers();
    try {
      const strategy = new NativeTargetOnlyStrategy();
      const nativeCopy = {
        capture: vi.fn().mockResolvedValue({
          text: "Complete answer ending",
          mimeType: "text/plain" as const,
        }),
      };
      const capture = strategy.captureResponse(
        { document, window, nativeCopy, responseTimeoutMs: 2_000 },
        { count: 0, lastText: "", nativeCopyTargets: [] },
      );
      document.body.innerHTML =
        '<article class="copy-turn" data-turn-id="current"><p>draft</p><button class="copy">copy</button></article>';
      await vi.advanceTimersByTimeAsync(200);
      document.querySelector(".copy-turn p")!.textContent = "Complete answer ending";
      await vi.advanceTimersByTimeAsync(249);
      expect(nativeCopy.capture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(52);

      await expect(capture).resolves.toMatchObject({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails without persisting visible DOM when native Copy is invalid", async () => {
    vi.useFakeTimers();
    try {
      const strategy = new NativeTargetOnlyStrategy();
      const nativeCopy = { capture: vi.fn().mockRejectedValue(new Error("no clipboard write")) };
      const capture = strategy.captureResponse(
        { document, window, nativeCopy, responseTimeoutMs: 2_000 },
        { count: 0, lastText: "", nativeCopyTargets: [] },
      );
      document.body.innerHTML =
        '<article class="copy-turn" data-turn-id="current"><p>Visible but untrusted DOM body</p><button class="copy">copy</button></article>';
      await vi.advanceTimersByTimeAsync(300);

      await expect(capture).resolves.toEqual({
        status: "failed",
        terminalReason: "failed",
        message: "官网回复已结束，但从本轮原生 Copy 按钮取得的内容无效",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out without converting a DOM fragment into a partial reply", async () => {
    vi.useFakeTimers();
    try {
      const capture = new NativeTargetOnlyStrategy().captureResponse(
        {
          document,
          window,
          nativeCopy: { capture: vi.fn() },
          responseTimeoutMs: 500,
        },
        { count: 0, lastText: "", nativeCopyTargets: [] },
      );
      document.body.innerHTML = '<div class="assistant-response">Visible fragment</div>';
      await vi.advanceTimersByTimeAsync(501);

      await expect(capture).resolves.toEqual({
        status: "timeout",
        terminalReason: "timeout",
        message: "等待本轮回复的原生 Copy 按钮进入稳定终态超时",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a finalized native rescue when a capture is superseded", async () => {
    const controller = new AbortController();
    const capture = new NativeTargetOnlyStrategy().captureResponse(
      {
        document,
        window,
        nativeCopy: { capture: vi.fn() },
        signal: controller.signal,
        responseTimeoutMs: 3_000,
      },
      { count: 0, lastText: "", nativeCopyTargets: [] },
    );
    controller.abort({
      status: "completed",
      terminalReason: "completed",
      text: "complete native answer",
      markdown: "**complete native answer**",
      captureSource: "native-copy",
      nativeMimeType: "text/markdown",
    });

    await expect(capture).resolves.toMatchObject({
      status: "completed",
      text: "complete native answer",
      captureSource: "native-copy",
    });
  });

  it("fails clearly when verification appears before Copy capture", async () => {
    vi.useFakeTimers();
    try {
      const capture = new NativeTargetOnlyStrategy().captureResponse(
        {
          document,
          window,
          nativeCopy: { capture: vi.fn() },
          responseTimeoutMs: 3_000,
        },
        { count: 0, lastText: "", nativeCopyTargets: [] },
      );
      document.body.innerHTML = '<div id="verification"></div>';
      await vi.advanceTimersByTimeAsync(0);

      await expect(capture).resolves.toMatchObject({
        status: "failed",
        terminalReason: "verification",
        message: expect.stringContaining("人工验证"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a new official conversation through the configured control", async () => {
    document.body.innerHTML = `
      <button id="new">New chat</button>
      <textarea id="composer"></textarea>
      <button id="send">send</button>
      <div class="assistant-response">old answer</div>
    `;
    document.querySelector("#new")?.addEventListener("click", () => {
      document.querySelector(".assistant-response")?.remove();
    });
    await expect(
      new TestStrategy().startNewConversation({ document, window, timeoutMs: 100 }),
    ).resolves.toBeUndefined();
  });

  it("submits with the matching control nearest to the active composer", async () => {
    document.body.innerHTML = `
      <aside><button class="send">unrelated</button></aside>
      <section><textarea id="composer"></textarea><button class="send">chat send</button></section>
    `;
    class ScopedStrategy extends BaseDomStrategy {
      constructor() {
        super(definition, { composer: ["#composer"], submit: [".send"] });
      }
    }
    const buttons = document.querySelectorAll<HTMLButtonElement>(".send");
    const unrelated = vi.spyOn(buttons[0]!, "click");
    const chatSend = vi.spyOn(buttons[1]!, "click");
    buttons[1]!.addEventListener("click", () => {
      (document.querySelector("#composer") as HTMLTextAreaElement).value = "";
    });
    const strategy = new ScopedStrategy();

    await strategy.writePrompt({ document, window }, { text: "hello" });
    await strategy.submit({ document, window });

    expect(chatSend).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
  });
});
