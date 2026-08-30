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
    const strategy = new ScopedStrategy();

    await strategy.writePrompt({ document, window }, { text: "hello" });
    await strategy.submit({ document, window });

    expect(chatSend).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
  });
});
