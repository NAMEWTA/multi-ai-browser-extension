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
} as const satisfies ProviderSelectors;
