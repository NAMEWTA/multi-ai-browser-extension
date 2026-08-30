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
    "button[aria-label*='发送']:not(:disabled):not([aria-disabled='true'])",
    "button[aria-label*='Send']:not(:disabled):not([aria-disabled='true'])",
    "button[type='submit']:not(:disabled):not([aria-disabled='true'])",
  ],
  login: [
    "a[href*='login']",
    "button[class*='login' i]",
    "[class*='login' i] button",
    "input[type='tel']",
  ],
} as const satisfies ProviderSelectors;
