import type { ProviderDefinition } from "../../core/providers/contracts";

export const doubaoDefinition = {
  id: "doubao",
  name: "豆包",
  shortName: "DB",
  defaultUrl: "https://www.doubao.com/chat/",
  matches: ["https://www.doubao.com/*"],
  accent: "#2f7cf6",
  embedMode: "preferred",
} as const satisfies ProviderDefinition;
