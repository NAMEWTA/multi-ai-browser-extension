import type { ProviderSelectors } from "../../core/providers/contracts";

export const cozeSelectors = {
  composer: [
    "textarea[placeholder]",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true']",
  ],
  submit: [
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[type='submit']",
    "[role='button'][aria-label*='发送']",
  ],
  login: ["a[href*='login']", "button[class*='login' i]", "input[type='tel']"],
} as const satisfies ProviderSelectors;
