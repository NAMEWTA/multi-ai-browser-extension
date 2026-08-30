import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { minimaxDefinition } from "./definition";
import { minimaxSelectors } from "./selectors";

export class MiniMaxStrategy extends BaseDomStrategy {
  constructor() {
    super(minimaxDefinition, minimaxSelectors);
  }
}
