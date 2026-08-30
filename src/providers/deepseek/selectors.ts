import type { ProviderSelectors } from "../../core/providers/contracts";

export const deepseekSelectors = {
  composer: [
    "textarea#chat-input",
    "textarea.ds-scroll-area",
    "textarea[class*='ds-']",
    "textarea[placeholder*='DeepSeek']",
    "textarea[placeholder]",
    "div[contenteditable='true']",
  ],
  submit: [
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[type='submit']",
    "button.ds-icon-button:not([aria-disabled='true'])",
    ".ds-icon-button[role='button']:not([aria-disabled='true'])",
  ],
  login: [
    "a[href*='login']",
    "button[class*='login' i]",
    "[class*='login' i] button",
    "input[type='tel']",
  ],
} as const satisfies ProviderSelectors;
