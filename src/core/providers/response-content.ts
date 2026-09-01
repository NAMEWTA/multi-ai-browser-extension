import TurndownService from "turndown";
// @ts-expect-error turndown-plugin-gfm does not ship TypeScript declarations
import { gfm } from "turndown-plugin-gfm";
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
  readonly text: string;
  readonly markdown: string;
}

export interface ResponseContentOptions {
  readonly roots: readonly string[];
  readonly content?: readonly string[];
  readonly exclude?: readonly string[];
  readonly getKey?: (element: HTMLElement, index: number) => string | undefined;
}

export function readResponseContent(
  document: Document,
  options: ResponseContentOptions,
): ResponseContentSnapshot[] {
  const roots = queryDistinctVisibleElements(document, options.roots);
  const occurrences = new Map<string, number>();
  return roots.map((element, index) => {
    const identity =
      options.getKey?.(element, index) ?? responseElementIdentity(element) ?? `index:${index}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const content = cloneResponseContent(element, options);
    return {
      element,
      key: occurrence ? `${identity}#${occurrence}` : identity,
      text: normalizeComposerValue(content.innerText ?? content.textContent ?? ""),
      markdown: responseContentToMarkdown(content),
    };
  });
}

export function responseElementToMarkdown(
  root: HTMLElement,
  options: Pick<ResponseContentOptions, "content" | "exclude"> = {},
): string {
  return responseContentToMarkdown(cloneResponseContent(root, options));
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
  options: Pick<ResponseContentOptions, "content" | "exclude">,
): HTMLElement {
  const content = queryContentElements(root, options.content);
  const wrapper = root.ownerDocument.createElement("div");
  for (const element of content) wrapper.append(element.cloneNode(true));
  removeExcludedContent(wrapper, options.exclude);
  return wrapper;
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
      if (
        selected.some(
          (existing) =>
            existing === candidate || existing.contains(candidate) || candidate.contains(existing),
        )
      ) {
        continue;
      }
      selected.push(candidate);
    }
  }
  return selected.toSorted(compareDocumentOrder);
}

function queryContentElements(
  root: HTMLElement,
  selectors: readonly string[] | undefined,
): HTMLElement[] {
  if (!selectors?.length) return [root];
  for (const selector of selectors) {
    const matches = [
      ...(root.matches(selector) ? [root] : []),
      ...root.querySelectorAll<HTMLElement>(selector),
    ].filter((element) => isElementVisible(element));
    if (matches.length)
      return matches.filter((element, index) => matches.indexOf(element) === index);
  }
  return [root];
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
