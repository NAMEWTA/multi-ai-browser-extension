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
} as const satisfies ProviderSelectors;
