import type { ProviderSelectors } from "../../core/providers/contracts";

export const minimaxSelectors = {
  composer: [
    "textarea[placeholder]",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']",
  ],
  submit: ["button[aria-label*='发送']", "button[aria-label*='Send']", "button[type='submit']"],
  login: ["a[href*='login']", "button[class*='login']"],
  responses: [".assistant-response", "[data-role='assistant']", "[class*='assistant-message']"],
  responseCapture: {
    turnTiers: [
      {
        id: "assistant-semantic",
        confidence: "semantic",
        selectors: ["[data-role='assistant']", "[class*='assistant-message']"],
      },
      { id: "assistant-fallback", confidence: "fallback", selectors: [".assistant-response"] },
    ],
    contentBlocks: ["[class*='markdown']", "[class*='message-content']", ".assistant-response"],
    exclude: ["[class*='thinking']", "[class*='reasoning']", "[class*='message-action']"],
    statusOnly: ["[role='status']"],
    observeAttributes: ["aria-busy", "data-state", "data-message-id"],
  },
  generating: ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
  newConversation: ["button[aria-label*='新建对话']", "[role='button'][aria-label*='新建对话']"],
  newConversationLabels: ["新建对话", "新对话", "New chat"],
} as const satisfies ProviderSelectors;
