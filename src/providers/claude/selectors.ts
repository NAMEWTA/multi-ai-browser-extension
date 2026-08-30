import type { ProviderSelectors } from "../../core/providers/contracts";

export const claudeSelectors = {
  composer: [
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true'][data-placeholder]",
    "fieldset div[contenteditable='true']",
  ],
  submit: [
    "button[aria-label='Send Message']",
    "button[aria-label='Send message']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']",
    "fieldset button[type='button']:has(svg)",
    "button[type='submit']",
  ],
  login: ["a[href*='login']", "button[data-testid='login-button']"],
  responses: [
    ".assistant-response",
    "[data-testid*='assistant']",
    "[class*='font-claude-response']",
  ],
  generating: ["[data-is-streaming='true']", "button[aria-label*='Stop']"],
  newConversation: ["a[href='/new']", "button[aria-label*='new chat' i]"],
  newConversationLabels: ["New chat", "新对话"],
} as const satisfies ProviderSelectors;
