import { ProviderError } from "./errors";

export function isElementUsable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  if ("disabled" in element && Boolean(element.disabled)) return false;
  return true;
}

export function findFirstUsable(
  document: Document,
  selectors: readonly string[],
  anchor?: HTMLElement,
): HTMLElement | undefined {
  for (const selector of selectors) {
    const candidates = [...document.querySelectorAll(selector)].filter(isElementUsable);
    if (!candidates.length) continue;
    if (!anchor) return candidates[0];
    return candidates.toSorted(
      (left, right) => domDistance(anchor, left) - domDistance(anchor, right),
    )[0];
  }
  return undefined;
}

export async function waitForElement(
  document: Document,
  selectors: readonly string[],
  options: {
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
    anchor?: HTMLElement | undefined;
  } = {},
): Promise<HTMLElement> {
  const existing = findFirstUsable(document, selectors, options.anchor);
  if (existing) return existing;

  const timeoutMs = options.timeoutMs ?? 15_000;
  return await new Promise<HTMLElement>((resolve, reject) => {
    const abort = () => finish(new ProviderError("ABORTED", "页面元素等待已取消"));
    const observer = new MutationObserver(() => {
      const element = findFirstUsable(document, selectors, options.anchor);
      if (element) finish(undefined, element);
    });
    const timeout = window.setTimeout(
      () => finish(new ProviderError("TIMEOUT", `等待页面元素超时（${timeoutMs}ms）`)),
      timeoutMs,
    );

    function finish(error?: Error, value?: HTMLElement) {
      observer.disconnect();
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (value) resolve(value);
    }

    options.signal?.addEventListener("abort", abort, { once: true });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

function domDistance(anchor: Element, candidate: Element): number {
  const anchorAncestors = new Map<Element, number>();
  let current: Element | null = anchor;
  let distance = 0;
  while (current) {
    anchorAncestors.set(current, distance++);
    current = current.parentElement;
  }

  current = candidate;
  distance = 0;
  while (current) {
    const anchorDistance = anchorAncestors.get(current);
    if (anchorDistance !== undefined) return anchorDistance + distance;
    current = current.parentElement;
    distance += 1;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function readComposerValue(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  return element.textContent ?? "";
}

export function dispatchInputEvents(element: HTMLElement, text: string): void {
  const inputEvent = new InputEvent("input", {
    bubbles: true,
    composed: true,
    data: text,
    inputType: "insertText",
  });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}
