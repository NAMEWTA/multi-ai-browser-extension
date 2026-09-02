import { describe, expect, it } from "vitest";
import { parseClaudeConversation } from "./acquisition";

describe("parseClaudeConversation", () => {
  it("keeps ordered user and assistant text while excluding thinking blocks", () => {
    const snapshot = parseClaudeConversation(
      {
        name: "Conversation",
        chat_messages: [
          {
            uuid: "user-1",
            sender: "human",
            created_at: "2026-09-01T10:00:00.000Z",
            content: [{ type: "text", text: "Question" }],
          },
          {
            uuid: "assistant-1",
            sender: "assistant",
            created_at: "2026-09-01T10:00:01.000Z",
            content: [
              { type: "thinking", text: "Private reasoning" },
              { type: "text", text: "First paragraph." },
              { type: "text", text: "Final paragraph." },
            ],
          },
        ],
      },
      "conversation-1",
    );

    expect(snapshot.completeness.state).toBe("complete");
    expect(snapshot.messages.map(({ id }) => id)).toEqual(["user-1", "assistant-1"]);
    expect(snapshot.messages[1]?.content[0]?.text).toBe("First paragraph.\n\nFinal paragraph.");
    expect(snapshot.messages[1]?.content[0]?.text).not.toContain("Private reasoning");
  });
});
