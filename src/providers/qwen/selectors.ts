import type { ProviderSelectors } from "../../core/providers/contracts";

export const qwenSelectors = {
  composer: [
    "textarea#chat-input",
    "textarea[placeholder*='千问']",
    "textarea[placeholder*='Qwen']",
    "textarea[placeholder*='Ask']",
    "textarea[placeholder]",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true']",
  ],
  submit: [
    "button[class*='send' i]",
    "button[aria-label*='发送']",
    "button[aria-label*='send' i]",
    "button[aria-label*='submit' i]",
    "button[title*='send' i]",
    "button[title*='submit' i]",
    "button[type='submit']",
    "[role='button'][aria-label*='send' i]",
    "[class*='send' i][role='button']",
  ],
  login: ["a[href*='login']", "button[class*='login']"],
} as const satisfies ProviderSelectors;
