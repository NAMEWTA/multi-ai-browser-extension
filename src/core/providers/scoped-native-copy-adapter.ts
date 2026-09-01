import type { FrameContext, NativeCopyAdapter, NativeCopyTarget } from "./contracts";
import { isElementVisible, normalizeComposerValue } from "./dom";

export interface ScopedNativeCopyAdapterConfig {
  readonly id: string;
  readonly turnSelectors: readonly string[];
  readonly assistantSelectors: readonly string[];
  readonly userSelectors: readonly string[];
  readonly actionSelectors: readonly string[];
  readonly copySelectors: readonly string[];
  readonly generatingSelectors: readonly string[];
  readonly keyAttributes?: readonly string[];
  readonly maxAncestorLevels?: number;
  readonly terminalStableMs?: number;
}

const CODE_CONTROL_ANCESTOR = [
  "pre",
  "code",
  "[data-code-block]",
  "[class*='code-block' i]",
  "[data-testid*='code' i]",
].join(",");

export function createScopedNativeCopyAdapter(
  config: ScopedNativeCopyAdapterConfig,
): NativeCopyAdapter {
  const anonymousKeys = new WeakMap<HTMLElement, string>();
  let nextAnonymousKey = 1;

  const locateCopyButton = (_ctx: FrameContext, response: HTMLElement): HTMLElement | undefined =>
    findCopyBinding(response, config)?.button;

  return {
    id: config.id,
    capturePolicy: {
      maxAttempts: 3,
      requireDomEndingAnchor: true,
      terminalStableMs: config.terminalStableMs ?? 1_500,
    },

    locateCopyButton,

    listTargets(ctx) {
      const result: NativeCopyTarget[] = [];
      for (const anchor of listAssistantAnchors(ctx.document, config)) {
        dispatchHover(anchor);
        const binding = findCopyBinding(anchor, config);
        if (!binding || result.some((target) => target.response === binding.response)) continue;
        result.push({
          key: targetKey(binding.response, config, anonymousKeys, () => nextAnonymousKey++),
          response: binding.response,
          button: binding.button,
        });
      }
      return result;
    },

    selectTarget(ctx, targets, { prompt }) {
      return selectTargetAfterPrompt(ctx, targets, prompt, config.userSelectors);
    },

    isTerminalTarget(ctx, target) {
      dispatchHover(target.response);
      return (
        isCopyReady(target.response, target.button) &&
        !queryAll(ctx.document, config.generatingSelectors).some(isElementVisible)
      );
    },

    async prepareCopy(_ctx, response, button) {
      dispatchHover(response);
      const action = button ? closestMatching(button, config.actionSelectors) : undefined;
      if (action && action !== response) dispatchHover(action);
      await Promise.resolve();
    },

    isReady(_ctx, response, button) {
      return isCopyReady(response, button);
    },
  };
}

function listAssistantAnchors(
  document: Document,
  config: ScopedNativeCopyAdapterConfig,
): HTMLElement[] {
  const turns = queryAll(document, config.turnSelectors).filter(
    (turn) => isElementVisible(turn) && matchesOrContains(turn, config.assistantSelectors),
  );
  const anchors = turns.length
    ? turns
    : queryAll(document, config.assistantSelectors).filter(isElementVisible);
  return anchors.filter(
    (anchor) => !anchors.some((candidate) => candidate !== anchor && candidate.contains(anchor)),
  );
}

function findCopyBinding(
  anchor: HTMLElement,
  config: ScopedNativeCopyAdapterConfig,
): { response: HTMLElement; button: HTMLElement } | undefined {
  let scope: HTMLElement | null = findTurn(anchor, config.turnSelectors);
  const maxLevels = Math.max(0, Math.min(config.maxAncestorLevels ?? 0, 8));
  for (let level = 0; scope && level <= maxLevels; level += 1) {
    dispatchHover(scope);
    const button = findCopyButton(scope, config);
    if (button) return { response: scope, button };
    const parentElement: HTMLElement | null = scope.parentElement;
    if (!parentElement || parentElement === scope.ownerDocument.body) break;
    if (countAssistantAnchors(parentElement, config.assistantSelectors) > 1) break;
    scope = parentElement;
  }
  return undefined;
}

function findCopyButton(
  response: HTMLElement,
  config: ScopedNativeCopyAdapterConfig,
): HTMLElement | undefined {
  const actionScopes = queryAll(response, config.actionSelectors);
  const scopes = actionScopes.length ? [...actionScopes, response] : [response];
  for (const scope of scopes) {
    for (const button of queryAll(scope, config.copySelectors)) {
      if (button.closest(CODE_CONTROL_ANCESTOR)) continue;
      const owner = closestMatching(button, config.turnSelectors);
      if (owner && owner !== response && !response.contains(owner)) continue;
      return button;
    }
  }
  return undefined;
}

function selectTargetAfterPrompt(
  ctx: FrameContext,
  targets: readonly NativeCopyTarget[],
  prompt: string | undefined,
  userSelectors: readonly string[],
): NativeCopyTarget | undefined {
  if (targets.length <= 1) return targets[0];
  const expected = normalizeComposerValue(prompt ?? "");
  if (!expected) return targets.at(-1);
  const user = queryAll(ctx.document, userSelectors)
    .filter(
      (candidate) =>
        isElementVisible(candidate) &&
        normalizeComposerValue(candidate.innerText || candidate.textContent || "") === expected,
    )
    .at(-1);
  if (!user) return targets.at(-1);
  const following = targets.filter((target) =>
    Boolean(user.compareDocumentPosition(target.response) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  return (following.length ? following : [...targets]).toSorted(
    (left, right) => documentIndex(left.response) - documentIndex(right.response),
  )[0];
}

function targetKey(
  response: HTMLElement,
  config: ScopedNativeCopyAdapterConfig,
  anonymousKeys: WeakMap<HTMLElement, string>,
  nextAnonymousKey: () => number,
): string {
  for (const attribute of config.keyAttributes ?? [
    "data-message-id",
    "data-testid",
    "data-id",
    "data-key",
  ]) {
    const value = response.getAttribute(attribute)?.trim();
    if (value) return `${config.id}:${attribute}:${value}`;
  }
  const existing = anonymousKeys.get(response);
  if (existing) return existing;
  const key = `${config.id}:node:${nextAnonymousKey()}`;
  anonymousKeys.set(response, key);
  return key;
}

function isCopyReady(response: HTMLElement, button: HTMLElement): boolean {
  return (
    response.isConnected &&
    button.isConnected &&
    response.contains(button) &&
    !button.matches(":disabled") &&
    button.getAttribute("aria-disabled") !== "true" &&
    button.getAttribute("data-disabled") !== "true"
  );
}

function findTurn(anchor: HTMLElement, selectors: readonly string[]): HTMLElement {
  if (selectors.some((selector) => anchor.matches(selector))) return anchor;
  return closestMatching(anchor, selectors) ?? anchor;
}

function countAssistantAnchors(root: HTMLElement, selectors: readonly string[]): number {
  const count = queryAll(root, selectors).length;
  return count || (selectors.some((selector) => root.matches(selector)) ? 1 : 0);
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
    const match = element.closest<HTMLElement>(selector);
    if (match) return match;
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

function documentIndex(element: Element): number {
  return [...element.ownerDocument.querySelectorAll("*")].indexOf(element);
}

function dispatchHover(target: HTMLElement): void {
  const options = { bubbles: true, cancelable: true, composed: true };
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
    target.dispatchEvent(new MouseEvent(type, options));
  }
}
