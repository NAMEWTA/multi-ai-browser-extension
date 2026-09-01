import type { ProviderPlugin } from "../../core/providers/contracts";
import { doubaoDefinition } from "./definition";
import { DoubaoStrategy } from "./strategy";

export default {
  definition: doubaoDefinition,
  createStrategy: () => new DoubaoStrategy(),
} satisfies ProviderPlugin;
