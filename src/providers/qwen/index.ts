import type { ProviderPlugin } from "../../core/providers/contracts";
import { qwenDefinition } from "./definition";
import { QwenStrategy } from "./strategy";

export default {
  definition: qwenDefinition,
  createStrategy: () => new QwenStrategy(),
} satisfies ProviderPlugin;
