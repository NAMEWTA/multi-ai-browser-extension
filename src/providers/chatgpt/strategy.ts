import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import { chatgptDefinition } from "./definition";
import { chatgptSelectors } from "./selectors";

export class ChatGptStrategy extends BaseDomStrategy {
  constructor() {
    super(chatgptDefinition, chatgptSelectors);
  }
}
