import { describe, expect, it, vi } from "vitest";
import type {
  AcquisitionStrategy,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "./contracts";
import { acquireConversation, AcquisitionSelectionError } from "./engine";

describe("acquireConversation", () => {
  it("falls back when a higher-priority strategy captures only the title", async () => {
    const titleOnly = snapshot("native", "native-copy", "# 你好", { title: "你好" });
    const full = snapshot("virtual", "virtual-dom", "哈哈，我正在全力以赴地陪你聊天呢！");
    const adapter = providerAdapter([
      strategy("native", "native-copy", titleOnly),
      strategy("virtual", "virtual-dom", full),
    ]);

    const result = await acquireConversation(adapter, { providerId: "deepseek" });

    expect(result.snapshot).toBe(full);
    expect(result.selectedStrategyId).toBe("virtual");
    expect(result.attempts.map(({ strategyId, status }) => ({ strategyId, status }))).toEqual([
      { strategyId: "native", status: "rejected" },
      { strategyId: "virtual", status: "selected" },
    ]);
    expect(result.attempts[0]?.diagnostics.map((entry) => entry.code)).toContain("TITLE_ONLY");
  });

  it("returns the first passing snapshot without invoking or blending lower priorities", async () => {
    const preferred = snapshot("api", "provider-api", "provider API answer");
    const lower = snapshot("dom", "dom", "unrelated DOM answer");
    const lowerAcquire = vi.fn(async () => lower);
    const adapter = providerAdapter([
      strategy("api", "provider-api", preferred),
      { id: "dom", source: "dom", acquire: lowerAcquire },
    ]);

    const result = await acquireConversation(adapter, { providerId: "deepseek" });

    expect(result.snapshot).toBe(preferred);
    expect(result.snapshot.messages).toEqual(preferred.messages);
    expect(result.attempts).toHaveLength(1);
    expect(lowerAcquire).not.toHaveBeenCalled();
  });

  it("rejects a candidate whose declared source does not match its snapshot", async () => {
    const invalid = snapshot("network", "dom", "valid-looking text");
    const fallback = snapshot("dom", "dom", "fallback text");
    const adapter = providerAdapter([
      strategy("network", "network", invalid),
      strategy("dom", "dom", fallback),
    ]);

    const result = await acquireConversation(adapter, { providerId: "deepseek" });

    expect(result.snapshot).toBe(fallback);
    expect(result.attempts[0]?.diagnostics.map((entry) => entry.code)).toContain("SOURCE_MISMATCH");
  });

  it("reports every failed strategy when no candidate passes", async () => {
    const adapter = providerAdapter([
      strategy("native", "native-copy", undefined),
      strategy("dom", "dom", snapshot("dom", "dom", "已完成")),
    ]);

    const failure = await acquireConversation(adapter, { providerId: "deepseek" }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AcquisitionSelectionError);
    expect(
      (failure as AcquisitionSelectionError).attempts.map((attempt) => attempt.status),
    ).toEqual(["unavailable", "rejected"]);
  });
});

function providerAdapter(
  strategiesByPriority: readonly AcquisitionStrategy[],
): ProviderAcquisitionAdapter {
  return { providerId: "deepseek", strategiesByPriority };
}

function strategy(
  id: string,
  source: AcquisitionStrategy["source"],
  result: ConversationSnapshot | undefined,
): AcquisitionStrategy {
  return { id, source, acquire: vi.fn(async () => result) };
}

function snapshot(
  strategyId: string,
  source: ConversationSnapshot["source"],
  text: string,
  extras: Partial<ConversationSnapshot> = {},
): ConversationSnapshot {
  return {
    schemaVersion: 1,
    providerId: "deepseek",
    capturedAt: 1,
    messages: [
      { id: `${strategyId}-message`, role: "assistant", content: [{ kind: "paragraph", text }] },
    ],
    source,
    completeness: {
      state: "complete",
      capturedMessageCount: 1,
      capturedContentChars: text.length,
      hasBeginning: true,
      hasEnd: true,
    },
    evidence: { stableMessageKeys: [`${strategyId}-message`], signals: [] },
    diagnostics: { strategyId, entries: [] },
    ...extras,
  };
}
