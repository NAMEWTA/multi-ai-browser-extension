import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { claudeDefinition } from "./definition";
import { claudeNativeCopyAdapter } from "./native-copy";
import {
  CLAUDE_ACQUISITION_ADAPTER_VERSION,
  claudeAcquisitionAdapter,
} from "./runtime-acquisition";
import { claudeSelectors } from "./selectors";

export class ClaudeStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = claudeNativeCopyAdapter;
  protected override readonly acquisitionAdapter = claudeAcquisitionAdapter;
  protected override readonly acquisitionAdapterVersion = CLAUDE_ACQUISITION_ADAPTER_VERSION;

  constructor() {
    super(claudeDefinition, claudeSelectors);
  }
}
