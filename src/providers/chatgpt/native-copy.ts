import { createScopedNativeCopyAdapter } from "../../core/providers/scoped-native-copy-adapter";

export const chatgptNativeCopyAdapter = createScopedNativeCopyAdapter({
  id: "chatgpt-native-copy",
  turnSelectors: ["[data-testid^='conversation-turn-']"],
  assistantSelectors: ["[data-message-author-role='assistant']", ".assistant-response"],
  userSelectors: ["[data-message-author-role='user']"],
  actionSelectors: [
    "[data-testid*='turn-action']",
    "[class*='message-actions' i]",
    "[role='group']",
  ],
  copySelectors: [
    "button[data-testid='copy-turn-action-button']",
    "button[aria-label*='Copy response' i]",
    "button[aria-label='Copy']",
    "button[aria-label='复制回复']",
    "button[aria-label='复制']",
  ],
  generatingSelectors: [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop generating' i]",
  ],
  keyAttributes: ["data-testid", "data-message-id"],
});
