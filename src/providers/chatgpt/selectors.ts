import type { ProviderSelectors } from "../../core/providers/contracts";

export const chatgptSelectors = {
  composer: ["#prompt-textarea", "div[contenteditable='true'].ProseMirror", "textarea"],
  submit: [
    "button[data-testid='send-button']",
    "button[data-testid='composer-submit-button']",
    "button#composer-submit-button",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "button[aria-label*='发送']",
    "form button[type='submit']",
  ],
  login: ["button[data-testid='login-button']", "a[href*='auth/login']"],
  responses: [".assistant-response", "[data-message-author-role='assistant']"],
  generating: ["button[data-testid='stop-button']", "button[aria-label*='Stop generating']"],
  newConversation: ["a[data-testid='create-new-chat-button']", "a[href='/']"],
  newConversationLabels: ["New chat", "新聊天", "新对话"],
} as const satisfies ProviderSelectors;
