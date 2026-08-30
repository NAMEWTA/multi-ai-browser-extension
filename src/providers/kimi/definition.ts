import type { ProviderDefinition } from "../../core/providers/contracts";

export const kimiDefinition = {
  id: "kimi",
  name: "Kimi",
  shortName: "K",
  defaultUrl: "https://www.kimi.com/",
  matches: ["https://www.kimi.com/*"],
  accent: "#111827",
  embedMode: "preferred",
} as const satisfies ProviderDefinition;
