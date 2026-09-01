import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { chatgptDefinition } from "./definition";
import { chatgptNativeCopyAdapter } from "./native-copy";
import { chatgptSelectors } from "./selectors";

export class ChatGptStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = chatgptNativeCopyAdapter;

  constructor() {
    super(chatgptDefinition, chatgptSelectors);
  }
}
