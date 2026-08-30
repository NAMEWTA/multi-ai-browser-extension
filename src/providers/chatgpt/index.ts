import type { ProviderPlugin } from "../../core/providers/contracts";
import { chatgptDefinition } from "./definition";
import { ChatGptStrategy } from "./strategy";

export default {
  definition: chatgptDefinition,
  createStrategy: () => new ChatGptStrategy(),
} satisfies ProviderPlugin;
