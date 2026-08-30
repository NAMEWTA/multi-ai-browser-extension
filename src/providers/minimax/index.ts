import type { ProviderPlugin } from "../../core/providers/contracts";
import { minimaxDefinition } from "./definition";
import { MiniMaxStrategy } from "./strategy";

export default {
  definition: minimaxDefinition,
  createStrategy: () => new MiniMaxStrategy(),
} satisfies ProviderPlugin;
