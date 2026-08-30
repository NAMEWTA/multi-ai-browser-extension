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
    "div[role='button'].ds-button.ds-button--primary.ds-button--filled.ds-button--circle:not(.ds-button--disabled):not([aria-disabled='true'])",
    "div[role='button'].ds-button--primary.ds-button--circle:not(.ds-button--disabled):not([aria-disabled='true'])",
    "button[aria-label*='发送']:not(:disabled):not([aria-disabled='true'])",
    "button[aria-label*='Send']:not(:disabled):not([aria-disabled='true'])",
    "button[type='submit']:not(:disabled):not([aria-disabled='true'])",
  ],
  submitCandidate: [
    "div[role='button'].ds-button--primary.ds-button--circle",
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[type='submit']",
  ],
  login: [
    "a[href*='login']",
    "button[class*='login' i]",
    "[class*='login' i] button",
    "input[type='tel']",
  ],
  responses: [
    ".assistant-response",
    "[data-role='assistant'] .ds-markdown",
    "[data-role='assistant']",
    ".ds-markdown",
  ],
  generating: [
    "button[aria-label*='停止']",
    "button[aria-label*='Stop']",
    "[data-testid='stop-button']",
  ],
  newConversation: ["button[aria-label*='新对话']", "[role='button'][aria-label*='新对话']"],
  newConversationLabels: ["开启新对话", "新对话", "New chat"],
} as const satisfies ProviderSelectors;
