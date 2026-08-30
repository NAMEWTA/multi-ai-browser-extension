import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { deepseekDefinition } from "./definition";
import { deepseekSelectors } from "./selectors";

export class DeepSeekStrategy extends BaseDomStrategy {
  constructor() {
    super(deepseekDefinition, deepseekSelectors);
  }
}
