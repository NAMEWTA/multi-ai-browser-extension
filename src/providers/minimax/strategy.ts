import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { minimaxDefinition } from "./definition";
import { minimaxNativeCopyAdapter } from "./native-copy";
import { minimaxSelectors } from "./selectors";

export class MiniMaxStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = minimaxNativeCopyAdapter;

  constructor() {
    super(minimaxDefinition, minimaxSelectors);
  }
}
