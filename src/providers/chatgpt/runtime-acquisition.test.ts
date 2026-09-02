import { describe, expect, it, vi } from "vitest";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { chatGptAcquisitionAdapter } from "./runtime-acquisition";

const payload = {
  current_node: "assistant",
  mapping: {
    root: { id: "root", parent: null, message: null },
    user: {
      id: "user",
      parent: "root",
      message: { author: { role: "user" }, content: { parts: ["Question"] } },
    },
    assistant: {
      id: "assistant",
      parent: "user",
      message: { author: { role: "assistant" }, content: { parts: ["Answer"] } },
    },
  },
};

describe("chatGptAcquisitionAdapter", () => {
  it("uses only a fresh observation for the current conversation", async () => {
    const latest = vi.fn().mockResolvedValue({
      observation: {
        observationId: "observation-current",
        providerId: "chatgpt",
        endpointId: "chatgpt-conversation",
        url: "https://chatgpt.com/backend-api/conversation/conversation-1",
        method: "GET",
        observedAt: "2026-09-01T10:00:01.000Z",
      },
      payload,
    });
    const network = { latest, replay: vi.fn(), fetchJson: vi.fn() } as AcquisitionNetworkClient;
    const snapshot = await chatGptAcquisitionAdapter.strategiesByPriority[0]!.acquire({
      providerId: "chatgpt",
      data: {
        url: "https://chatgpt.com/c/conversation-1",
        acquisitionObservedAfter: Date.parse("2026-09-01T10:00:00.000Z"),
        network,
      },
    });

    expect(snapshot?.conversationId).toBe("conversation-1");
    expect(snapshot?.messages.at(-1)?.id).toBe("assistant");
    expect(network.replay).not.toHaveBeenCalled();
  });

  it("rejects a response observed before the send baseline", async () => {
    const network = {
      latest: vi.fn().mockResolvedValue({
        observation: {
          observationId: "observation-stale",
          providerId: "chatgpt",
          endpointId: "chatgpt-conversation",
          url: "https://chatgpt.com/backend-api/conversation/conversation-1",
          method: "GET",
          observedAt: "2026-09-01T09:59:59.000Z",
        },
        payload,
      }),
      replay: vi.fn(),
      fetchJson: vi.fn(),
    } as AcquisitionNetworkClient;

    await expect(
      chatGptAcquisitionAdapter.strategiesByPriority[0]!.acquire({
        providerId: "chatgpt",
        data: {
          url: "https://chatgpt.com/c/conversation-1",
          acquisitionObservedAfter: Date.parse("2026-09-01T10:00:00.000Z"),
          network,
        },
      }),
    ).resolves.toBeUndefined();
    expect(network.replay).not.toHaveBeenCalled();
  });
});
