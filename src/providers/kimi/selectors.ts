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
    "[data-message-id][class*='chat-content-item-assistant']",
    "[class*='chat-content-item-assistant']",
    "[data-role='assistant']",
    "[class*='chat-content-list'] [class*='assistant']:has([class*='segment-content'], [class*='markdown'])",
    "[data-message-id]:has([class*='segment-content'], [class*='markdown'])",
    ".assistant-response",
    "[class*='segment-assistant']",
  ],
  responseContent: [
    "[class*='markdown']:not([class*='think'] [class*='markdown']):not([class*='search'] [class*='markdown'])",
    "[class*='segment-content']:not([class*='think']):not([class*='search'])",
  ],
  responseExclude: [
    "[class*='thinking']",
    "[class*='reasoning']",
    "[class*='search-process']",
    "[class*='search-status']",
    "[class*='tool-call']",
    "[class*='loading']",
    "[aria-busy='true']",
  ],
  responseCapture: {
    turnTiers: [
      {
        id: "assistant-message",
        confidence: "canonical",
        selectors: [
          "[data-message-id][class*='chat-content-item-assistant']",
          "[class*='chat-content-item-assistant']",
        ],
      },
      {
        id: "assistant-semantic",
        confidence: "semantic",
        selectors: ["[data-role='assistant']", "[data-message-id]:has([class*='segment-content'])"],
      },
      {
        id: "assistant-fallback",
        confidence: "fallback",
        selectors: [".assistant-response", "[class*='segment-assistant']"],
      },
    ],
    finalContainers: ["[class*='segment-content']:not([class*='think']):not([class*='search'])"],
    contentBlocks: [
      "[class*='markdown']:not([class*='think'] [class*='markdown']):not([class*='search'] [class*='markdown'])",
    ],
    exclude: [
      "[class*='thinking']",
      "[class*='reasoning']",
      "[class*='search-process']",
      "[class*='search-status']",
      "[class*='tool-call']",
      "[class*='loading']",
      "[aria-busy='true']",
    ],
    statusOnly: ["[role='status']"],
    observeAttributes: ["aria-busy", "data-state", "data-message-id"],
    allowStableCompletionWithoutGenerating: true,
  },
  generating: [
    "button[aria-label*='停止']",
    "button[aria-label*='Stop']",
    ".send-button-container.stop",
    "[class*='chat-content-item-assistant'] [aria-busy='true']",
    "[class*='segment'][data-state='loading']",
    "[class*='segment'][class*='loading']",
  ],
  responseTimeoutMs: 600_000,
  responseQuietMs: 8_000,
  responsePollMs: 1_000,
  newConversation: ["button[aria-label*='新建会话']", "button[aria-label*='新建对话']"],
  newConversationLabels: ["新建会话", "新建对话", "New chat"],
} as const satisfies ProviderSelectors;
