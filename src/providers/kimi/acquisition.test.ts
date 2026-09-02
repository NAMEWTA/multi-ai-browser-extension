import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createKimiPaginationState, parseKimiMessagesPage } from "./acquisition";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`src/providers/kimi/fixtures/${name}`, "utf8")) as unknown;
}

describe("Kimi ListMessages JSON acquisition", () => {
  it("paginates to an explicit terminal cursor and restores the parent-linked turn order", () => {
    const first = parseKimiMessagesPage(
      fixture("acquisition-list-messages-page-1.json"),
      createKimiPaginationState(),
    );

    expect(first.nextCursor).toBe("older-page");
    expect(first.result).toMatchObject({
      source: "conversation-api",
      completeness: "bounded",
      evidence: {
        cursorExhausted: false,
        branchRootVerified: false,
        expectedCount: 4,
        capturedCount: 2,
        stopReason: "has-more",
        pageCount: 1,
      },
    });

    const completed = parseKimiMessagesPage(
      fixture("acquisition-list-messages-page-2.json"),
      first.state,
      first.nextCursor,
    );

    expect(completed.nextCursor).toBeUndefined();
    expect(completed.result.completeness).toBe("verified");
    expect(completed.result.messages.map((message) => message.providerMessageId)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
    ]);
    expect(completed.result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(completed.result.messages[1]?.content[0]?.text).toBe(
      "First answer belongs only to the first prompt.",
    );
    expect(completed.result.messages[3]?.content[0]?.text).toBe(
      "Second answer belongs only to the second prompt.",
    );
    expect(JSON.stringify(completed.result.messages)).not.toContain("Internal reasoning");
    expect(completed.result.evidence).toEqual({
      cursorExhausted: true,
      branchRootVerified: true,
      expectedCount: 4,
      capturedCount: 4,
      stopReason: "complete",
      pageCount: 2,
      currentMessageId: "assistant-2",
    });
  });

  it("stops before parsing a repeated request cursor", () => {
    const first = parseKimiMessagesPage(
      fixture("acquisition-list-messages-page-1.json"),
      createKimiPaginationState(),
      "same-cursor",
    );
    const repeated = parseKimiMessagesPage(
      fixture("acquisition-list-messages-page-2.json"),
      first.state,
      "same-cursor",
    );

    expect(repeated.result).toMatchObject({
      completeness: "partial",
      evidence: {
        stopReason: "duplicate-cursor",
        pageCount: 1,
        capturedCount: 2,
      },
    });
    expect(repeated.result.messages).toEqual(first.result.messages);
  });

  it("detects the same page returned under a different token", () => {
    const page = fixture("acquisition-list-messages-page-1.json");
    const first = parseKimiMessagesPage(page, createKimiPaginationState());
    const repeated = parseKimiMessagesPage(page, first.state, "different-token");

    expect(repeated.result.completeness).toBe("partial");
    expect(repeated.result.evidence.stopReason).toBe("duplicate-page");
    expect(repeated.result.messages).toEqual(first.result.messages);
  });

  it("does not infer exhaustion when the response omits terminal cursor evidence", () => {
    const payload = fixture("acquisition-list-messages-page-2.json") as Record<string, unknown>;
    const withoutCursor = { ...payload };
    delete withoutCursor.nextPageToken;

    const parsed = parseKimiMessagesPage(withoutCursor, createKimiPaginationState());
    expect(parsed.result.completeness).toBe("partial");
    expect(parsed.result.evidence.stopReason).toBe("missing-next-cursor");
  });

  it("marks a second user turn without its assistant reply partial", () => {
    const parsed = parseKimiMessagesPage(
      {
        messages: [
          message("user-2", "assistant-1", "ROLE_USER", "second prompt", "10:02:00"),
          message("assistant-1", "user-1", "ROLE_ASSISTANT", "first answer", "10:01:00"),
          message("user-1", "", "ROLE_USER", "first prompt", "10:00:00"),
        ],
        nextPageToken: "",
      },
      createKimiPaginationState(),
    );

    expect(parsed.result.completeness).toBe("partial");
    expect(parsed.result.evidence).toMatchObject({
      stopReason: "invalid-role-order",
      currentMessageId: "user-2",
    });
    expect(parsed.result.messages.at(-1)?.providerMessageId).toBe("user-2");
    expect(parsed.result.messages.at(-1)?.content[0]?.text).toBe("second prompt");
  });

  it("rejects a conflicting stable message identity across pages", () => {
    const first = parseKimiMessagesPage(
      {
        messages: [message("assistant-2", "user-2", "ROLE_ASSISTANT", "first body", "10:03:00")],
        nextPageToken: "older",
      },
      createKimiPaginationState(),
    );
    const conflict = parseKimiMessagesPage(
      {
        messages: [message("assistant-2", "user-2", "ROLE_ASSISTANT", "changed body", "10:03:00")],
        nextPageToken: "",
      },
      first.state,
      first.nextCursor,
    );

    expect(conflict.result.completeness).toBe("partial");
    expect(conflict.result.evidence.stopReason).toBe("conflicting-message");
    expect(conflict.result.messages[0]?.content[0]?.text).toBe("first body");
  });

  it("bounds replay even when every page advertises another token", () => {
    const limited = parseKimiMessagesPage(
      fixture("acquisition-list-messages-page-1.json"),
      createKimiPaginationState({ maxPages: 1 }),
    );

    expect(limited.nextCursor).toBeUndefined();
    expect(limited.result.completeness).toBe("partial");
    expect(limited.result.evidence.stopReason).toBe("max-pages");
  });

  it("does not synthesize an ID for an unstable message", () => {
    const parsed = parseKimiMessagesPage(
      {
        messages: [
          {
            role: "ROLE_ASSISTANT",
            status: "MESSAGE_STATUS_FINISHED",
            blocks: [{ text: { content: "unidentifiable answer" } }],
          },
        ],
        nextPageToken: "",
      },
      createKimiPaginationState(),
    );

    expect(parsed.result.messages).toEqual([]);
    expect(parsed.result.completeness).toBe("unknown");
    expect(parsed.result.evidence.stopReason).toBe("unstable-message");
  });
});

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
    blocks: [{ id: `block-${id}`, messageId: id, text: { content: text } }],
  };
}
