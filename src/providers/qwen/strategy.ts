import { BaseDomStrategy } from "../../core/providers/base-dom-strategy";
import type { ComposerCandidateDiagnostic, FrameContext } from "../../core/providers/contracts";
import {
  isElementUsable,
  isElementVisible,
  normalizeComposerValue,
  readComposerValue,
} from "../../core/providers/dom";
import { qwenDefinition } from "./definition";
import { qwenNativeCopyAdapter } from "./native-copy";
import { QWEN_ACQUISITION_ADAPTER_VERSION, qwenAcquisitionAdapter } from "./runtime-acquisition";
import { qwenSelectors } from "./selectors";

export class QwenStrategy extends BaseDomStrategy {
  protected override readonly nativeCopyAdapter = qwenNativeCopyAdapter;
  protected override readonly acquisitionAdapter = qwenAcquisitionAdapter;
  protected override readonly acquisitionAdapterVersion = QWEN_ACQUISITION_ADAPTER_VERSION;

  constructor() {
    super(qwenDefinition, qwenSelectors);
  }

  diagnoseComposerCandidates(ctx: FrameContext): readonly ComposerCandidateDiagnostic[] {
    const candidates = evaluateCandidates(ctx.document);
    const selected = selectCandidate(candidates)?.element;
    return candidates
      .toSorted((left, right) => right.diagnostic.score - left.diagnostic.score)
      .slice(0, 12)
      .map(({ element, diagnostic }) => ({
        ...diagnostic,
        selected: element === selected,
      }));
  }

  protected override findComposer(document: Document): HTMLElement | undefined {
    return selectCandidate(evaluateCandidates(document))?.element;
  }

  protected override responseKey(element: HTMLElement, index: number): string | undefined {
    const chatId = element.closest<HTMLElement>(".chat-round[data-chat]")?.dataset.chat?.trim();
    if (chatId) return `qwen-chat:${chatId}`;

    const answerId = element.getAttribute("data-chat-answers-wrap")?.trim();
    if (answerId) return `qwen-answer:${answerId}`;

    const responseId = element.closest<HTMLElement>("[id^='chat-response-message-']")?.id;
    return responseId ? `qwen-response:${responseId}` : super.responseKey(element, index);
  }

  protected override findBlocked(document: Document): HTMLElement | undefined {
    for (const selector of qwenSelectors.blocked) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (
          candidate instanceof HTMLElement &&
          isActiveVerification(candidate) &&
          isElementVisible(candidate)
        ) {
          return candidate;
        }
      }
    }
    return undefined;
  }
}

function isActiveVerification(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.opacity === "0" ||
      style?.pointerEvents === "none" ||
      (current !== current.ownerDocument.body &&
        current !== current.ownerDocument.documentElement &&
        (style?.width === "0px" || style?.height === "0px"))
    ) {
      return false;
    }
    current = current.parentElement;
  }

  if (element instanceof HTMLIFrameElement) return true;
  const interactive = element.querySelector(
    "iframe[src*='captcha' i], iframe[src*='verify' i], [role='slider'], .nc_scale, input, button",
  );
  if (!interactive) return false;
  const text = normalizeComposerValue(element.innerText ?? element.textContent ?? "");
  return (
    /验证|验证码|滑块|安全检查|异常访问|captcha|verification|verify/i.test(text) ||
    element.getAttribute("aria-modal") === "true" ||
    element.getAttribute("data-state") === "open" ||
    element.classList.contains("active") ||
    element.classList.contains("show")
  );
}

interface EvaluatedCandidate {
  readonly element: HTMLElement;
  readonly diagnostic: Omit<ComposerCandidateDiagnostic, "selected">;
}

function evaluateCandidates(document: Document): EvaluatedCandidate[] {
  const elements = new Set<HTMLElement>();
  for (const selector of qwenSelectors.composer) {
    for (const candidate of document.querySelectorAll(selector)) {
      if (candidate instanceof HTMLElement) elements.add(candidate);
    }
  }
  return [...elements].map((element) => evaluateCandidate(element));
}

