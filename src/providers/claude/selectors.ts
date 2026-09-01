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
  responseCapture: {
    turnTiers: [
      {
        id: "assistant-testid",
        confidence: "canonical",
        selectors: ["[data-testid*='assistant']"],
      },
      {
        id: "assistant-semantic",
        confidence: "semantic",
        selectors: [".assistant-response", "[class*='font-claude-response']"],
      },
    ],
    contentBlocks: [".standard-markdown", ".prose", "[class*='font-claude-response']"],
    exclude: ["[class*='message-actions']", "[data-testid*='feedback']"],
    statusOnly: ["[role='status']"],
    observeAttributes: ["aria-busy", "data-state", "data-is-streaming", "data-testid"],
  },
  generating: ["[data-is-streaming='true']", "button[aria-label*='Stop']"],
  newConversation: ["a[href='/new']", "button[aria-label*='new chat' i]"],
  newConversationLabels: ["New chat", "新对话"],
} as const satisfies ProviderSelectors;
