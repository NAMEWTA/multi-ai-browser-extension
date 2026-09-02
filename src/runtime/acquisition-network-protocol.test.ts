import { describe, expect, it, vi } from "vitest";
import {
  ACQUISITION_NETWORK_REQUEST_EVENT,
  ACQUISITION_NETWORK_RESPONSE_EVENT,
  MAX_ACQUISITION_REQUEST_LENGTH,
  MAX_ACQUISITION_RESPONSE_LENGTH,
  dispatchAcquisitionNetworkRequest,
  dispatchAcquisitionNetworkResponse,
  identifyProviderEndpoint,
  readAcquisitionNetworkRequest,
  readAcquisitionNetworkResponse,
} from "./acquisition-network-protocol";

describe("acquisition network DOM protocol", () => {
  it("round-trips validated requests and correlated results", () => {
    const requestListener = vi.fn((event: Event) => readAcquisitionNetworkRequest(event));
    const responseListener = vi.fn((event: Event) => readAcquisitionNetworkResponse(event));
    document.addEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, requestListener);
    document.addEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, responseListener);

    dispatchAcquisitionNetworkRequest(window, {
      type: "latest",
      token: "request_token",
      providerId: "deepseek",
      endpointId: "deepseek-history",
    });
    dispatchAcquisitionNetworkResponse(window, {
      type: "result",
      token: "request_token",
      payload: { messages: ["complete"] },
      status: 200,
    });

    expect(requestListener.mock.results[0]?.value).toEqual({
      type: "latest",
      token: "request_token",
      providerId: "deepseek",
      endpointId: "deepseek-history",
    });
    expect(responseListener.mock.results[0]?.value).toEqual({
      type: "result",
      token: "request_token",
      payload: { messages: ["complete"] },
      status: 200,
    });

    document.removeEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, requestListener);
    document.removeEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, responseListener);
  });

  it("rejects malformed details, invalid tokens, and mismatched provider endpoints", () => {
    expect(
      readAcquisitionNetworkRequest(
        event(ACQUISITION_NETWORK_REQUEST_EVENT, {
          type: "latest",
          token: "bad token",
          providerId: "deepseek",
          endpointId: "deepseek-history",
        }),
      ),
    ).toBeUndefined();
    expect(
      readAcquisitionNetworkRequest(
        event(ACQUISITION_NETWORK_REQUEST_EVENT, {
          type: "latest",
          token: "valid_token",
          providerId: "deepseek",
          endpointId: "doubao-chain",
        }),
      ),
    ).toBeUndefined();
    expect(
      readAcquisitionNetworkRequest(
        new CustomEvent(ACQUISITION_NETWORK_REQUEST_EVENT, {
          detail: { type: "latest", token: "valid_token" },
        }),
      ),
    ).toBeUndefined();
  });

  it("enforces separate request and response event size limits", () => {
    expect(() =>
      dispatchAcquisitionNetworkRequest(window, {
        type: "replay",
        token: "request_token",
        observationId: "observation_id",
        bodyPatch: { page_token: "x".repeat(MAX_ACQUISITION_REQUEST_LENGTH) },
      }),
    ).toThrow(/exceeds/);

    const responseListener = vi.fn((event: Event) => readAcquisitionNetworkResponse(event));
    document.addEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, responseListener);
    dispatchAcquisitionNetworkResponse(window, {
      type: "result",
      token: "request_token",
      payload: "x".repeat(MAX_ACQUISITION_RESPONSE_LENGTH),
    });

    expect(responseListener.mock.results[0]?.value).toEqual({
      type: "error",
      token: "request_token",
      message: "Provider response exceeds the supported size",
    });
    document.removeEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, responseListener);
  });

  it("allowlists exact provider hosts and paths", () => {
    expect(identifyProviderEndpoint("chat.deepseek.com", "/api/v0/chat/history_messages")).toEqual({
      providerId: "deepseek",
      endpointId: "deepseek-history",
    });
    expect(
      identifyProviderEndpoint("chat.deepseek.com.evil.test", "/api/v0/chat/history_messages"),
    ).toBeUndefined();
    expect(identifyProviderEndpoint("chat.deepseek.com", "/api/v0/account")).toBeUndefined();
    expect(
      identifyProviderEndpoint("www.qianwen.com", "/api/v2/conversation/conversation-1"),
    ).toEqual({ providerId: "qwen", endpointId: "qwen-conversation" });
    expect(
      identifyProviderEndpoint("www.qianwen.com", "/api/v2/user/chat-preferences"),
    ).toBeUndefined();
  });
});

function event(name: string, detail: unknown): Event {
  return new CustomEvent(name, { detail: JSON.stringify(detail) });
}
