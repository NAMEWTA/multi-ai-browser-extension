import type { NativeCopyAdapter } from "../../core/providers/contracts";
import { doubaoNativeCopySelectors } from "./selectors";

export const doubaoNativeCopyAdapter: NativeCopyAdapter = {
  id: "doubao-native-copy",

  locateCopyButton(_ctx, response) {
    const turn = closestMatching(response, doubaoNativeCopySelectors.turn) ?? response;
    return findScopedCopyButton(turn);
  },

  async prepareCopy(_ctx, response, button) {
    const turn = closestMatching(response, doubaoNativeCopySelectors.turn) ?? response;
    for (const type of ["pointerover", "mouseover", "mouseenter"] as const) {
      turn.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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
  const adjacent = [turn.previousElementSibling, turn.nextElementSibling].filter(
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
