import type { ProviderDefinition } from "../../core/providers/contracts";

export const cozeDefinition = {
  id: "coze",
  name: "Coze",
  shortName: "CZ",
  defaultUrl: "https://www.coze.cn/",
  matches: ["https://www.coze.cn/*", "https://coze.cn/*"],
  accent: "#4c6fff",
  embedMode: "experimental",
} as const satisfies ProviderDefinition;
