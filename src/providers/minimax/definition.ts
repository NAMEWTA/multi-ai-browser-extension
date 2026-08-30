import type { ProviderDefinition } from "../../core/providers/contracts";

export const minimaxDefinition = {
  id: "minimax",
  name: "MiniMax",
  shortName: "MM",
  defaultUrl: "https://agent.minimax.io/",
  matches: ["https://chat.minimax.io/*", "https://agent.minimax.io/*"],
  accent: "#ef4444",
  embedMode: "experimental",
} as const satisfies ProviderDefinition;
