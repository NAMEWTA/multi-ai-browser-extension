import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AcquisitionSelectionError, acquireConversation } from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { KimiStrategy } from "./strategy";
import { kimiAcquisitionAdapter } from "./runtime-acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/kimi/fixtures/${name}`, "utf8")) as unknown;
}

function observation(chatId = "chat-123") {
  return {
    observationId: "observed-kimi-list-messages",
    providerId: "kimi" as const,
    endpointId: "kimi-list-messages" as const,
    url: "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/ListMessages",
    method: "POST",
    body: { chat_id: chatId, page_size: 50 },
    observedAt: "2026-09-01T10:04:00.000Z",
  };
}

function networkWithPages(...pages: unknown[]): AcquisitionNetworkClient {
  return {
    latest: vi.fn().mockResolvedValue({ observation: observation() }),
    replay: vi.fn().mockImplementation(async () => ({ payload: pages.shift(), status: 200 })),
    fetchJson: vi.fn(),
  };
}

describe("Kimi runtime acquisition", () => {
  it("replays ListMessages pagination without reading credentials", async () => {
    const network = networkWithPages(
      fixture("acquisition-list-messages-page-1.json"),
      fixture("acquisition-list-messages-page-2.json"),
    );
    const selected = await acquireConversation(kimiAcquisitionAdapter, {
      providerId: "kimi",
      data: { network, url: "https://www.kimi.com/chat/chat-123" },
    });

    expect(selected.snapshot.completeness.state).toBe("complete");
    expect(selected.snapshot.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
    ]);
    expect(selected.snapshot.messages.at(-1)?.content[0]?.text).toBe(
      "Second answer belongs only to the second prompt.",
    );
    expect(network.replay).toHaveBeenNthCalledWith(1, "observed-kimi-list-messages", {
      page_size: 100,
      page_token: "",
    });
    expect(network.replay).toHaveBeenNthCalledWith(2, "observed-kimi-list-messages", {
      page_size: 100,
      page_token: "older-page",
    });
    expect(network.fetchJson).not.toHaveBeenCalled();
  });

  it("does not replay an observation from another conversation", async () => {
    const network: AcquisitionNetworkClient = {
      latest: vi.fn().mockResolvedValue({ observation: observation("another-chat") }),
      replay: vi.fn(),
      fetchJson: vi.fn(),
    };
    const snapshot = await kimiAcquisitionAdapter.strategiesByPriority[0]!.acquire({
      providerId: "kimi",
      data: { network, url: "https://www.kimi.com/chat/chat-123" },
    });

    expect(snapshot).toBeUndefined();
    expect(network.replay).not.toHaveBeenCalled();
  });

  it("does not reuse an observation captured before the current send", async () => {
    const network = networkWithPages(fixture("acquisition-list-messages-page-2.json"));
    const snapshot = await kimiAcquisitionAdapter.strategiesByPriority[0]!.acquire({
      providerId: "kimi",
      data: {
        network,
        url: "https://www.kimi.com/chat/chat-123",
        acquisitionObservedAfter: Date.parse("2026-09-01T10:05:00.000Z"),
      },
    });

    expect(snapshot).toBeUndefined();
    expect(network.replay).not.toHaveBeenCalled();
  });

  it("rejects an API result that still ends at the second user prompt", async () => {
    const network = networkWithPages(staleSecondTurnPage());

    await expect(
      acquireConversation(kimiAcquisitionAdapter, {
        providerId: "kimi",
        data: { network, url: "https://www.kimi.com/chat/chat-123" },
      }),
    ).rejects.toBeInstanceOf(AcquisitionSelectionError);
  });

  it("selects the second-turn assistant by its matching user prompt", async () => {
    window.history.replaceState({}, "", "/chat/chat-123");
    document.body.innerHTML = "";
    const network = networkWithPages(
      fixture("acquisition-list-messages-page-1.json"),
      fixture("acquisition-list-messages-page-2.json"),
    );

    const result = await new KimiStrategy().finalizeResponse(
      { document, window, acquisitionNetwork: network },
      {
        count: 0,
        lastText: "",
        acquisitionObservedAfter: Date.parse("2026-09-01T10:03:00.000Z"),
      },
      { text: "second prompt" },
    );

    expect(result).toMatchObject({
      status: "completed",
      captureSource: "provider-api",
      text: "Second answer belongs only to the second prompt.",
      acquisition: {
        providerMessageId: "assistant-2",
        adapterVersion: "kimi-list-messages-v2",
        verification: "verified",
      },
    });
    expect(result?.text).not.toContain("First answer");
  });

  it("falls back to native Copy instead of reusing the first-turn assistant body", async () => {
    window.history.replaceState({}, "", "/chat/chat-123");
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" data-lexical-editor="true"></div>
      <div class="chat-content-item-user" data-message-id="user-2">second prompt</div>
      <article class="chat-content-item-assistant" data-message-id="assistant-2">
        <div class="segment-content"><div class="markdown">Visible second answer</div></div>
        <button aria-label="copy response">copy</button>
      </article>
    `;
    const network = networkWithPages(staleSecondTurnPage());
    const nativeCopy = {
      capture: vi.fn().mockResolvedValue({
        text: "Second answer from native Copy\n\nVisible second answer",
        mimeType: "text/markdown" as const,
      }),
    };

    const result = await new KimiStrategy().finalizeResponse(
      { document, window, acquisitionNetwork: network, nativeCopy },
      {
        count: 0,
        lastText: "",
        acquisitionObservedAfter: Date.parse("2026-09-01T10:03:00.000Z"),
      },
      { text: "second prompt" },
    );

    expect(result).toMatchObject({
      status: "completed",
      captureSource: "native-copy",
      text: expect.stringContaining("Second answer from native Copy"),
      acquisition: {
        providerMessageId: "kimi-copy:assistant-2",
        verification: "verified",
      },
    });
    expect(result?.text).not.toContain("first answer");
    expect(nativeCopy.capture).toHaveBeenCalledOnce();
  });
});

function staleSecondTurnPage() {
  return {
    messages: [
      message("user-2", "assistant-1", "ROLE_USER", "second prompt", "10:02:00"),
      message("assistant-1", "user-1", "ROLE_ASSISTANT", "first answer", "10:01:00"),
      message("user-1", "", "ROLE_USER", "first prompt", "10:00:00"),
    ],
    nextPageToken: "",
  };
}

function message(
  id: string,
  parentId: string,
  role: "ROLE_USER" | "ROLE_ASSISTANT",
  text: string,
  time: string,
) {
  return {
    id,
    parentId,
    role,
    status: "MESSAGE_STATUS_FINISHED",
    createTime: `2026-09-01T${time}Z`,
    blocks: [{ text: { content: text } }],
  };
}
