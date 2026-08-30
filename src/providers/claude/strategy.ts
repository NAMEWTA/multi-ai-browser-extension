import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { claudeDefinition } from "./definition";
import { claudeSelectors } from "./selectors";

export class ClaudeStrategy extends BaseDomStrategy {
  constructor() {
    super(claudeDefinition, claudeSelectors);
  }
}
