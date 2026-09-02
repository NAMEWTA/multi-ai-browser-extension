import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDeepSeekHistory } from "./acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/deepseek/fixtures/${name}`, "utf8")) as unknown;
}

describe("parseDeepSeekHistory", () => {
  it("selects the current parent-linked branch and excludes THINK fragments", () => {
    const parsed = parseDeepSeekHistory(fixture("acquisition-history-fragments.json"));

    expect(parsed.source).toBe("conversation-api");
    expect(parsed.completeness).toBe("verified");
    expect(parsed.messages.map((message) => message.providerMessageId)).toEqual([
      "1",
      "2",
      "3",
      "5",
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
    expect(JSON.stringify(parsed.messages)).not.toContain("private");
    expect(JSON.stringify(parsed.messages)).not.toContain("Inactive sibling");
    expect(parsed.evidence).toEqual({
      cursorExhausted: true,
      branchRootVerified: true,
      capturedCount: 4,
      stopReason: "complete",
      pageCount: 1,
      currentMessageId: "5",
    });
  });

  it("accepts a legacy messages envelope and infers a single bounded chain", () => {
    const parsed = parseDeepSeekHistory(fixture("acquisition-history-legacy.json"));

    expect(parsed.completeness).toBe("bounded");
    expect(parsed.messages.map((message) => message.providerMessageId)).toEqual([
      "root-user",
      "leaf-assistant",
    ]);
    expect(parsed.messages[1]?.content[0]?.text).toBe("Legacy **answer**");
    expect(parsed.evidence.branchRootVerified).toBe(true);
    expect(parsed.evidence.stopReason).toBe("complete");
  });

  it("marks a missing declared active message partial without discarding parsed evidence", () => {
    const parsed = parseDeepSeekHistory({
      data: {
        biz_data: {
          current_message_id: "not-present",
          chat_messages: [
            {
              message_id: "known",
              role: "ASSISTANT",
              fragments: [{ type: "RESPONSE", content: "Recovered answer" }],
            },
          ],
        },
      },
    });

    expect(parsed.completeness).toBe("partial");
    expect(parsed.messages[0]?.content[0]?.text).toBe("Recovered answer");
    expect(parsed.evidence).toMatchObject({
      branchRootVerified: false,
      capturedCount: 1,
      stopReason: "missing-active-message",
    });
  });

  it("detects a broken parent chain as partial", () => {
    const parsed = parseDeepSeekHistory({
      current_message_id: "answer",
      messages: [
        {
          id: "answer",
          parent_id: "missing-parent",
          role: "assistant",
          content: "Still useful",
        },
      ],
    });

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.completeness).toBe("partial");
    expect(parsed.evidence.stopReason).toBe("broken-parent-chain");
    expect(parsed.evidence.branchRootVerified).toBe(false);
  });

  it("returns unknown evidence for an unsupported envelope", () => {
    expect(parseDeepSeekHistory({ data: { answer: "not a history response" } })).toEqual({
      source: "conversation-api",
      completeness: "unknown",
      messages: [],
      evidence: {
        cursorExhausted: true,
        branchRootVerified: false,
        capturedCount: 0,
        stopReason: "invalid-envelope",
        pageCount: 1,
      },
    });
  });
});
