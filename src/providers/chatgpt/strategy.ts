import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { chatgptDefinition } from "./definition";
import { chatgptNativeCopyAdapter } from "./native-copy";
import {
  CHATGPT_ACQUISITION_ADAPTER_VERSION,
  chatGptAcquisitionAdapter,
} from "./runtime-acquisition";
import { chatgptSelectors } from "./selectors";

export class ChatGptStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = chatgptNativeCopyAdapter;
  protected override readonly acquisitionAdapter = chatGptAcquisitionAdapter;
  protected override readonly acquisitionAdapterVersion = CHATGPT_ACQUISITION_ADAPTER_VERSION;

  constructor() {
    super(chatgptDefinition, chatgptSelectors);
  }
}
