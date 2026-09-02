import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAcquisitionNetworkClient } from "./acquisition-network-client";
import { MAX_ACQUISITION_RESPONSE_LENGTH } from "./acquisition-network-protocol";

let installAcquisitionNetworkBridge: (targetWindow?: Window) => () => void;
let uninstall: (() => void) | undefined;

beforeAll(async () => {
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  ({ installAcquisitionNetworkBridge } =
    await import("../entrypoints/acquisition-network-main.content"));
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.useRealTimers();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("acquisition network MAIN-world bridge", () => {
  it("allows only same-origin, allowlisted provider endpoints", async () => {
    const originalFetch = vi.fn<typeof fetch>(async () => jsonResponse({ messages: ["complete"] }));
    const targetWindow = providerWindow(originalFetch);
    uninstall = installAcquisitionNetworkBridge(targetWindow);
    const client = createAcquisitionNetworkClient(targetWindow, 100);

    await expect(
      client.fetchJson(
        "deepseek",
        "deepseek-history",
        "https://chat.deepseek.com/api/v0/chat/history_messages",
      ),
    ).resolves.toMatchObject({ payload: { messages: ["complete"] }, status: 200 });
    await expect(
      client.fetchJson(
        "deepseek",
        "deepseek-history",
        "https://evil.test/api/v0/chat/history_messages",
      ),
    ).rejects.toThrow("Cross-origin fetch rejected");
    await expect(
      client.fetchJson("deepseek", "deepseek-history", "https://chat.deepseek.com/api/v0/account"),
    ).rejects.toThrow("not allowlisted");

    expect(originalFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps private replay data in MAIN while exposing only sanitized descriptors and payloads", async () => {
    const originalFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        messages: ["complete"],
        accessToken: "payload-secret",
        nested: {
          "x-api-key": "nested-secret",
          password: "password-secret",
          page_token: "pagination-is-not-an-auth-secret",
        },
      }),
    );
    const targetWindow = providerWindow(originalFetch);
    uninstall = installAcquisitionNetworkBridge(targetWindow);
    const secretUrl =
      "https://chat.deepseek.com/api/v0/chat/history_messages?conversation_id=conversation-1&access_token=query-secret&signature=signed-secret";

    await targetWindow.fetch(secretUrl, {
      method: "POST",
      headers: { authorization: "Bearer header-secret", "x-safe": "yes" },
      body: JSON.stringify({
        conversation_id: "conversation-1",
        access_token: "body-secret",
      }),
    });
    await vi.waitFor(() => expect(originalFetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const client = createAcquisitionNetworkClient(targetWindow, 100);
    const latest = await client.latest("deepseek", "deepseek-history");
    expect(latest.observation).toMatchObject({
      providerId: "deepseek",
      endpointId: "deepseek-history",
      url: "https://chat.deepseek.com/api/v0/chat/history_messages?conversation_id=conversation-1",
      body: { conversation_id: "conversation-1" },
    });
    expect(latest.payload).toEqual({
      messages: ["complete"],
      nested: { page_token: "pagination-is-not-an-auth-secret" },
    });
    expect(JSON.stringify(latest)).not.toMatch(
      /query-secret|signed-secret|header-secret|body-secret|payload-secret|nested-secret|password-secret/,
    );

    await client.replay(latest.observation!.observationId);
    expect(originalFetch.mock.calls[1]?.[0]).toBe(secretUrl);
    expect(JSON.stringify(latest.observation)).not.toContain("query-secret");
  });

  it("rejects an oversized fetch response before it crosses the event bridge", async () => {
    const originalFetch = vi.fn<typeof fetch>(async () =>
      textResponse(`{"answer":"${"x".repeat(MAX_ACQUISITION_RESPONSE_LENGTH)}"}`),
    );
    const targetWindow = providerWindow(originalFetch);
    uninstall = installAcquisitionNetworkBridge(targetWindow);

    await expect(
      createAcquisitionNetworkClient(targetWindow, 100).fetchJson(
        "deepseek",
        "deepseek-history",
        "https://chat.deepseek.com/api/v0/chat/history_messages",
      ),
    ).rejects.toThrow("not valid JSON");
  });

  it("does not retain an oversized XHR JSON payload", async () => {
    class FakeXmlHttpRequest extends EventTarget {
      responseType: XMLHttpRequestResponseType = "";
      response: unknown = null;
      responseText = `{"answer":"${"x".repeat(MAX_ACQUISITION_RESPONSE_LENGTH)}"}`;
      status = 200;

      open(): void {}
      setRequestHeader(): void {}
      send(): void {
        this.dispatchEvent(new Event("load"));
      }
    }

    const originalFetch = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const targetWindow = providerWindow(
      originalFetch,
      FakeXmlHttpRequest as unknown as typeof XMLHttpRequest,
    );
    uninstall = installAcquisitionNetworkBridge(targetWindow);
    const request = new (
      targetWindow as unknown as { XMLHttpRequest: typeof XMLHttpRequest }
    ).XMLHttpRequest();
    request.open("GET", "https://chat.deepseek.com/api/v0/chat/history_messages");
    request.send();

    const latest = await createAcquisitionNetworkClient(targetWindow, 100).latest(
      "deepseek",
      "deepseek-history",
    );
    expect(latest.observation).toBeDefined();
    expect(latest.payload).toBeUndefined();
    expect(latest.status).toBeUndefined();
  });
});

function providerWindow(
  fetchImplementation: typeof fetch,
  XMLHttpRequestConstructor?: typeof XMLHttpRequest,
): Window {
  return {
    document,
    location: new URL("https://chat.deepseek.com/chat"),
    crypto: window.crypto,
    CustomEvent: window.CustomEvent,
    Request,
    fetch: fetchImplementation,
    XMLHttpRequest: XMLHttpRequestConstructor,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  } as unknown as Window;
}

function jsonResponse(payload: unknown): Response {
  return textResponse(JSON.stringify(payload));
}

function textResponse(text: string): Response {
  const response = {
    status: 200,
    headers: new Headers(),
    text: async () => text,
    clone: () => response,
  };
  return response as unknown as Response;
}
