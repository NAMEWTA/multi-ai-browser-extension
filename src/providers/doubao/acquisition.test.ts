import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDoubaoPaginationState, parseDoubaoChainPage } from "./acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/doubao/fixtures/${name}`, "utf8")) as unknown;
}

describe("Doubao conversation API acquisition", () => {
  it("collects `/im/chain/single` pages until the cursor is exhausted", () => {
    const first = parseDoubaoChainPage(
      fixture("acquisition-chain-page-1.json"),
      createDoubaoPaginationState(),
      6,
    );

    expect(first.nextCursor).toBe("4");
    expect(first.result.completeness).toBe("bounded");
    expect(first.result.evidence).toMatchObject({
      cursorExhausted: false,
      branchRootVerified: false,
      expectedCount: 6,
      capturedCount: 2,
      stopReason: "has-more",
      pageCount: 1,
    });
    expect(JSON.stringify(first.result.messages)).not.toContain("private reasoning");

    const completed = parseDoubaoChainPage(
      fixture("acquisition-chain-page-2.json"),
      first.state,
      first.nextCursor,
    );

    expect(completed.nextCursor).toBeUndefined();
    expect(completed.result.source).toBe("conversation-api");
    expect(completed.result.completeness).toBe("verified");
    expect(completed.result.messages.map((message) => message.providerMessageId)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
    ]);
    expect(completed.result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(completed.result.messages[3]?.content[0]?.text).toBe("Second answer");
    expect(completed.result.messages[5]?.content[0]?.text).toBe(
      "## Latest answer\n\nFinal paragraph.",
    );
    expect(completed.result.evidence).toEqual({
      cursorExhausted: true,
      branchRootVerified: true,
      expectedCount: 6,
      capturedCount: 6,
      stopReason: "complete",
      pageCount: 2,
    });
  });

  it("terminates on a repeated request cursor without mixing another source", () => {
    const first = parseDoubaoChainPage(
      fixture("acquisition-chain-page-1.json"),
      createDoubaoPaginationState(),
      "latest",
    );
    const repeated = parseDoubaoChainPage(
      fixture("acquisition-chain-page-2.json"),
      first.state,
      "latest",
    );

    expect(repeated.nextCursor).toBeUndefined();
    expect(repeated.result).toMatchObject({
      source: "conversation-api",
      completeness: "partial",
      evidence: {
        cursorExhausted: false,
        branchRootVerified: false,
        capturedCount: 2,
        stopReason: "duplicate-cursor",
        pageCount: 1,
      },
    });
    expect(repeated.result.messages).toEqual(first.result.messages);
  });

  it("detects a response that points back to the current cursor", () => {
    const repeated = parseDoubaoChainPage(
      {
        pull_single_chain_downlink_body: {
          has_more: true,
          next_index_in_conv: 10,
          messages: [
            {
              message_id: "answer-10",
              index_in_conv: 10,
              role: "assistant",
              content: "Useful partial answer",
            },
          ],
        },
      },
      createDoubaoPaginationState(),
      10,
    );

    expect(repeated.result.completeness).toBe("partial");
    expect(repeated.result.evidence.stopReason).toBe("duplicate-cursor");
    expect(repeated.result.messages[0]?.content[0]?.text).toBe("Useful partial answer");
  });

  it("preserves prior API pages when a later page has an invalid envelope", () => {
    const first = parseDoubaoChainPage(
      fixture("acquisition-chain-page-1.json"),
      createDoubaoPaginationState(),
      6,
    );
    const invalid = parseDoubaoChainPage({ unexpected: true }, first.state, first.nextCursor);

    expect(invalid.result.completeness).toBe("partial");
    expect(invalid.result.messages).toEqual(first.result.messages);
    expect(invalid.result.evidence).toMatchObject({
      stopReason: "invalid-page",
      pageCount: 2,
      capturedCount: 2,
    });
  });

  it("bounds pagination and keeps the page captured at the configured limit", () => {
    const limited = parseDoubaoChainPage(
      fixture("acquisition-chain-page-1.json"),
      createDoubaoPaginationState({ maxPages: 1 }),
      6,
    );

    expect(limited.result.completeness).toBe("partial");
    expect(limited.result.messages).toHaveLength(2);
    expect(limited.result.evidence.stopReason).toBe("max-pages");
  });
});
