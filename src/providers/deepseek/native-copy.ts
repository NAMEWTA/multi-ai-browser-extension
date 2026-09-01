import type { NativeCopyAdapter, NativeCopyPayload } from "../../core/providers/contracts";

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

export const deepseekNativeCopyAdapter: NativeCopyAdapter = {
  id: "deepseek-native-copy",

  locateCopyButton(_ctx, response) {
    const turn = findTurn(response);
    const candidates = [...turn.querySelectorAll<HTMLElement>(COPY_CONTROL_SELECTOR)]
      .filter((button) => isResponseCopyControl(button))
      .map((button) => ({ button, score: scoreCopyControl(button, response) }))
      .toSorted((left, right) => right.score - left.score);
    return candidates[0]?.button;
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

function normalizeDeepSeekCopy(payload: NativeCopyPayload): NativeCopyPayload {
  const lines = payload.text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && UI_ONLY_LINES.has(normalizeLabel(lines[0] ?? ""))) lines.shift();
  while (lines.length && UI_ONLY_LINES.has(normalizeLabel(lines.at(-1) ?? ""))) lines.pop();
  return { ...payload, text: lines.join("\n").trim() };
}
