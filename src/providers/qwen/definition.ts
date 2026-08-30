import type { ProviderDefinition } from "../../core/providers/contracts";

export const qwenDefinition = {
  id: "qwen",
  name: "通义千问",
  shortName: "QW",
  defaultUrl: "https://www.qianwen.com/",
  matches: ["https://www.qianwen.com/*"],
  accent: "#7c3aed",
  embedMode: "experimental",
} as const satisfies ProviderDefinition;
