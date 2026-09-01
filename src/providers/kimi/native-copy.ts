import type { FrameContext, NativeCopyAdapter } from "../../core/providers/contracts";
import { isElementVisible, normalizeComposerValue } from "../../core/providers/dom";
import { kimiNativeCopySelectors, kimiSelectors } from "./selectors";

const anonymousTurnKeys = new WeakMap<HTMLElement, string>();
let nextAnonymousTurnKey = 1;

export const kimiNativeCopyAdapter: NativeCopyAdapter = {
  id: "kimi-native-copy",
  capturePolicy: { maxAttempts: 3, requireDomEndingAnchor: false },

  locateCopyButton(_ctx, response) {
    const turn = closestMatching(response, kimiNativeCopySelectors.turn) ?? response;
    return findCopyButton(turn);
  },

  listTargets(ctx) {
    return listAssistantTurns(ctx).flatMap((response) => {
      const button = findCopyButton(response);
      return button ? [{ key: turnKey(response), response, button }] : [];
    });
  },

  selectTarget(ctx, targets, { prompt }) {
    if (targets.length === 1) return targets[0];
    const normalizedPrompt = normalizeComposerValue(prompt ?? "");
    if (!normalizedPrompt) return targets.at(-1);
    const users = queryAll(ctx.document, kimiNativeCopySelectors.userTurn).filter(
      (node) =>
        isElementVisible(node) &&
        normalizeComposerValue(node.innerText || node.textContent || "") === normalizedPrompt,
    );
    const user = users.at(-1);
    if (!user) return targets.at(-1);
    return targets.toSorted(
      (left, right) =>
        documentDistance(user, left.response) - documentDistance(user, right.response),
    )[0];
  },

  isTerminalTarget(ctx, target) {
    dispatchHover(target.response);
    return (
      this.isReady?.(ctx, target.response, target.button) !== false &&
      !hasVisible(ctx.document, kimiSelectors.generating ?? [])
    );
  },

  async prepareCopy(_ctx, response) {
    dispatchHover(closestMatching(response, kimiNativeCopySelectors.turn) ?? response);
    await Promise.resolve();
  },

  isReady(_ctx, response, button) {
    const turn = closestMatching(response, kimiNativeCopySelectors.turn) ?? response;
    return (
      button.isConnected &&
      turn.contains(button) &&
      !button.matches(":disabled") &&
      button.getAttribute("aria-disabled") !== "true"
    );
  },
};

function listAssistantTurns(ctx: FrameContext): HTMLElement[] {
  const candidates = queryAll(ctx.document, kimiNativeCopySelectors.turn).filter(isElementVisible);
  return candidates.filter(
    (turn) => !candidates.some((candidate) => candidate !== turn && candidate.contains(turn)),
  );
}

function findCopyButton(turn: HTMLElement): HTMLElement | undefined {
  for (const button of queryAll(turn, kimiNativeCopySelectors.copy)) {
    if (button.closest("pre, code, [class*='code-block' i], [data-testid*='code' i]")) continue;
    const owner = closestMatching(button, kimiNativeCopySelectors.turn);
    if (owner && owner !== turn && !turn.contains(owner)) continue;
    return button;
  }
  return undefined;
}

function turnKey(turn: HTMLElement): string {
  for (const attribute of ["data-message-id", "data-msg-id", "data-id", "data-key"]) {
    const value = turn.getAttribute(attribute)?.trim();
    if (value) return `kimi-copy:${value}`;
  }
  const existing = anonymousTurnKeys.get(turn);
  if (existing) return existing;
  const key = `kimi-copy-node:${nextAnonymousTurnKey++}`;
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

function documentDistance(left: Element, right: Element): number {
  const elements = [...left.ownerDocument.querySelectorAll("*")];
  return Math.abs(elements.indexOf(left) - elements.indexOf(right));
}
