import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseQwenConversation } from "./acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/qwen/fixtures/${name}`, "utf8")) as unknown;
}

describe("parseQwenConversation", () => {
  it("linearizes the declared active branch from a Qwen chat detail map", () => {
    const parsed = parseQwenConversation(fixture("acquisition-conversation-detail.json"));

    expect(parsed.source).toBe("conversation-api");
    expect(parsed.completeness).toBe("verified");
    expect(parsed.conversationId).toBe("qwen-chat-fixture");
    expect(parsed.title).toBe("Qwen fixture conversation");
    expect(parsed.messages.map((message) => message.providerMessageId)).toEqual([
      "user-root",
      "assistant-first",
      "user-current",
      "assistant-current",
    ]);
    expect(parsed.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(parsed.messages.at(-1)?.content[0]?.text).toBe(
      "## Current answer\n\n- first\n- second\n- final",
    );
    expect(JSON.stringify(parsed.messages)).not.toContain("private reasoning");
    expect(JSON.stringify(parsed.messages)).not.toContain("hidden thought");
    expect(JSON.stringify(parsed.messages)).not.toContain("Inactive branch");
    expect(parsed.evidence).toEqual({
      cursorExhausted: true,
      branchRootVerified: true,
      capturedCount: 4,
      stopReason: "complete",
      currentMessageId: "assistant-current",
    });
  });

  it("accepts alternate result.conversation envelopes and structured content", () => {
    const parsed = parseQwenConversation(fixture("acquisition-conversation-alternate.json"));

    expect(parsed.completeness).toBe("verified");
    expect(parsed.messages.map((message) => message.providerMessageId)).toEqual([
      "alternate-user",
      "alternate-answer",
    ]);
    expect(parsed.messages[1]?.content[0]?.text).toBe("Alternate **answer**");
    expect(parsed.evidence).toMatchObject({
      cursorExhausted: true,
      branchRootVerified: true,
      expectedCount: 2,
      stopReason: "complete",
    });
  });

  it("marks paginated generic envelopes partial so another source can run", () => {
    const parsed = parseQwenConversation(fixture("acquisition-conversation-partial.json"));

    expect(parsed.completeness).toBe("partial");
    expect(parsed.messages.map((message) => message.providerMessageId)).toEqual([
      "partial-user",
      "partial-answer",
    ]);
    expect(parsed.evidence).toMatchObject({
      cursorExhausted: false,
      branchRootVerified: false,
      stopReason: "has-more",
    });
  });

  it("preserves ordered turn records but does not claim branch completeness", () => {
    const parsed = parseQwenConversation({
      data: {
        records: [
          {
            request_id: "turn-1",
            sequence: 1,
            question: "Question one",
            answer: "Answer one",
          },
          {
            request_id: "turn-2",
            sequence: 2,
            question: "Question two",
            response: { content: "Answer two" },
          },
        ],
        has_more: false,
      },
    });

    expect(parsed.messages.map((message) => [message.role, message.content[0]?.text])).toEqual([
      ["user", "Question one"],
      ["assistant", "Answer one"],
      ["user", "Question two"],
      ["assistant", "Answer two"],
    ]);
    expect(parsed.completeness).toBe("partial");
    expect(parsed.evidence.stopReason).toBe("ambiguous-branch");
  });

  it("refuses to verify messages without provider or map identities", () => {
    const parsed = parseQwenConversation({
      data: {
        chat: {
          history: {
            current_id: "qwen-envelope-index:0",
            messages: [{ role: "assistant", content: "Anonymous answer" }],
          },
        },
      },
    });

    expect(parsed.messages[0]?.providerMessageId).toBe("qwen-envelope-index:0");
    expect(parsed.completeness).toBe("partial");
    expect(parsed.evidence.stopReason).toBe("unstable-message-id");
  });

  it("reports provider errors and unsupported envelopes without fabricating messages", () => {
    expect(parseQwenConversation({ success: false, message: "not found" })).toMatchObject({
      completeness: "unknown",
      messages: [],
      evidence: { stopReason: "provider-error" },
    });
    expect(parseQwenConversation({ data: { title: "No messages" } })).toMatchObject({
      completeness: "unknown",
      messages: [],
      evidence: { stopReason: "invalid-envelope" },
    });
  });
});
