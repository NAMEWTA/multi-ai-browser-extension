import { ProviderError } from "./errors";

export function isElementUsable(element: Element): element is HTMLElement {
  if (!isElementVisible(element)) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.classList.contains("disabled")) return false;
  if ("disabled" in element && Boolean(element.disabled)) return false;
  return true;
}

export function isElementVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const elementStyle = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (elementStyle?.display === "none" || elementStyle?.visibility === "hidden") return false;
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    if (current.hidden) return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === "none") return false;
    current = current.parentElement;
  }
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

export function findAllUsable(document: Document, selectors: readonly string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const elements: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const candidate of document.querySelectorAll(selector)) {
      if (!isElementUsable(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      elements.push(candidate);
    }
  }
  return elements.toSorted((left, right) => {
    const position = left.compareDocumentPosition(right);
    return position & Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : position & Node.DOCUMENT_POSITION_PRECEDING
        ? 1
        : 0;
  });
}

export function findUsableByText(
  document: Document,
  labels: readonly string[],
): HTMLElement | undefined {
  const normalizedLabels = labels.map((label) => normalizeComposerValue(label).toLocaleLowerCase());
  const candidates = document.querySelectorAll("button, a, [role='button']");
  for (const candidate of candidates) {
    if (!isElementUsable(candidate)) continue;
    const text = normalizeComposerValue(candidate.textContent ?? "").toLocaleLowerCase();
    const accessibleName = normalizeComposerValue(
      `${candidate.getAttribute("aria-label") ?? ""} ${candidate.getAttribute("title") ?? ""}`,
    ).toLocaleLowerCase();
    if (normalizedLabels.some((label) => text === label || accessibleName.includes(label)))
      return candidate;
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
  return await waitForResolvedElement(
    document,
    () => findFirstUsable(document, selectors, options.anchor),
    options,
  );
}

export async function waitForResolvedElement(
  document: Document,
  resolveElement: () => HTMLElement | undefined,
  options: {
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
  } = {},
): Promise<HTMLElement> {
  const existing = resolveElement();
  if (existing) return existing;

  const timeoutMs = options.timeoutMs ?? 15_000;
  return await new Promise<HTMLElement>((resolve, reject) => {
    const abort = () => finish(new ProviderError("ABORTED", "页面元素等待已取消"));
    const observer = new MutationObserver(() => {
      const element = resolveElement();
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
  const clone = element.cloneNode(true) as HTMLElement;
  for (const placeholder of clone.querySelectorAll(
    "[data-placeholder], [data-slate-placeholder], [data-slate-zero-width], [class*='placeholder' i]",
  )) {
    placeholder.remove();
  }
  return clone.textContent ?? "";
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

export async function waitForCondition(
  check: () => boolean,
  options: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const startedAt = Date.now();
  while (!check()) {
    if (options.signal?.aborted) throw new ProviderError("ABORTED", "页面操作已取消");
    if (Date.now() - startedAt >= timeoutMs) {
      throw new ProviderError("TIMEOUT", `等待页面状态更新超时（${timeoutMs}ms）`);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

export function normalizeComposerValue(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}
