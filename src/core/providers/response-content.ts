import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm does not ship TypeScript declarations
import { gfm } from "turndown-plugin-gfm";
import type { ResponseSelectorTier } from "./contracts";
import { isElementVisible, normalizeComposerValue } from "./dom";

const DEFAULT_EXCLUDE_SELECTORS = [
  "button",
  "input",
  "textarea",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "[hidden]",
  "[aria-hidden='true']",
  "[role='menu']",
  "[aria-label='Copy']",
  "[aria-label*='复制']",
  ".copy-button",
] as const;

const DEFAULT_KEY_ATTRIBUTES = [
  "data-chat",
  "data-chat-answers-wrap",
  "data-message-id",
  "data-response-id",
  "data-testid",
] as const;

export interface ResponseContentSnapshot {
  readonly element: HTMLElement;
  readonly key: string;
  readonly candidateId: string;
  readonly tierId: string;
  readonly tierIndex: number;
  readonly source: "final-container" | "block-union" | "turn-fallback";
  readonly blockCount: number;
  readonly quality: number;
  readonly hasFinalContainer: boolean;
  readonly statusOnly: boolean;
  readonly text: string;
  readonly markdown: string;
}

export interface ResponseContentOptions {
  readonly roots: readonly string[];
  readonly tiers?: readonly ResponseSelectorTier[];
  readonly content?: readonly string[];
  readonly finalContainers?: readonly string[];
  readonly contentBlocks?: readonly string[];
  readonly exclude?: readonly string[];
  readonly statusOnly?: readonly string[];
  readonly getKey?: (element: HTMLElement, index: number) => string | undefined;
}

export function readResponseContent(
  document: Document,
  options: ResponseContentOptions,
): ResponseContentSnapshot[] {
  const discovered = discoverResponseRoots(document, options);
  const occurrences = new Map<string, number>();
  return discovered.elements.map((element, index) => {
    const identity =
      options.getKey?.(element, index) ?? responseElementIdentity(element) ?? `index:${index}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const candidate = cloneResponseContent(element, options);
    const text = normalizeComposerValue(
      candidate.content.innerText ?? candidate.content.textContent ?? "",
    );
    return {
      element,
      key: occurrence ? `${identity}#${occurrence}` : identity,
      candidateId: `${discovered.tier.id}:${candidate.source}`,
      tierId: discovered.tier.id,
      tierIndex: discovered.tierIndex,
      source: candidate.source,
      blockCount: candidate.blockCount,
      quality: candidateQuality(discovered.tier, discovered.tierIndex, candidate, text),
      hasFinalContainer: candidate.source === "final-container",
      statusOnly: !text,
      text,
      markdown: responseContentToMarkdown(candidate.content),
    };
  });
}

export function responseElementToMarkdown(
  root: HTMLElement,
  options: Pick<
    ResponseContentOptions,
    "content" | "finalContainers" | "contentBlocks" | "exclude" | "statusOnly"
  > = {},
): string {
  return responseContentToMarkdown(cloneResponseContent(root, options).content);
}

export function responseElementToText(
  root: HTMLElement,
  options: Pick<
    ResponseContentOptions,
    "content" | "finalContainers" | "contentBlocks" | "exclude" | "statusOnly"
  > = {},
): string {
  const content = cloneResponseContent(root, options).content;
  return normalizeComposerValue(content.innerText ?? content.textContent ?? "");
}

export function responseHtmlToMarkdown(html: string, document: Document): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  removeExcludedContent(container, []);
  return responseContentToMarkdown(container);
}

function responseContentToMarkdown(content: HTMLElement): string {
  try {
    return normalizeMarkdown(createTurndownService().turndown(content));
  } catch {
    return normalizeComposerValue(content.innerText ?? content.textContent ?? "");
  }
}

