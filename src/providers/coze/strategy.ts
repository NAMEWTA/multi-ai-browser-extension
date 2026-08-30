import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { cozeDefinition } from "./definition";
import { cozeSelectors } from "./selectors";

export class CozeStrategy extends BaseDomStrategy {
  constructor() {
    super(cozeDefinition, cozeSelectors);
  }
}
