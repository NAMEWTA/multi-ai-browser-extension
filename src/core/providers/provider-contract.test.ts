import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerRegistry } from "./registry";

const fixtures: Record<string, { composer: string; submit: string }> = {
  deepseek: {
    composer: '<textarea class="ds-scroll-area" placeholder="给 DeepSeek 发送消息"></textarea>',
    submit: '<button class="ds-icon-button" type="button" aria-label="Send"><svg></svg></button>',
  },
  kimi: {
    composer: '<div class="chat-input-editor" contenteditable="true"></div>',
    submit: '<div class="send-button-container" role="button"></div>',
  },
  coze: {
    composer: '<textarea placeholder="给 Coze 发送消息"></textarea>',
    submit: '<button type="submit"></button>',
  },
  chatgpt: {
    composer: '<div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>',
    submit: '<button data-testid="composer-submit-button" type="button"></button>',
  },
  claude: {
    composer: '<div class="ProseMirror" role="textbox" contenteditable="true"></div>',
    submit: '<button aria-label="Send Message" type="button"></button>',
  },
  qwen: {
    composer: '<textarea placeholder="向千问提问"></textarea>',
    submit: '<button class="send-button" type="button"></button>',
  },
  minimax: {
    composer: '<textarea placeholder="Ask anything"></textarea>',
    submit: '<button type="submit"></button>',
  },
  doubao: {
    composer: '<div contenteditable="true" role="textbox"></div>',
    submit: '<button id="flow-end-msg-send" type="button"></button>',
  },
};

const nativeCopyFixtures: Record<string, string> = {
  deepseek: `
    <article data-virtual-list-item-key="answer-1">
      <div class="ds-assistant-message-main-content">answer</div>
      <button aria-label="Copy response"></button>
    </article>`,
  kimi: `
    <article class="chat-content-item-assistant" data-message-id="answer-1">
      <div class="segment-content"><div class="markdown">answer</div></div>
      <button aria-label="复制"></button>
    </article>`,
  coze: `
    <article data-role="assistant" data-message-id="answer-1">
      <div class="markdown-body">answer</div><div class="message-action"><button aria-label="复制"></button></div>
    </article>`,
  chatgpt: `
    <article data-testid="conversation-turn-2">
      <div data-message-author-role="assistant">answer</div>
      <button data-testid="copy-turn-action-button"></button>
    </article>`,
  claude: `
    <section data-message-id="answer-1">
      <div data-testid="assistant-message" class="font-claude-response">answer</div>
      <div data-testid="message-actions"><button data-testid="action-copy"></button></div>
    </section>`,
  qwen: `
    <section class="chat-round" data-chat="answer-1">
      <div class="chat-answers-card-wrap" data-chat-answers-wrap="answer-1">
        <div class="answer-text md-text-card"><div class="qk-markdown">answer</div></div>
        <div data-answer-feedback-toolbar><button aria-label="复制回复"></button></div>
      </div>
    </section>`,
  minimax: `
    <article data-role="assistant" data-message-id="answer-1">
      <div class="markdown-body">answer</div><div class="message-action"><button aria-label="Copy response"></button></div>
    </article>`,
  doubao: `
    <div class="list_items"><div class="v_list_row" data-message-id="answer-1">
      <div class="flow-markdown-body">answer</div>
      <div class="message-action-bar"><button aria-label="复制回复"></button></div>
    </div></div>`,
};

describe("Provider plugin contract", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("auto-discovers the current eight built-in providers", () => {
    expect(
      providerRegistry
        .all()
        .map((plugin) => plugin.definition.id)
        .sort(),
    ).toEqual(["chatgpt", "claude", "coze", "deepseek", "doubao", "kimi", "minimax", "qwen"]);
  });

  it.each(providerRegistry.all().map((plugin) => [plugin.definition.id, plugin] as const))(
    "%s writes Unicode text and clicks one send control",
    async (providerId, plugin) => {
      const fixture = fixtures[providerId];
      expect(fixture).toBeDefined();
      document.body.innerHTML = `${fixture!.composer}${fixture!.submit}`;
      const composer = document.body.firstElementChild as HTMLElement;
      const submit = document.body.lastElementChild as HTMLElement;
      const click = vi.fn();
      submit.addEventListener("click", () => {
        click();
        if (composer instanceof HTMLTextAreaElement) composer.value = "";
        else composer.replaceChildren();
      });

      const strategy = plugin.createStrategy();
      const ctx = { document, window, timeoutMs: 100 };
      await expect(strategy.probe(ctx)).resolves.toMatchObject({ status: "ready" });
      await strategy.prepareSubmit(ctx);
      await strategy.stagePrompt(ctx, { text: "花儿为什么这么红？\n第二行" });
      await strategy.submit(ctx);

      const value = composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent;
      expect(value).toBe("");
      expect(click).toHaveBeenCalledTimes(1);
    },
  );

  it.each(providerRegistry.all().map((plugin) => [plugin.definition.id, plugin] as const))(
    "%s registers a response-level native Copy target",
    async (providerId, plugin) => {
      const fixture = fixtures[providerId];
      const copyFixture = nativeCopyFixtures[providerId];
      expect(fixture).toBeDefined();
      expect(copyFixture).toBeDefined();
      document.body.innerHTML = `${fixture!.composer}${fixture!.submit}${copyFixture}`;

      const baseline = await plugin.createStrategy().prepareSubmit({
        document,
        window,
        nativeCopy: { capture: vi.fn() },
        timeoutMs: 100,
      });

      expect(baseline.nativeCopyTargets).toHaveLength(1);
    },
  );

  it("matches provider URLs without a central switch", () => {
    expect(providerRegistry.match("https://chatgpt.com/c/1")?.definition.id).toBe("chatgpt");
    expect(providerRegistry.match("https://www.qianwen.com/c/1")?.definition.id).toBe("qwen");
    expect(providerRegistry.match("https://chat.qwen.ai/c/1")).toBeUndefined();
    expect(providerRegistry.match("https://agent.minimax.io/")?.definition.id).toBe("minimax");
    expect(providerRegistry.match("https://www.coze.cn/")?.definition.id).toBe("coze");
    expect(providerRegistry.match("https://www.doubao.com/chat/")?.definition.id).toBe("doubao");
    expect(providerRegistry.match("https://example.com/")).toBeUndefined();
  });
});
