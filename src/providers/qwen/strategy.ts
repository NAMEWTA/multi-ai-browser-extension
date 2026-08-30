import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { qwenDefinition } from "./definition";
import { qwenSelectors } from "./selectors";

export class QwenStrategy extends BaseDomStrategy {
  constructor() {
    super(qwenDefinition, qwenSelectors);
  }
}
