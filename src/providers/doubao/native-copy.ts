import type {
  FrameContext,
  NativeCopyAdapter,
  NativeCopyTarget,
} from "../../core/providers/contracts";
import { isElementVisible, normalizeComposerValue } from "../../core/providers/dom";
import { doubaoNativeCopySelectors, doubaoSelectors } from "./selectors";

const ASSISTANT_CONTENT_SELECTORS = [
  ".flow-markdown-body",
  ".md-box-root",
  "[class*='md-box-root']",
  "[data-testid='message_text_content']",
] as const;
const USER_CONTENT_SELECTORS = [
  "[class*='bg-g-send-msg-bubble']",
  "[class*='text-g-send-msg-bubble']",
  "[class*='send-msg-bubble']",
] as const;
const anonymousTurnKeys = new WeakMap<HTMLElement, string>();
let nextAnonymousTurnKey = 1;

export const doubaoNativeCopyAdapter: NativeCopyAdapter = {
  id: "doubao-native-copy",
  capturePolicy: { maxAttempts: 3, requireDomEndingAnchor: true, terminalStableMs: 3_000 },

  locateCopyButton(_ctx, response) {
    const turn = closestMatching(response, doubaoNativeCopySelectors.turn) ?? response;
    return findScopedCopyButton(turn);
  },

  listTargets(ctx) {
    return listAssistantTurns(ctx).flatMap((response) => {
      const button = findScopedCopyButton(response);
      return button ? [{ key: turnKey(response), response, button }] : [];
    });
  },

  selectTarget(ctx, targets, { prompt }) {
    return selectTargetNearPrompt(ctx, targets, prompt);
  },

  isTerminalTarget(ctx, target) {
    dispatchHover(target.response);
    return (
      this.isReady?.(ctx, target.response, target.button) !== false &&
      !hasVisible(ctx.document, doubaoSelectors.generating ?? [])
    );
  },

  async prepareCopy(_ctx, response) {
    const turn = closestMatching(response, doubaoNativeCopySelectors.turn) ?? response;
    dispatchHover(turn);
    await Promise.resolve();
  },

  isReady(_ctx, _response, button) {
    return (
      button.isConnected &&
      !button.matches(":disabled") &&
      button.getAttribute("aria-disabled") !== "true"
    );
  },
};

function findScopedCopyButton(turn: HTMLElement): HTMLElement | undefined {
  const adjacent = [turn.nextElementSibling].filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const scopes = [
    turn,
    ...queryAll(turn, doubaoNativeCopySelectors.action),
    ...adjacent.flatMap((element) => [
      ...(matchesAny(element, doubaoNativeCopySelectors.action) ? [element] : []),
      ...queryAll(element, doubaoNativeCopySelectors.action),
    ]),
  ];
  for (const scope of scopes) {
    for (const button of queryAll(scope, doubaoNativeCopySelectors.copy)) {
      if (button.closest("pre, code, [class*='code-block' i], [data-testid*='code' i]")) continue;
      const owner = closestMatching(button, doubaoNativeCopySelectors.turn);
      if (owner && owner !== turn && !turn.contains(owner)) continue;
      return button;
    }
  }
  return undefined;
}

function listAssistantTurns(ctx: FrameContext): HTMLElement[] {
  const candidates = queryAll(ctx.document, doubaoNativeCopySelectors.turn).filter(
    (turn) =>
      isElementVisible(turn) &&
      matchesOrContains(turn, ASSISTANT_CONTENT_SELECTORS) &&
      !matchesOrContains(turn, USER_CONTENT_SELECTORS),
  );
  return candidates.filter(
    (turn) => !candidates.some((candidate) => candidate !== turn && candidate.contains(turn)),
  );
}

function selectTargetNearPrompt(
  ctx: FrameContext,
  targets: readonly NativeCopyTarget[],
  prompt: string | undefined,
): NativeCopyTarget | undefined {
  if (targets.length === 1) return targets[0];
  const normalizedPrompt = normalizeComposerValue(prompt ?? "");
  if (!normalizedPrompt) return targets.at(-1);
  const userNodes = queryAll(ctx.document, USER_CONTENT_SELECTORS).filter(
    (node) =>
      isElementVisible(node) &&
      normalizeComposerValue(node.innerText || node.textContent || "") === normalizedPrompt,
  );
  const user = userNodes.at(-1);
  if (!user) return targets.at(-1);
  return targets.toSorted(
    (left, right) => documentDistance(user, left.response) - documentDistance(user, right.response),
  )[0];
}

function turnKey(turn: HTMLElement): string {
  const identity = turn.matches(
    "[data-message-id], [data-local-message-id], [data-msg-id], [data-id]",
  )
    ? turn
    : turn.querySelector<HTMLElement>(
        "[data-message-id], [data-local-message-id], [data-msg-id], [data-id]",
      );
  for (const attribute of ["data-message-id", "data-local-message-id", "data-msg-id", "data-id"]) {
    const value = identity?.getAttribute(attribute)?.trim();
    if (value) return `doubao-copy:${value}`;
  }
  const existing = anonymousTurnKeys.get(turn);
  if (existing) return existing;
  const key = `doubao-copy-node:${nextAnonymousTurnKey++}`;
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

function documentDistance(left: Element, right: Element): number {
  const elements = [...left.ownerDocument.querySelectorAll("*")];
  return Math.abs(elements.indexOf(left) - elements.indexOf(right));
}

function matchesAny(element: HTMLElement, selectors: readonly string[]): boolean {
  return selectors.some((selector) => element.matches(selector));
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
  return result;
}
