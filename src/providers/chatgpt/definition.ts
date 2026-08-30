import type { ProviderDefinition } from "../../core/providers/contracts";

export const chatgptDefinition = {
  id: "chatgpt",
  name: "ChatGPT",
  shortName: "GPT",
  defaultUrl: "https://chatgpt.com/",
  matches: ["https://chatgpt.com/*"],
  accent: "#10a37f",
  embedMode: "experimental",
} as const satisfies ProviderDefinition;
