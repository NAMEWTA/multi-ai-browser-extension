import type { ProviderPlugin } from "../../core/providers/contracts";
import { deepseekDefinition } from "./definition";
import { DeepSeekStrategy } from "./strategy";

export default {
  definition: deepseekDefinition,
  createStrategy: () => new DeepSeekStrategy(),
} satisfies ProviderPlugin;
