import { ProviderError } from "../errors";

export class ButtonSubmitter {
  submit(element: HTMLElement): void {
    if (
      ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.disabled) ||
      element.getAttribute("aria-disabled") === "true" ||
      element.classList.contains("disabled")
    ) {
      throw new ProviderError("SUBMIT_DISABLED", "发送按钮当前不可用");
    }
    element.focus();
    element.click();
  }
}
