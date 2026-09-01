import type {
  NativeCopyClient,
  NativeCopyPayload,
  NativeCopyRequest,
} from "../core/providers/contracts";
import {
  dispatchNativeCopyRequest,
  NATIVE_COPY_RESPONSE_EVENT,
  readNativeCopyResponse,
} from "./native-copy-protocol";

const DEFAULT_NATIVE_COPY_TIMEOUT_MS = 5_000;

export function createNativeCopyClient(targetWindow: Window): NativeCopyClient {
  let activeToken: string | undefined;

  return {
    async capture(request: NativeCopyRequest): Promise<NativeCopyPayload> {
      if (activeToken) throw new Error("A native copy capture is already active");
      if (request.signal?.aborted) throw abortError();

      const token = createToken(targetWindow);
      activeToken = token;
      let timeout: number | undefined;
      let onAbort: (() => void) | undefined;
      let onResponse: ((event: Event) => void) | undefined;

      try {
        return await new Promise<NativeCopyPayload>((resolve, reject) => {
          let settled = false;
          let clicked = false;

          const finish = (result: NativeCopyPayload | Error): void => {
            if (settled) return;
            settled = true;
            if (result instanceof Error) reject(result);
            else resolve(result);
          };

          onResponse = (event: Event): void => {
            const message = readNativeCopyResponse(event);
            if (!message || message.token !== token) return;
            if (message.type === "error") {
              finish(new Error(message.message));
              return;
            }
            if (message.type === "canceled") {
              finish(new Error("Native copy capture was canceled"));
              return;
            }
            if (message.type === "captured") {
              finish(message.payload);
              return;
            }
            if (message.type !== "armed" || clicked) return;
            clicked = true;
            targetWindow.queueMicrotask(() => {
              if (settled) return;
              try {
                request.button.click();
              } catch (error) {
                finish(asError(error, "Native copy button click failed"));
              }
            });
          };

          targetWindow.document.addEventListener(NATIVE_COPY_RESPONSE_EVENT, onResponse);
          const timeoutMs = Math.max(1, request.timeoutMs ?? DEFAULT_NATIVE_COPY_TIMEOUT_MS);
          timeout = targetWindow.setTimeout(
            () => finish(new Error(`Native copy capture timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
          onAbort = () => finish(abortError());
          request.signal?.addEventListener("abort", onAbort, { once: true });

          dispatchNativeCopyRequest(targetWindow, {
            type: "arm",
            token,
            suppressSystemClipboard: request.suppressSystemClipboard ?? false,
            timeoutMs,
          });
        });
      } finally {
        if (timeout !== undefined) targetWindow.clearTimeout(timeout);
        if (onAbort) request.signal?.removeEventListener("abort", onAbort);
        if (onResponse) {
          targetWindow.document.removeEventListener(NATIVE_COPY_RESPONSE_EVENT, onResponse);
        }
        dispatchNativeCopyRequest(targetWindow, { type: "cancel", token });
        activeToken = undefined;
      }
    },
  };
}

function createToken(targetWindow: Window): string {
  if (typeof targetWindow.crypto.randomUUID === "function") {
    return targetWindow.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  targetWindow.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function abortError(): Error {
  const error = new Error("Native copy capture was aborted");
  error.name = "AbortError";
  return error;
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
