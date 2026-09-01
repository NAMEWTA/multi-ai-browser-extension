import type { NativeCopyPayload } from "../core/providers/contracts";
import { builtInProviderMatches } from "../core/providers/built-in-sites";
import {
  dispatchNativeCopyResponse,
  MAX_NATIVE_COPY_TEXT_LENGTH,
  NATIVE_COPY_REQUEST_EVENT,
  readNativeCopyRequest,
} from "../runtime/native-copy-protocol";

const INSTALLATION_KEY = Symbol.for("multi-ai-browser-extension.native-copy-main.v1");
const SUPPORTED_MIME_TYPES = ["text/markdown", "text/plain", "text/html"] as const;
const CAPTURE_SETTLE_MS = 75;

interface ArmedCapture {
  readonly token: string;
  readonly suppressSystemClipboard: boolean;
  candidate?: NativeCopyPayload;
  settleTimeout?: number;
}

interface MainBridgeInstallation {
  uninstall(): void;
}

export function installNativeCopyMainBridge(targetWindow: Window = window): () => void {
  const scope = targetWindow as unknown as Record<PropertyKey, unknown>;
  if (scope[INSTALLATION_KEY]) return () => undefined;

  let active: ArmedCapture | undefined;
  let activeTimeout: number | undefined;
  const restorers: Array<() => void> = [];
  const clipboard = targetWindow.navigator.clipboard;

  if (clipboard) {
    const originalWriteText = clipboard.writeText;
    if (typeof originalWriteText === "function") {
      const patchedWriteText = function (this: Clipboard, text: string): Promise<void> {
        const capture = active;
        if (capture) stageCaptured(capture, { text: String(text), mimeType: "text/plain" });
        if (capture?.suppressSystemClipboard) return Promise.resolve();
        return originalWriteText.call(this, text);
      };
      const restore = replaceMethod(clipboard, "writeText", patchedWriteText);
      if (restore) restorers.push(restore);
    }

    const originalWrite = clipboard.write;
    if (typeof originalWrite === "function") {
      const patchedWrite = function (this: Clipboard, items: ClipboardItems): Promise<void> {
        const capture = active;
        if (capture) {
          void readClipboardItems(items).then(
            (payload) => stageCaptured(capture, payload),
            (error: unknown) => settleError(capture, errorMessage(error)),
          );
        }
        if (capture?.suppressSystemClipboard) return Promise.resolve();
        return originalWrite.call(this, items);
      };
      const restore = replaceMethod(clipboard, "write", patchedWrite);
      if (restore) restorers.push(restore);
    }
  }

  const onRequest = (event: Event): void => {
    const message = readNativeCopyRequest(event);
    if (!message) return;
    if (message.type === "cancel") {
      if (active?.token !== message.token) return;
      clearActive();
      dispatchNativeCopyResponse(targetWindow, { type: "canceled", token: message.token });
      return;
    }
    if (active && active.token !== message.token) {
      dispatchNativeCopyResponse(targetWindow, {
        type: "error",
        token: message.token,
        message: "Native copy bridge is busy",
      });
      return;
    }
    if (!restorers.length) {
      dispatchNativeCopyResponse(targetWindow, {
        type: "error",
        token: message.token,
        message: "Clipboard write APIs are unavailable",
      });
      return;
    }
    active = {
      token: message.token,
      suppressSystemClipboard: message.suppressSystemClipboard,
    };
    activeTimeout = targetWindow.setTimeout(
      () => settleError(active!, "Native copy bridge timed out"),
      message.timeoutMs ?? 5_000,
    );
    dispatchNativeCopyResponse(targetWindow, { type: "armed", token: message.token });
  };

  const stageCaptured = (capture: ArmedCapture, payload: NativeCopyPayload): void => {
    if (active?.token !== capture.token) return;
    if (payload.text.length > MAX_NATIVE_COPY_TEXT_LENGTH) {
      settleError(capture, "Native copy payload exceeds the supported size");
      return;
    }
    if (!capture.candidate || comparePayload(payload, capture.candidate) > 0) {
      capture.candidate = payload;
    }
    if (capture.settleTimeout !== undefined) {
      targetWindow.clearTimeout(capture.settleTimeout);
    }
    capture.settleTimeout = targetWindow.setTimeout(
      () => settleCaptured(capture),
      CAPTURE_SETTLE_MS,
    );
  };

  const settleCaptured = (capture: ArmedCapture): void => {
    if (active?.token !== capture.token || !capture.candidate) return;
    const payload = capture.candidate;
    clearActive();
    dispatchNativeCopyResponse(targetWindow, { type: "captured", token: capture.token, payload });
  };

  const settleError = (capture: ArmedCapture, message: string): void => {
    if (active?.token !== capture.token) return;
    clearActive();
    dispatchNativeCopyResponse(targetWindow, { type: "error", token: capture.token, message });
  };

  const clearActive = (): void => {
    if (active?.settleTimeout !== undefined) targetWindow.clearTimeout(active.settleTimeout);
    active = undefined;
    if (activeTimeout !== undefined) targetWindow.clearTimeout(activeTimeout);
    activeTimeout = undefined;
  };

  targetWindow.document.addEventListener(NATIVE_COPY_REQUEST_EVENT, onRequest);
  const installation: MainBridgeInstallation = {
    uninstall() {
      clearActive();
      targetWindow.document.removeEventListener(NATIVE_COPY_REQUEST_EVENT, onRequest);
      for (const restore of restorers.reverse()) restore();
      delete scope[INSTALLATION_KEY];
    },
  };
  scope[INSTALLATION_KEY] = installation;
  return () => installation.uninstall();
}

function comparePayload(left: NativeCopyPayload, right: NativeCopyPayload): number {
  const length = left.text.trim().length - right.text.trim().length;
  if (length !== 0) return length;
  return mimePriority(left.mimeType) - mimePriority(right.mimeType);
}

function mimePriority(mimeType: NativeCopyPayload["mimeType"]): number {
  return mimeType === "text/markdown" ? 3 : mimeType === "text/plain" ? 2 : 1;
}

async function readClipboardItems(items: ClipboardItems): Promise<NativeCopyPayload> {
  for (const item of items) {
    for (const mimeType of SUPPORTED_MIME_TYPES) {
      if (!item.types.includes(mimeType)) continue;
      const blob = await item.getType(mimeType);
      return { text: await blob.text(), mimeType };
    }
  }
  throw new Error("Clipboard items do not contain supported text");
}

function replaceMethod(
  target: object,
  name: "write" | "writeText",
  replacement: Clipboard[typeof name],
): (() => void) | undefined {
  let owner: object | null = target;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) {
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (!owner) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || typeof descriptor.value !== "function") return undefined;
  try {
    Object.defineProperty(owner, name, { ...descriptor, value: replacement });
  } catch {
    return undefined;
  }
  return () => {
    if (Object.getOwnPropertyDescriptor(owner, name)?.value === replacement) {
      Object.defineProperty(owner, name, descriptor);
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Clipboard item extraction failed";
}

export default defineContentScript({
  matches: [...builtInProviderMatches],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    installNativeCopyMainBridge(window);
  },
});
