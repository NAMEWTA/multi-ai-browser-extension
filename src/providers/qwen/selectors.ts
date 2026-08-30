import type { ProviderSelectors } from "../../core/providers/contracts";

export const qwenSelectors = {
  composer: [
    "textarea#chat-input",
    "textarea[placeholder*='千问']",
    "textarea[placeholder*='Qwen']",
    "textarea[placeholder*='Ask']",
    "textarea[placeholder]",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true']",
  ],
  submit: [
    "button[class*='send' i]",
    "button[aria-label*='发送']",
    "button[aria-label*='send' i]",
    "button[aria-label*='submit' i]",
    "button[title*='send' i]",
    "button[title*='submit' i]",
    "button[type='submit']",
    "[role='button'][aria-label*='send' i]",
    "[class*='send' i][role='button']",
  ],
  login: ["a[href*='login']", "button[class*='login']"],
  responses: [
    ".assistant-response",
    "[data-role='assistant'] .markdown-body",
    "[data-role='assistant']",
    "[class*='answer-content']",
  ],
  generating: [
    "button[aria-label*='停止']",
    "button[aria-label*='stop' i]",
    "[class*='stop' i][role='button']",
  ],
  newConversation: ["button[aria-label*='新建对话']", "[role='button'][aria-label*='新建对话']"],
  newConversationLabels: ["新建对话", "新对话", "New chat"],
} as const satisfies ProviderSelectors;
