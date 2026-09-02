import { describe, expect, it, vi } from "vitest";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { claudeAcquisitionAdapter } from "./runtime-acquisition";

describe("claudeAcquisitionAdapter", () => {
  it("rejects a different conversation and accepts the current full response", async () => {
    const latest = vi.fn().mockResolvedValue({
      observation: {
        observationId: "observation-claude",
        providerId: "claude",
        endpointId: "claude-conversation",
        url: "https://claude.ai/api/organizations/org/chat_conversations/conversation-1/",
        method: "GET",
        observedAt: "2026-09-01T10:00:01.000Z",
      },
      payload: {
        chat_messages: [
          { uuid: "user", sender: "human", content: [{ type: "text", text: "Question" }] },
          {
            uuid: "assistant",
            sender: "assistant",
            content: [{ type: "text", text: "Answer" }],
          },
        ],
      },
    });
    const network = { latest, replay: vi.fn(), fetchJson: vi.fn() } as AcquisitionNetworkClient;
    const acquire = claudeAcquisitionAdapter.strategiesByPriority[0]!.acquire;

    await expect(
      acquire({
        providerId: "claude",
        data: {
          url: "https://claude.ai/chat/conversation-other",
          acquisitionObservedAfter: Date.parse("2026-09-01T10:00:00.000Z"),
          network,
        },
      }),
    ).resolves.toBeUndefined();

    const snapshot = await acquire({
      providerId: "claude",
      data: {
        url: "https://claude.ai/chat/conversation-1",
        acquisitionObservedAfter: Date.parse("2026-09-01T10:00:00.000Z"),
        network,
      },
    });
    expect(snapshot?.completeness.state).toBe("complete");
    expect(snapshot?.messages.at(-1)?.id).toBe("assistant");
  });
});
