import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { kimiDefinition } from "./definition";
import { kimiSelectors } from "./selectors";

export class KimiStrategy extends BaseDomStrategy {
  constructor() {
    super(kimiDefinition, kimiSelectors);
  }
}
