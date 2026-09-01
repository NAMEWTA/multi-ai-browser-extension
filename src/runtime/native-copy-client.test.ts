import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeCopyClient } from "./native-copy-client";
import {
  dispatchNativeCopyResponse,
  NATIVE_COPY_REQUEST_EVENT,
  readNativeCopyRequest,
  type NativeCopyRequestMessage,
} from "./native-copy-protocol";

describe("native copy client", () => {
  const listeners: Array<(event: Event) => void> = [];

  afterEach(() => {
    for (const listener of listeners.splice(0)) {
      document.removeEventListener(NATIVE_COPY_REQUEST_EVENT, listener);
    }
    vi.useRealTimers();
  });

  it("waits for armed, clicks once, and returns the matching capture", async () => {
    const requests: NativeCopyRequestMessage[] = [];
    const button = document.createElement("button");
    const click = vi.fn(() => {
      dispatchNativeCopyResponse(window, {
        type: "captured",
        token: requests[0]!.token,
        payload: { text: "complete native answer", mimeType: "text/plain" },
      });
    });
    button.addEventListener("click", click);
    listen((event) => {
      const message = readNativeCopyRequest(event);
      if (!message) return;
      requests.push(message);
      if (message.type === "arm") {
        expect(click).not.toHaveBeenCalled();
        dispatchNativeCopyResponse(window, { type: "armed", token: message.token });
      }
    });

    const payload = await createNativeCopyClient(window).capture({ button });

    expect(payload).toEqual({ text: "complete native answer", mimeType: "text/plain" });
    expect(click).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      expect.objectContaining({ type: "arm", suppressSystemClipboard: false }),
      expect.objectContaining({ type: "cancel" }),
    ]);
  });

  it("rejects concurrent captures and releases the mutex after abort", async () => {
    const controller = new AbortController();
    const button = document.createElement("button");
    listen((event) => {
      const message = readNativeCopyRequest(event);
      if (message?.type === "arm") {
        dispatchNativeCopyResponse(window, { type: "armed", token: message.token });
      }
    });
    const client = createNativeCopyClient(window);
    const first = client.capture({ button, signal: controller.signal });

    await expect(client.capture({ button })).rejects.toThrow("already active");
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out and always sends cancel", async () => {
    vi.useFakeTimers();
    const requests: NativeCopyRequestMessage[] = [];
    listen((event) => {
      const message = readNativeCopyRequest(event);
      if (message) requests.push(message);
    });
    const capture = createNativeCopyClient(window).capture({
      button: document.createElement("button"),
      timeoutMs: 25,
      suppressSystemClipboard: true,
    });
    const rejection = expect(capture).rejects.toThrow("timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(requests).toEqual([
      expect.objectContaining({ type: "arm", suppressSystemClipboard: true }),
      expect.objectContaining({ type: "cancel" }),
    ]);
  });

  function listen(listener: (event: Event) => void): void {
    listeners.push(listener);
    document.addEventListener(NATIVE_COPY_REQUEST_EVENT, listener);
  }
});
