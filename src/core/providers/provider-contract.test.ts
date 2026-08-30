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
};

describe("Provider plugin contract", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("auto-discovers the current seven built-in providers", () => {
    expect(
      providerRegistry
        .all()
        .map((plugin) => plugin.definition.id)
        .sort(),
    ).toEqual(["chatgpt", "claude", "coze", "deepseek", "kimi", "minimax", "qwen"]);
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
      await strategy.writePrompt(ctx, { text: "花儿为什么这么红？\n第二行" });
      await strategy.submit(ctx);

      const value = composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent;
      expect(value).toBe("");
      expect(click).toHaveBeenCalledTimes(1);
    },
  );

  it("matches provider URLs without a central switch", () => {
    expect(providerRegistry.match("https://chatgpt.com/c/1")?.definition.id).toBe("chatgpt");
    expect(providerRegistry.match("https://www.qianwen.com/c/1")?.definition.id).toBe("qwen");
    expect(providerRegistry.match("https://chat.qwen.ai/c/1")).toBeUndefined();
    expect(providerRegistry.match("https://agent.minimax.io/")?.definition.id).toBe("minimax");
    expect(providerRegistry.match("https://www.coze.cn/")?.definition.id).toBe("coze");
    expect(providerRegistry.match("https://example.com/")).toBeUndefined();
  });
});
