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
} as const satisfies ProviderSelectors;
