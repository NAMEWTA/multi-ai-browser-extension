import { createScopedNativeCopyAdapter } from "../../core/providers/scoped-native-copy-adapter";

export const claudeNativeCopyAdapter = createScopedNativeCopyAdapter({
  id: "claude-native-copy",
  turnSelectors: [
    "[data-testid='assistant-message']",
    "[data-testid*='assistant-message']",
    "[data-is-streaming]",
    ".font-claude-response",
  ],
  assistantSelectors: [
    "[data-testid='assistant-message']",
    "[data-testid*='assistant-message']",
    ".font-claude-response",
  ],
  userSelectors: ["[data-testid='user-message']", "[data-testid*='user-message']"],
  actionSelectors: [
    "[data-testid*='message-action' i]",
    "[data-testid*='action-bar' i]",
    "[class*='message-actions' i]",
    "[role='group']",
  ],
  copySelectors: [
    "button[data-testid*='copy' i]",
    "button[aria-label*='Copy response' i]",
    "button[aria-label='Copy']",
    "button[aria-label='复制']",
  ],
  generatingSelectors: [
    "[data-is-streaming='true']",
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop' i]",
  ],
  keyAttributes: ["data-message-id", "data-testid", "data-id"],
  maxAncestorLevels: 4,
  terminalStableMs: 1_750,
});
