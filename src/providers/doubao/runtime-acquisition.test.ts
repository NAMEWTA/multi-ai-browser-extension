import { describe, expect, it, vi } from "vitest";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { doubaoAcquisitionAdapter } from "./runtime-acquisition";

describe("doubaoAcquisitionAdapter", () => {
  it("does not replay an observation from a different conversation", async () => {
    const replay = vi.fn();
    const network = {
      latest: vi.fn().mockResolvedValue({
        observation: {
          observationId: "observation-doubao",
          providerId: "doubao",
          endpointId: "doubao-chain",
          url: "https://www.doubao.com/im/chain/single",
          method: "POST",
          body: { conversation_id: "conversation-old", anchor: 10 },
          observedAt: "2026-09-01T10:00:01.000Z",
        },
      }),
      replay,
      fetchJson: vi.fn(),
    } as AcquisitionNetworkClient;

    await expect(
      doubaoAcquisitionAdapter.strategiesByPriority[0]!.acquire({
        providerId: "doubao",
        data: {
          url: "https://www.doubao.com/chat/conversation-current",
          acquisitionObservedAfter: Date.parse("2026-09-01T10:00:00.000Z"),
          network,
        },
      }),
    ).resolves.toBeUndefined();
    expect(replay).not.toHaveBeenCalled();
  });
});
