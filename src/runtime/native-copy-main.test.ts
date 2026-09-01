import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dispatchNativeCopyRequest,
  NATIVE_COPY_RESPONSE_EVENT,
  readNativeCopyResponse,
  type NativeCopyResponseMessage,
} from "./native-copy-protocol";

let installNativeCopyMainBridge: (targetWindow?: Window) => () => void;
let uninstall: (() => void) | undefined;
const responseListeners: Array<(event: Event) => void> = [];

beforeAll(async () => {
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  ({ installNativeCopyMainBridge } = await import("../entrypoints/native-copy-main.content"));
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  for (const listener of responseListeners.splice(0)) {
    document.removeEventListener(NATIVE_COPY_RESPONSE_EVENT, listener);
  }
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("native copy MAIN-world bridge", () => {
  it("passes writeText through by default and captures its text", async () => {
    const originalWriteText = vi.fn(async () => undefined);
    installClipboard({ writeText: originalWriteText, write: vi.fn(async () => undefined) });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "plain-token",
      suppressSystemClipboard: false,
    });
    await navigator.clipboard.writeText("native markdown text");
    await vi.waitFor(() =>
      expect(responses.some((message) => message.type === "captured")).toBe(true),
    );
    await navigator.clipboard.writeText("manual copy after capture");

    expect(originalWriteText).toHaveBeenNthCalledWith(1, "native markdown text");
    expect(originalWriteText).toHaveBeenNthCalledWith(2, "manual copy after capture");
    expect(responses).toEqual([
      { type: "armed", token: "plain-token" },
      {
        type: "captured",
        token: "plain-token",
        payload: { text: "native markdown text", mimeType: "text/plain" },
      },
    ]);
  });

  it("suppresses the system write when armed for suppression", async () => {
    const originalWriteText = vi.fn(async () => undefined);
    installClipboard({ writeText: originalWriteText, write: vi.fn(async () => undefined) });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "suppressed-token",
      suppressSystemClipboard: true,
    });
    await navigator.clipboard.writeText("captured only");
    await vi.waitFor(() =>
      expect(responses.some((message) => message.type === "captured")).toBe(true),
    );

    expect(originalWriteText).not.toHaveBeenCalled();
    expect(responses.at(-1)).toEqual({
      type: "captured",
      token: "suppressed-token",
      payload: { text: "captured only", mimeType: "text/plain" },
    });
  });

  it("extracts the preferred textual ClipboardItem representation", async () => {
    const originalWrite = vi.fn(async () => undefined);
    installClipboard({ writeText: vi.fn(async () => undefined), write: originalWrite });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);
    const item = {
      types: ["text/html", "text/markdown", "text/plain"],
      getType: vi.fn(async (mimeType: string) => textBlob(`${mimeType}:full answer`)),
    } as unknown as ClipboardItem;

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "item-token",
      suppressSystemClipboard: true,
    });
    await navigator.clipboard.write([item]);
    await vi.waitFor(() =>
      expect(responses.some((message) => message.type === "captured")).toBe(true),
    );

    expect(originalWrite).not.toHaveBeenCalled();
    expect(item.getType).toHaveBeenCalledWith("text/markdown");
    expect(responses.at(-1)).toEqual({
      type: "captured",
      token: "item-token",
      payload: { text: "text/markdown:full answer", mimeType: "text/markdown" },
    });
  });

  it("settles the most complete payload when one Copy click writes more than once", async () => {
    installClipboard({
      writeText: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "multi-write-token",
      suppressSystemClipboard: true,
    });
    await navigator.clipboard.writeText("Title");
    await navigator.clipboard.writeText("Title\n\nComplete body\n\nFinal paragraph");
    await vi.waitFor(() =>
      expect(responses.some((message) => message.type === "captured")).toBe(true),
    );

    expect(responses.at(-1)).toEqual({
      type: "captured",
      token: "multi-write-token",
      payload: {
        text: "Title\n\nComplete body\n\nFinal paragraph",
        mimeType: "text/plain",
      },
    });
  });

  it("rejects a second arm until the active token is canceled", () => {
    installClipboard({
      writeText: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "first-token",
      suppressSystemClipboard: false,
    });
    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "second-token",
      suppressSystemClipboard: false,
    });
    dispatchNativeCopyRequest(window, { type: "cancel", token: "first-token" });

    expect(responses).toEqual([
      { type: "armed", token: "first-token" },
      { type: "error", token: "second-token", message: "Native copy bridge is busy" },
      { type: "canceled", token: "first-token" },
    ]);
  });

  it("disarms an abandoned MAIN-world capture after its bounded timeout", async () => {
    vi.useFakeTimers();
    installClipboard({
      writeText: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "abandoned-token",
      suppressSystemClipboard: true,
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);
    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "next-token",
      suppressSystemClipboard: true,
    });

    expect(responses).toContainEqual({
      type: "error",
      token: "abandoned-token",
      message: "Native copy bridge timed out",
    });
    expect(responses.at(-1)).toEqual({ type: "armed", token: "next-token" });
  });

  it("rejects an oversized captured payload without changing the system clipboard", async () => {
    const originalWriteText = vi.fn(async () => undefined);
    installClipboard({ writeText: originalWriteText, write: vi.fn(async () => undefined) });
    const responses = collectResponses();
    uninstall = installNativeCopyMainBridge(window);
    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "oversized-token",
      suppressSystemClipboard: true,
    });

    await navigator.clipboard.writeText("x".repeat(2_000_001));

    expect(originalWriteText).not.toHaveBeenCalled();
    expect(responses.at(-1)).toEqual({
      type: "error",
      token: "oversized-token",
      message: "Native copy payload exceeds the supported size",
    });
  });
});

function installClipboard(clipboard: Pick<Clipboard, "write" | "writeText">): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

function collectResponses(): NativeCopyResponseMessage[] {
  const responses: NativeCopyResponseMessage[] = [];
  const listener = (event: Event) => {
    const message = readNativeCopyResponse(event);
    if (message) responses.push(message);
  };
  responseListeners.push(listener);
  document.addEventListener(NATIVE_COPY_RESPONSE_EVENT, listener);
  return responses;
}

function textBlob(text: string): Blob {
  return { text: async () => text } as Blob;
}
