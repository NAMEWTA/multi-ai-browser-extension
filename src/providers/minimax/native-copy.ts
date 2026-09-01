import { createScopedNativeCopyAdapter } from "../../core/providers/scoped-native-copy-adapter";

export const minimaxNativeCopyAdapter = createScopedNativeCopyAdapter({
  id: "minimax-native-copy",
  turnSelectors: [
    "[data-role='assistant']",
    "[data-testid*='assistant-message' i]",
    "[class*='assistant-message' i]",
    ".assistant-response",
  ],
  assistantSelectors: [
    "[data-role='assistant']",
    "[data-testid*='assistant-message' i]",
    "[class*='assistant-message' i]",
    ".assistant-response",
  ],
  userSelectors: [
    "[data-role='user']",
    "[data-testid*='user-message' i]",
    "[class*='user-message' i]",
  ],
  actionSelectors: [
    "[data-testid*='message-action' i]",
    "[class*='message-action' i]",
    "[class*='action-bar' i]",
    "[class*='toolbar' i]",
    "[role='group']",
  ],
  copySelectors: [
    "button[data-testid*='copy' i]",
    "[role='button'][data-testid*='copy' i]",
    "button[aria-label*='复制']",
    "[role='button'][aria-label*='复制']",
    "button[aria-label*='Copy' i]",
    "[role='button'][aria-label*='Copy' i]",
    "button[title*='复制']",
    "button[title*='Copy' i]",
  ],
  generatingSelectors: [
    "button[aria-label*='停止']",
    "button[aria-label*='Stop' i]",
    "[data-state='streaming']",
    "[aria-busy='true']",
  ],
  keyAttributes: ["data-message-id", "data-testid", "data-id"],
  maxAncestorLevels: 3,
  terminalStableMs: 2_000,
});
