import type { ProviderPlugin } from "../../core/providers/contracts";
import { kimiDefinition } from "./definition";
import { KimiStrategy } from "./strategy";

export default {
  definition: kimiDefinition,
  createStrategy: () => new KimiStrategy(),
} satisfies ProviderPlugin;
