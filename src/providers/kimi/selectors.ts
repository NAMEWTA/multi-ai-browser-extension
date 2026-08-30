import type { ProviderSelectors } from "../../core/providers/contracts";

export const kimiSelectors = {
  composer: [
    "div.chat-input-editor[contenteditable='true'][data-lexical-editor='true']",
    "div[contenteditable='true'][data-lexical-editor='true']",
    "div.chat-input-editor[contenteditable='true']",
    "div[contenteditable='true'].ProseMirror",
    "textarea[placeholder]",
    "div[contenteditable='true']",
  ],
  submit: [
    ".send-button-container:not(.disabled):not([aria-disabled='true'])",
    "button:has(svg[name='Send'])",
    "button:has(.send-icon)",
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[type='submit']",
  ],
  login: ["button[class*='login']", "a[href*='login']"],
  responses: [
    ".assistant-response",
    "[data-role='assistant'] [class*='markdown']",
    "[data-role='assistant']",
    "[class*='segment-assistant']",
  ],
  generating: [
    "button[aria-label*='停止']",
    "button[aria-label*='Stop']",
    ".send-button-container.stop",
  ],
  newConversation: ["button[aria-label*='新建会话']", "button[aria-label*='新建对话']"],
  newConversationLabels: ["新建会话", "新建对话", "New chat"],
} as const satisfies ProviderSelectors;