function cloneResponseContent(
  root: HTMLElement,
  options: Pick<
    ResponseContentOptions,
    "content" | "finalContainers" | "contentBlocks" | "exclude" | "statusOnly"
  >,
): {
  content: HTMLElement;
  source: ResponseContentSnapshot["source"];
  blockCount: number;
} {
  const finalContainers = queryContentElements(root, options.finalContainers, false);
  const blockSelectors = options.contentBlocks ?? options.content;
  const blocks = finalContainers.length
    ? finalContainers
    : queryContentElements(root, blockSelectors, false);
  const content = blocks.length ? blocks : [root];
  const wrapper = root.ownerDocument.createElement("div");
  for (const element of content) wrapper.append(element.cloneNode(true));
  removeExcludedContent(wrapper, [...(options.exclude ?? []), ...(options.statusOnly ?? [])]);
  return {
    content: wrapper,
    source: finalContainers.length
      ? "final-container"
      : blocks.length
        ? "block-union"
        : "turn-fallback",
    blockCount: content.length,
  };
}

function createTurndownService() {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  service.use(gfm);
  return service;
}

function queryDistinctVisibleElements(
  document: Document,
  selectors: readonly string[],
): HTMLElement[] {
  const selected: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const candidate of document.querySelectorAll(selector)) {
      if (!(candidate instanceof HTMLElement) || !isElementVisible(candidate)) continue;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
  }
  return selected
    .filter(
      (element) =>
        !selected.some((candidate) => candidate !== element && candidate.contains(element)),
    )
    .toSorted(compareDocumentOrder);
}

function queryContentElements(
  root: HTMLElement,
  selectors: readonly string[] | undefined,
  fallbackToRoot = true,
): HTMLElement[] {
  if (!selectors?.length) return fallbackToRoot ? [root] : [];
  const matches: HTMLElement[] = [];
  for (const selector of selectors) {
    const selectorMatches = [
      ...(root.matches(selector) ? [root] : []),
      ...root.querySelectorAll<HTMLElement>(selector),
    ].filter((element) => isElementVisible(element));
    for (const element of selectorMatches) {
      if (!matches.includes(element)) matches.push(element);
    }
  }
  if (!matches.length) return fallbackToRoot ? [root] : [];
  return matches
    .filter(
      (element) =>
        !matches.some((candidate) => candidate !== element && candidate.contains(element)),
    )
    .toSorted(compareDocumentOrder);
}

function discoverResponseRoots(
  document: Document,
  options: Pick<ResponseContentOptions, "roots" | "tiers">,
): { elements: HTMLElement[]; tier: ResponseSelectorTier; tierIndex: number } {
  const tiers = options.tiers?.length
    ? options.tiers
    : [{ id: "legacy", confidence: "fallback" as const, selectors: options.roots }];
  for (const [tierIndex, tier] of tiers.entries()) {
    const elements = queryDistinctVisibleElements(document, tier.selectors);
    if (elements.length) return { elements, tier, tierIndex };
  }
  return { elements: [], tier: tiers[0]!, tierIndex: 0 };
}

function candidateQuality(
  tier: ResponseSelectorTier,
  tierIndex: number,
  candidate: Pick<ResponseContentSnapshot, "source" | "blockCount">,
  text: string,
): number {
  const confidence = { canonical: 3, semantic: 2, fallback: 1 }[tier.confidence];
  const source = { "final-container": 3, "block-union": 2, "turn-fallback": 1 }[candidate.source];
  return (
    confidence * 1_000_000 +
    source * 100_000 -
    tierIndex * 1_000 +
    Math.min(candidate.blockCount, 99) * 100 +
    Math.min(text.length, 99)
  );
}

function responseElementIdentity(element: HTMLElement): string | undefined {
  for (const attribute of DEFAULT_KEY_ATTRIBUTES) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) return `${attribute}:${value}`;
  }
  if (element.id) return `id:${element.id}`;
  const round = element.closest<HTMLElement>("[data-chat]");
  const chatId = round?.getAttribute("data-chat")?.trim();
  return chatId ? `data-chat:${chatId}` : undefined;
}

function removeExcludedContent(root: HTMLElement, excludes: readonly string[] | undefined): void {
  for (const selector of [...DEFAULT_EXCLUDE_SELECTORS, ...(excludes ?? [])]) {
    root.querySelectorAll(selector).forEach((element) => element.remove());
  }
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function compareDocumentOrder(left: Element, right: Element): number {
  const position = left.compareDocumentPosition(right);
  return position & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : position & Node.DOCUMENT_POSITION_PRECEDING
      ? 1
      : 0;
}
