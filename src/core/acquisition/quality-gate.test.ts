import { describe, expect, it } from "vitest";
import type { ConversationSnapshot, Message } from "./contracts";
import { evaluateAcquisitionQuality } from "./quality-gate";

describe("evaluateAcquisitionQuality", () => {
  it("rejects an empty assistant body", () => {
    const report = evaluateAcquisitionQuality(snapshot({ messages: [message("assistant", "")] }));

    expect(report.accepted).toBe(false);
    expect(codes(report)).toContain("EMPTY_BODY");
  });

  it("rejects a heading that only repeats the conversation title", () => {
    const report = evaluateAcquisitionQuality(
      snapshot({
        title: "你好",
        messages: [message("assistant", "# 你好", "heading")],
      }),
    );

    expect(report.accepted).toBe(false);
    expect(codes(report)).toContain("TITLE_ONLY");
  });

  it("rejects provider status text as an answer", () => {
    const report = evaluateAcquisitionQuality(
      snapshot({ messages: [message("assistant", "已停止")] }),
    );

    expect(report.accepted).toBe(false);
    expect(codes(report)).toContain("STATUS_ONLY");
  });

  it("rejects provider-reported message and content shortfalls", () => {
    const report = evaluateAcquisitionQuality(
      snapshot({
        messages: [message("assistant", "short")],
        completeness: {
          state: "partial",
          capturedMessageCount: 1,
          expectedMessageCount: 3,
          capturedContentChars: 5,
          expectedContentChars: 100,
        },
      }),
      { minimumMessageRatio: 0.8, minimumContentRatio: 0.8 },
    );

    expect(codes(report)).toEqual(
      expect.arrayContaining(["MESSAGE_SHORTFALL", "CONTENT_SHORTFALL"]),
    );
  });

  it("rejects cursor and branch evidence that contradict completeness", () => {
    const report = evaluateAcquisitionQuality(
      snapshot({
        messages: [message("assistant", "A complete-looking answer")],
        completeness: {
          state: "complete",
          capturedMessageCount: 1,
          capturedContentChars: 25,
          hasBeginning: true,
          hasEnd: true,
        },
        evidence: {
          stableMessageKeys: ["message-1"],
          signals: [],
          cursor: { hasMore: true, reachedStart: true, reachedEnd: false },
          branch: {
            currentNodeId: "missing-current-node",
            capturedNodeIds: [],
            linearized: false,
            complete: false,
          },
        },
      }),
      { requireTerminalCursor: true, requireBranchEvidence: true },
    );

    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "CURSOR_INCOMPLETE",
        "CURSOR_BOUNDARY_MISSING",
        "BRANCH_INCOMPLETE",
        "BRANCH_NOT_LINEARIZED",
        "BRANCH_CURRENT_NODE_MISSING",
      ]),
    );
  });

  it("accepts a non-empty snapshot with coherent terminal evidence", () => {
    const report = evaluateAcquisitionQuality(
      snapshot({
        messages: [message("assistant", "The full answer is available here.")],
        evidence: {
          stableMessageKeys: ["message-1"],
          signals: ["provider-finished"],
          cursor: { hasMore: false, reachedStart: true, reachedEnd: true },
          branch: {
            currentNodeId: "message-1",
            capturedNodeIds: ["message-1"],
            linearized: true,
            complete: true,
          },
        },
      }),
      { requireComplete: true, requireTerminalCursor: true, requireBranchEvidence: true },
    );

    expect(report).toEqual({ accepted: true, diagnostics: [] });
  });
});

function snapshot(
  overrides: Partial<ConversationSnapshot> & Pick<ConversationSnapshot, "messages">,
): ConversationSnapshot {
  return {
    schemaVersion: 1,
    providerId: "deepseek",
    capturedAt: 1,
    source: "dom",
    completeness: {
      state: "complete",
      capturedMessageCount: overrides.messages.length,
      capturedContentChars: overrides.messages.reduce(
        (total, item) => total + item.content.reduce((sum, block) => sum + block.text.length, 0),
        0,
      ),
      hasBeginning: true,
      hasEnd: true,
    },
    evidence: { stableMessageKeys: ["message-1"], signals: [] },
    diagnostics: { strategyId: "dom", entries: [] },
    ...overrides,
  };
}

function message(
  role: Message["role"],
  text: string,
  kind: Message["content"][number]["kind"] = "paragraph",
): Message {
  return { id: "message-1", role, content: [{ kind, text }] };
}

function codes(report: ReturnType<typeof evaluateAcquisitionQuality>): string[] {
  return report.diagnostics.map((entry) => entry.code);
}
