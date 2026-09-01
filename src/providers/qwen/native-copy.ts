import type { FrameContext, NativeCopyAdapter } from "../../core/providers/contracts";
import { isElementVisible } from "../../core/providers/dom";
import { qwenNativeCopySelectors, qwenSelectors } from "./selectors";

const ASSISTANT_CONTENT_SELECTORS = [
  ".answer-text.md-text-card",
  ".qk-markdown",
  ".response-message-content.phase-answer",
  ".markdown-body",
  "[class*='answer-content']",
] as const;
const anonymousTurnKeys = new WeakMap<HTMLElement, string>();
let nextAnonymousTurnKey = 1;

export const qwenNativeCopyAdapter: NativeCopyAdapter = {
  id: "qwen-native-copy",
  capturePolicy: { maxAttempts: 3, requireDomEndingAnchor: true, terminalStableMs: 1_500 },

  locateCopyButton(_ctx, response) {
    const turn = closestMatching(response, qwenNativeCopySelectors.turn) ?? response;
    return findCopyButton(turn);
  },

  listTargets(ctx) {
    return listAssistantTurns(ctx).flatMap((response) => {
      const button = findCopyButton(response);
      return button ? [{ key: turnKey(response), response, button }] : [];
    });
  },

  isTerminalTarget(ctx, target) {
    dispatchHover(target.response);
    return (
      this.isReady?.(ctx, target.response, target.button) !== false &&
      !hasVisible(ctx.document, qwenSelectors.generating ?? [])
    );
  },

  async prepareCopy(_ctx, response) {
    dispatchHover(closestMatching(response, qwenNativeCopySelectors.turn) ?? response);
    await Promise.resolve();
  },

  isReady(_ctx, response, button) {
    const turn = closestMatching(response, qwenNativeCopySelectors.turn) ?? response;
    return (
      button.isConnected &&
      turn.contains(button) &&
      !button.matches(":disabled") &&
      button.getAttribute("aria-disabled") !== "true"
    );
  },
};

function listAssistantTurns(ctx: FrameContext): HTMLElement[] {
  const candidates = queryAll(ctx.document, qwenNativeCopySelectors.turn).filter(
    (turn) => isElementVisible(turn) && matchesOrContains(turn, ASSISTANT_CONTENT_SELECTORS),
  );
  return candidates.filter(
    (turn) => !candidates.some((candidate) => candidate !== turn && candidate.contains(turn)),
  );
}

function findCopyButton(turn: HTMLElement): HTMLElement | undefined {
  const scopes = [turn, ...queryAll(turn, qwenNativeCopySelectors.action)];
  for (const scope of scopes) {
    for (const button of queryAll(scope, qwenNativeCopySelectors.copy)) {
      if (button.closest("pre, code, [class*='code-block' i], [data-testid*='code' i]")) continue;
      const owner = closestMatching(button, qwenNativeCopySelectors.turn);
      if (owner && owner !== turn && !turn.contains(owner)) continue;
      return button;
    }
  }
  return undefined;
}

function turnKey(turn: HTMLElement): string {
  const round = turn.matches(".chat-round[data-chat]")
    ? turn
    : turn.closest<HTMLElement>(".chat-round[data-chat]");
  const chatId = round?.dataset.chat?.trim();
  if (chatId) return `qwen-copy-chat:${chatId}`;

  for (const attribute of ["data-chat-answers-wrap", "data-message-id", "data-id"]) {
    const value = turn.getAttribute(attribute)?.trim();
    if (value) return `qwen-copy:${value}`;
  }
  if (turn.id.startsWith("chat-response-message-")) return `qwen-copy:${turn.id}`;
  const existing = anonymousTurnKeys.get(turn);
  if (existing) return existing;
  const key = `qwen-copy-node:${nextAnonymousTurnKey++}`;
  anonymousTurnKeys.set(turn, key);
  return key;
}

function dispatchHover(target: HTMLElement): void {
  const options = { bubbles: true, cancelable: true, composed: true };
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
    target.dispatchEvent(new MouseEvent(type, options));
  }
}

function hasVisible(document: Document, selectors: readonly string[]): boolean {
  return queryAll(document, selectors).some(isElementVisible);
}

function matchesOrContains(root: HTMLElement, selectors: readonly string[]): boolean {
  return selectors.some(
    (selector) => root.matches(selector) || Boolean(root.querySelector(selector)),
  );
}

function closestMatching(
  element: HTMLElement,
  selectors: readonly string[],
): HTMLElement | undefined {
  for (const selector of selectors) {
    const closest = element.closest<HTMLElement>(selector);
    if (closest) return closest;
  }
  return undefined;
}

function queryAll(root: ParentNode, selectors: readonly string[]): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (!result.includes(element)) result.push(element);
    }
  }
  return result.toSorted((left, right) => {
    const position = left.compareDocumentPosition(right);
    return position & Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : position & Node.DOCUMENT_POSITION_PRECEDING
        ? 1
        : 0;
  });
}
