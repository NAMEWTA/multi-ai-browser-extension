import type {
  FrameContext,
  NativeCopyAdapter,
  NativeCopyPayload,
} from "../../core/providers/contracts";
import { isElementVisible } from "../../core/providers/dom";
import { deepseekSelectors } from "./selectors";

const TURN_SELECTORS = [
  "[data-virtual-list-item-key]",
  "[data-message-id]",
  ".ds-assistant-message",
  "[class*='assistant-message']",
  "[data-role='assistant']",
  ".assistant-response",
] as const;

const COPY_CONTROL_SELECTOR = "button, [role='button']";
const ACTION_CONTAINER_SELECTOR = [
  "[role='group']",
  "[class*='message-action']",
  "[class*='action-bar']",
  "[class*='toolbar']",
  "[class*='operation']",
].join(",");
const CODE_CONTROL_ANCESTOR = [
  "pre",
  "code",
  ".code-block",
  "[class*='code-block']",
  "[class*='code_block']",
  "[data-code-block]",
].join(",");

const RESPONSE_COPY_LABELS = [
  "复制",
  "复制回答",
  "复制回复",
  "复制内容",
  "复制消息",
  "copy",
  "copy answer",
  "copy response",
  "copy reply",
  "copy message",
] as const;

const NON_RESPONSE_COPY_LABELS = [
  "复制代码",
  "复制链接",
  "复制引用",
  "复制图片",
  "copy code",
  "copy link",
  "copy citation",
  "copy image",
] as const;

const UI_ONLY_LINES = new Set(["复制", "copy", "已停止", "stopped"]);
const ASSISTANT_CONTENT_SELECTORS = [
  ".ds-assistant-message-main-content",
  ".ds-markdown:not(.ds-think-content .ds-markdown)",
  "[data-role='assistant']",
  ".assistant-response",
] as const;
const anonymousTurnKeys = new WeakMap<HTMLElement, string>();
let nextAnonymousTurnKey = 1;

export const deepseekNativeCopyAdapter: NativeCopyAdapter = {
  id: "deepseek-native-copy",
  capturePolicy: { maxAttempts: 3, requireDomEndingAnchor: true, terminalStableMs: 1_500 },

  locateCopyButton(_ctx, response) {
    const turn = findTurn(response);
    const candidates = [...turn.querySelectorAll<HTMLElement>(COPY_CONTROL_SELECTOR)]
      .filter((button) => isResponseCopyControl(button))
      .map((button) => ({ button, score: scoreCopyControl(button, response) }))
      .toSorted((left, right) => right.score - left.score);
    return candidates[0]?.button;
  },

  listTargets(ctx) {
    return listAssistantTurns(ctx).flatMap((response) => {
      const button = this.locateCopyButton(ctx, response);
      return button ? [{ key: turnKey(response), response, button }] : [];
    });
  },

  isTerminalTarget(ctx, target) {
    dispatchHover(target.response);
    return (
      this.isReady?.(ctx, target.response, target.button) !== false &&
      !hasVisible(ctx.document, deepseekSelectors.generating ?? [])
    );
  },

  async prepareCopy(ctx, response, button) {
    void ctx;
    const turn = findTurn(response);
    const actionContainer = button?.closest<HTMLElement>(ACTION_CONTAINER_SELECTOR);
    dispatchHover(turn);
    if (response !== turn) dispatchHover(response);
    if (actionContainer && actionContainer !== turn && actionContainer !== response) {
      dispatchHover(actionContainer);
    }
    await Promise.resolve();
  },

  isReady(_ctx, response, button) {
    const turn = findTurn(response);
    return (
      button.isConnected &&
      turn.contains(button) &&
      !button.hasAttribute("disabled") &&
      button.getAttribute("aria-disabled") !== "true" &&
      !button.classList.contains("disabled") &&
      !button.classList.contains("ds-button--disabled")
    );
  },

  normalize(payload) {
    return normalizeDeepSeekCopy(payload);
  },
};

function listAssistantTurns(ctx: FrameContext): HTMLElement[] {
  const candidates = queryAll(ctx.document, TURN_SELECTORS).filter(
    (turn) => isElementVisible(turn) && matchesOrContains(turn, ASSISTANT_CONTENT_SELECTORS),
  );
  return candidates.filter(
    (turn) => !candidates.some((candidate) => candidate !== turn && candidate.contains(turn)),
  );
}

function turnKey(turn: HTMLElement): string {
  for (const attribute of [
    "data-virtual-list-item-key",
    "data-message-id",
    "data-id",
    "data-key",
  ]) {
    const value = turn.getAttribute(attribute)?.trim();
    if (value) return `deepseek-copy:${value}`;
  }
  const existing = anonymousTurnKeys.get(turn);
  if (existing) return existing;
  const key = `deepseek-copy-node:${nextAnonymousTurnKey++}`;
  anonymousTurnKeys.set(turn, key);
  return key;
}

function findTurn(response: HTMLElement): HTMLElement {
  for (const selector of TURN_SELECTORS) {
    if (response.matches(selector)) return response;
    const turn = response.closest<HTMLElement>(selector);
    if (turn) return turn;
  }
  return response;
}

function isResponseCopyControl(button: HTMLElement): boolean {
  if (button.closest(CODE_CONTROL_ANCESTOR)) return false;
  const label = accessibleLabel(button);
  if (!label || NON_RESPONSE_COPY_LABELS.some((candidate) => label.includes(candidate))) {
    return false;
  }
  return RESPONSE_COPY_LABELS.some(
    (candidate) => label === candidate || label.startsWith(`${candidate} `),
  );
}

function accessibleLabel(button: HTMLElement): string {
  return normalizeLabel(
    [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-tooltip-content"),
      button.textContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function scoreCopyControl(button: HTMLElement, response: HTMLElement): number {
  const label = accessibleLabel(button);
  let score = 0;
  if (label === "复制" || label === "copy") score += 40;
  if (/回答|回复|answer|response|reply/.test(label)) score += 30;
  if (button.closest(ACTION_CONTAINER_SELECTOR)) score += 20;
  if (response.contains(button)) score += 10;
  if (button.tagName === "BUTTON") score += 5;
  return score;
}

function dispatchHover(target: HTMLElement): void {
  const eventOptions = { bubbles: true, cancelable: true, composed: true };
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
    target.dispatchEvent(new MouseEvent(type, eventOptions));
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

function normalizeDeepSeekCopy(payload: NativeCopyPayload): NativeCopyPayload {
  const lines = payload.text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && UI_ONLY_LINES.has(normalizeLabel(lines[0] ?? ""))) lines.shift();
  while (lines.length && UI_ONLY_LINES.has(normalizeLabel(lines.at(-1) ?? ""))) lines.pop();
  return { ...payload, text: lines.join("\n").trim() };
}