function evaluateCandidate(element: HTMLElement): EvaluatedCandidate {
  const reason = rejectionReason(element);
  const eligible = reason === undefined;
  let score = 0;
  const selectorIndex = qwenSelectors.composer.findIndex((selector) => element.matches(selector));
  if (selectorIndex >= 0) score += (qwenSelectors.composer.length - selectorIndex) * 4;
  if (element.id === "chat-input") score += 240;
  if (element.classList.contains("message-input-textarea")) score += 240;
  if (element.getAttribute("data-slate-editor") === "true") score += 220;
  if (element.classList.contains("ProseMirror")) score += 180;
  if (element.isContentEditable || element.getAttribute("contenteditable") === "true") score += 100;
  if (element instanceof HTMLTextAreaElement) score += 90;
  if (element.getAttribute("role") === "textbox") score += 50;

  const hint = [
    element.getAttribute("placeholder"),
    element.getAttribute("data-placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
  ]
    .filter(Boolean)
    .join(" ");
  if (/千问|qwen|提问|输入|消息|问点|问我|ask|message|prompt|anything/i.test(hint)) score += 120;

  const submitDistance = nearestSubmitDistance(element);
  if (submitDistance <= 2) score += 160;
  else if (submitDistance <= 4) score += 80;
  else if (submitDistance <= 6) score += 30;
  if (!eligible) score -= 1_000;

  return {
    element,
    diagnostic: {
      descriptor: describeCandidate(element),
      score,
      normalizedLength: Math.min(
        normalizeComposerValue(readComposerValue(element)).length,
        100_000,
      ),
      eligible,
      ...(reason ? { reason } : {}),
    },
  };
}

function rejectionReason(element: HTMLElement): ComposerCandidateDiagnostic["reason"] | undefined {
  if (!isElementVisible(element)) return "hidden";
  if (!isElementUsable(element)) return "disabled";
  if (
    (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) &&
    element.readOnly
  ) {
    return "readonly";
  }
  if (element.getAttribute("aria-readonly") === "true") return "readonly";
  const hint = `${element.getAttribute("placeholder") ?? ""} ${element.getAttribute("aria-label") ?? ""}`;
  const hasStrongChatSemantics =
    element.id === "chat-input" ||
    element.getAttribute("data-slate-editor") === "true" ||
    ((element.isContentEditable || element.getAttribute("contenteditable") === "true") &&
      element.getAttribute("role") === "textbox") ||
    nearestSubmitDistance(element) <= 2;
  if (
    element.getAttribute("role") === "searchbox" ||
    element.closest("[role='search']") ||
    (/搜索|search|find/i.test(hint) && !hasStrongChatSemantics)
  ) {
    return "search";
  }
  if (
    !(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) &&
    !element.isContentEditable &&
    element.getAttribute("contenteditable") !== "true"
  ) {
    return "not-editable";
  }
  return undefined;
}

function selectCandidate(
  candidates: readonly EvaluatedCandidate[],
): EvaluatedCandidate | undefined {
  return candidates
    .filter(({ diagnostic }) => diagnostic.eligible)
    .toSorted((left, right) => right.diagnostic.score - left.diagnostic.score)[0];
}

function nearestSubmitDistance(element: HTMLElement): number {
  const submits = new Set<HTMLElement>();
  for (const selector of qwenSelectors.submit) {
    for (const candidate of element.ownerDocument.querySelectorAll(selector)) {
      if (candidate instanceof HTMLElement && isElementVisible(candidate)) submits.add(candidate);
    }
  }
  return Math.min(...[...submits].map((submit) => treeDistance(element, submit)), Infinity);
}

function treeDistance(left: Element, right: Element): number {
  const leftAncestors = new Map<Element, number>();
  let current: Element | null = left;
  let distance = 0;
  while (current) {
    leftAncestors.set(current, distance++);
    current = current.parentElement;
  }
  current = right;
  distance = 0;
  while (current) {
    const leftDistance = leftAncestors.get(current);
    if (leftDistance !== undefined) return leftDistance + distance;
    current = current.parentElement;
    distance += 1;
  }
  return Number.MAX_SAFE_INTEGER;
}

function describeCandidate(element: HTMLElement): string {
  const traits = [
    element.id === "chat-input" ? "#chat-input" : "",
    element.getAttribute("role") === "textbox" ? "[role=textbox]" : "",
    element.getAttribute("data-slate-editor") === "true" ? "[data-slate-editor]" : "",
    element.isContentEditable || element.getAttribute("contenteditable") === "true"
      ? "[contenteditable]"
      : "",
    element.classList.contains("ProseMirror") ? ".ProseMirror" : "",
  ].filter(Boolean);
  return `${element.tagName.toLowerCase()}${traits.join("")}`;
}
