import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { cozeDefinition } from "./definition";
import { cozeNativeCopyAdapter } from "./native-copy";
import { cozeSelectors } from "./selectors";

export class CozeStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = cozeNativeCopyAdapter;

  constructor() {
    super(cozeDefinition, cozeSelectors);
  }
}
