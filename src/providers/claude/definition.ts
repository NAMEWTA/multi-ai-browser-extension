import type { ProviderDefinition } from "../../core/providers/contracts";

export const claudeDefinition = {
  id: "claude",
  name: "Claude",
  shortName: "C",
  defaultUrl: "https://claude.ai/",
  matches: ["https://claude.ai/*"],
  accent: "#d97757",
  embedMode: "experimental",
} as const satisfies ProviderDefinition;
