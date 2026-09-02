import { afterEach, describe, expect, it, vi } from "vitest";
import { createAcquisitionNetworkClient } from "./acquisition-network-client";
import {
  ACQUISITION_NETWORK_REQUEST_EVENT,
  ACQUISITION_NETWORK_RESPONSE_EVENT,
  dispatchAcquisitionNetworkResponse,
  readAcquisitionNetworkRequest,
} from "./acquisition-network-protocol";

describe("acquisition network client", () => {
  const requestListeners: Array<(event: Event) => void> = [];

  afterEach(() => {
    for (const listener of requestListeners.splice(0)) {
      document.removeEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, listener);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("handles a synchronous correlated response without leaking its timeout", async () => {
    vi.useFakeTimers();
    listen((event) => {
      const request = readAcquisitionNetworkRequest(event);
      if (!request) return;
      dispatchAcquisitionNetworkResponse(window, {
        type: "result",
        token: request.token,
        payload: { messages: ["full answer"] },
        status: 200,
      });
    });

    const result = await createAcquisitionNetworkClient(window, 50).latest(
      "deepseek",
      "deepseek-history",
    );

    expect(result).toEqual({ payload: { messages: ["full answer"] }, status: 200 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a response with the wrong token and accepts the matching response", async () => {
    listen((event) => {
      const request = readAcquisitionNetworkRequest(event);
      if (!request) return;
      dispatchAcquisitionNetworkResponse(window, {
        type: "result",
        token: "unrelated_token",
        payload: "wrong",
      });
      dispatchAcquisitionNetworkResponse(window, {
        type: "result",
        token: request.token,
        payload: "right",
      });
    });

    await expect(
      createAcquisitionNetworkClient(window).latest("deepseek", "deepseek-history"),
    ).resolves.toEqual({ payload: "right" });
  });

  it("removes the response listener and timer after timeout", async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(document, "removeEventListener");
    const pending = createAcquisitionNetworkClient(window, 25).latest(
      "deepseek",
      "deepseek-history",
    );
    const rejection = expect(pending).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(remove).toHaveBeenCalledWith(ACQUISITION_NETWORK_RESPONSE_EVENT, expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when request serialization fails", async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(document, "removeEventListener");
    const client = createAcquisitionNetworkClient(window, 25);

    await expect(
      client.replay("observation_id", { page_token: "x".repeat(70_000) }),
    ).rejects.toThrow(/exceeds/);

    expect(remove).toHaveBeenCalledWith(ACQUISITION_NETWORK_RESPONSE_EVENT, expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  function listen(listener: (event: Event) => void): void {
    requestListeners.push(listener);
    document.addEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, listener);
  }
});
