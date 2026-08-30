import type { ProviderPlugin } from "../../core/providers/contracts";
import { claudeDefinition } from "./definition";
import { ClaudeStrategy } from "./strategy";

export default {
  definition: claudeDefinition,
  createStrategy: () => new ClaudeStrategy(),
} satisfies ProviderPlugin;
