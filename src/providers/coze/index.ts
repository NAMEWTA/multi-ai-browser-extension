import type { ProviderPlugin } from "../../core/providers/contracts";
import { cozeDefinition } from "./definition";
import { CozeStrategy } from "./strategy";

export default {
  definition: cozeDefinition,
  createStrategy: () => new CozeStrategy(),
} satisfies ProviderPlugin;
