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
} as const satisfies ProviderSelectors;
