import type { ProviderDefinition } from "../../core/providers/contracts";

export const deepseekDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  shortName: "DS",
  defaultUrl: "https://chat.deepseek.com/",
  matches: ["https://chat.deepseek.com/*"],
  accent: "#2563eb",
  embedMode: "preferred",
} as const satisfies ProviderDefinition;
