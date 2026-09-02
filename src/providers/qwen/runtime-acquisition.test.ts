import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  acquireConversation,
  type AcquisitionContext,
  type AcquisitionSelectionError,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { qwenAcquisitionAdapter, qwenResultToSnapshot } from "./runtime-acquisition";
import { parseQwenConversation } from "./acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/qwen/fixtures/${name}`, "utf8")) as unknown;
}

function observation(method = "GET") {
  return {
    observationId: `qwen-${method.toLocaleLowerCase()}`,
    providerId: "qwen" as const,
    endpointId: "qwen-conversation" as const,
    url: "https://www.qianwen.com/api/v2/conversation/qwen-chat-fixture",
    method,
    body: { conversation_id: "qwen-chat-fixture" },
    observedAt: "2026-09-01T00:00:00.000Z",
  };
}

function context(
  network: AcquisitionNetworkClient,
  data: Readonly<Record<string, unknown>> = {},
): AcquisitionContext {
  return {
    providerId: "qwen",
    data: {
      network,
      url: "https://www.qianwen.com/conversation/qwen-chat-fixture",
      ...data,
    },
  };
}

function networkClient(overrides: Partial<AcquisitionNetworkClient>): AcquisitionNetworkClient {
  return {
    latest: vi.fn(async () => ({})),
    replay: vi.fn(async () => ({})),
    fetchJson: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("qwenAcquisitionAdapter", () => {
  it("uses an already observed JSON payload without replaying the request", async () => {
    const replay = vi.fn(async () => ({}));
    const network = networkClient({
      latest: vi.fn(async () => ({
        observation: observation(),
        payload: fixture("acquisition-conversation-detail.json"),
        status: 200,
      })),
      replay,
    });

    const selected = await acquireConversation(qwenAcquisitionAdapter, context(network));

    expect(selected.snapshot.completeness.state).toBe("complete");
    expect(selected.snapshot.messages.at(-1)?.id).toBe("assistant-current");
    expect(selected.snapshot.source).toBe("provider-api");
    expect(replay).not.toHaveBeenCalled();
  });

  it("replays an observed GET when its original payload was unavailable", async () => {
    const replay = vi.fn(async () => ({
      payload: fixture("acquisition-conversation-detail.json"),
      status: 200,
    }));
    const network = networkClient({
      latest: vi.fn(async () => ({ observation: observation("GET") })),
      replay,
    });

    const selected = await acquireConversation(qwenAcquisitionAdapter, context(network));

    expect(selected.snapshot.messages).toHaveLength(4);
    expect(replay).toHaveBeenCalledWith("qwen-get");
  });

  it("never replays a POST observation that could submit or mutate a chat", async () => {
    const replay = vi.fn(async () => ({
      payload: fixture("acquisition-conversation-detail.json"),
    }));
    const network = networkClient({
      latest: vi.fn(async () => ({ observation: observation("POST") })),
      replay,
    });
    const strategy = qwenAcquisitionAdapter.strategiesByPriority[0]!;

    await expect(strategy.acquire(context(network))).resolves.toBeUndefined();
    expect(replay).not.toHaveBeenCalled();
  });

  it("rejects observations captured before the current submission boundary", async () => {
    const replay = vi.fn(async () => ({
      payload: fixture("acquisition-conversation-detail.json"),
    }));
    const network = networkClient({
      latest: vi.fn(async () => ({ observation: observation("GET") })),
      replay,
    });
    const strategy = qwenAcquisitionAdapter.strategiesByPriority[0]!;

    await expect(
      strategy.acquire(
        context(network, {
          acquisitionObservedAfter: Date.parse("2026-09-01T00:00:00.001Z"),
        }),
      ),
    ).resolves.toBeUndefined();
    expect(replay).not.toHaveBeenCalled();
  });

  it("rejects a complete payload belonging to another conversation", async () => {
    const payload = fixture("acquisition-conversation-detail.json") as Record<string, unknown>;
    const network = networkClient({
      latest: vi.fn(async () => ({
        observation: {
          ...observation(),
          url: "https://www.qianwen.com/api/v2/conversation/other-chat",
          body: { conversation_id: "other-chat" },
        },
        payload,
        status: 200,
      })),
    });
    const strategy = qwenAcquisitionAdapter.strategiesByPriority[0]!;

    await expect(strategy.acquire(context(network))).resolves.toBeUndefined();
  });

  it("lets the engine reject partial API history so native Copy or DOM can run", async () => {
    const network = networkClient({
      latest: vi.fn(async () => ({
        observation: observation(),
        payload: fixture("acquisition-conversation-partial.json"),
        status: 200,
      })),
    });

    await expect(acquireConversation(qwenAcquisitionAdapter, context(network))).rejects.toEqual(
      expect.objectContaining({
        name: "AcquisitionSelectionError",
        attempts: [
          expect.objectContaining({
            status: "rejected",
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "INCOMPLETE_SNAPSHOT" }),
            ]),
          }),
        ],
      }) satisfies Partial<AcquisitionSelectionError>,
    );
  });

  it("maps parser evidence to the canonical snapshot contract", () => {
    const snapshot = qwenResultToSnapshot(
      parseQwenConversation(fixture("acquisition-conversation-alternate.json")),
      "https://www.qianwen.com/conversation/alternate-chat",
      "alternate-chat",
    );

    expect(snapshot).toMatchObject({
      providerId: "qwen",
      conversationId: "alternate-chat",
      source: "provider-api",
      completeness: {
        state: "complete",
        capturedMessageCount: 2,
        expectedMessageCount: 2,
        hasBeginning: true,
        hasEnd: true,
      },
      evidence: {
        cursor: { hasMore: false, reachedStart: true, reachedEnd: true },
        branch: { linearized: true, complete: true },
      },
    });
  });
});
