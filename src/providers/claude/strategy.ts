import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { claudeDefinition } from "./definition";
import { claudeNativeCopyAdapter } from "./native-copy";
import { claudeSelectors } from "./selectors";

export class ClaudeStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = claudeNativeCopyAdapter;

  constructor() {
    super(claudeDefinition, claudeSelectors);
  }
}
