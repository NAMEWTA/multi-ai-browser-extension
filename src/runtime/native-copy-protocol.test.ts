import { describe, expect, it, vi } from "vitest";
import {
  dispatchNativeCopyRequest,
  dispatchNativeCopyResponse,
  NATIVE_COPY_REQUEST_EVENT,
  NATIVE_COPY_RESPONSE_EVENT,
  readNativeCopyRequest,
  readNativeCopyResponse,
} from "./native-copy-protocol";

describe("native copy DOM protocol", () => {
  it("round-trips arm and captured messages as string event details", () => {
    const requestListener = vi.fn((event: Event) => readNativeCopyRequest(event));
    const responseListener = vi.fn((event: Event) => readNativeCopyResponse(event));
    document.addEventListener(NATIVE_COPY_REQUEST_EVENT, requestListener);
    document.addEventListener(NATIVE_COPY_RESPONSE_EVENT, responseListener);

    dispatchNativeCopyRequest(window, {
      type: "arm",
      token: "request-token",
      suppressSystemClipboard: true,
    });
    dispatchNativeCopyResponse(window, {
      type: "captured",
      token: "request-token",
      payload: { text: "# Full answer", mimeType: "text/markdown" },
    });

    expect(requestListener.mock.results[0]?.value).toEqual({
      type: "arm",
      token: "request-token",
      suppressSystemClipboard: true,
    });
    expect(responseListener.mock.results[0]?.value).toEqual({
      type: "captured",
      token: "request-token",
      payload: { text: "# Full answer", mimeType: "text/markdown" },
    });

    document.removeEventListener(NATIVE_COPY_REQUEST_EVENT, requestListener);
    document.removeEventListener(NATIVE_COPY_RESPONSE_EVENT, responseListener);
  });

  it("rejects malformed and object-valued event details", () => {
    expect(readNativeCopyRequest(new CustomEvent(NATIVE_COPY_REQUEST_EVENT, { detail: "{" }))).toBe(
      undefined,
    );
    expect(
      readNativeCopyRequest(
        new CustomEvent(NATIVE_COPY_REQUEST_EVENT, {
          detail: { type: "cancel", token: "object-detail" },
        }),
      ),
    ).toBe(undefined);
    expect(
      readNativeCopyResponse(
        new CustomEvent(NATIVE_COPY_RESPONSE_EVENT, {
          detail: JSON.stringify({
            type: "captured",
            token: "token",
            payload: { text: "answer", mimeType: "application/json" },
          }),
        }),
      ),
    ).toBe(undefined);
  });
});
