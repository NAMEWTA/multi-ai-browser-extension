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
      responses: [".assistant-response"],
      newConversationLabels: ["New chat"],
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

  it("captures a new stable assistant response as plain text", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML =
        '<textarea id="composer"></textarea><button id="send">send</button>';
      const strategy = new TestStrategy();
      const ctx = { document, window, responseTimeoutMs: 3_000 };
      const baseline = await strategy.prepareSubmit(ctx);
      const updates = vi.fn();
      const capture = strategy.captureResponse(ctx, baseline, updates);
      const response = document.createElement("div");
      response.className = "assistant-response";
      response.textContent = "最终回复";
      document.body.append(response);
      await vi.advanceTimersByTimeAsync(2_250);
      await expect(capture).resolves.toEqual({ status: "completed", text: "最终回复" });
      expect(updates).toHaveBeenCalledWith({ status: "streaming", text: "最终回复" });
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
