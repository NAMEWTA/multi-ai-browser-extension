import { describe, expect, it } from "vitest";
import { parseChatGptConversation } from "./acquisition";

describe("parseChatGptConversation", () => {
  it("linearizes only the active branch and preserves the complete assistant body", () => {
    const snapshot = parseChatGptConversation(
      {
        current_node: "assistant-current",
        mapping: {
          root: { id: "root", parent: null, message: null },
          user: {
            id: "user",
            parent: "root",
            message: { author: { role: "user" }, content: { parts: ["Question"] } },
          },
          "assistant-old": {
            id: "assistant-old",
            parent: "user",
            message: { author: { role: "assistant" }, content: { parts: ["Old branch"] } },
          },
          "assistant-current": {
            id: "assistant-current",
            parent: "user",
            message: {
              author: { role: "assistant" },
              content: { parts: ["First paragraph.", "Final paragraph."] },
            },
          },
        },
      },
      "conversation-1",
    );

    expect(snapshot.completeness.state).toBe("complete");
    expect(snapshot.messages.map(({ id }) => id)).toEqual(["user", "assistant-current"]);
    expect(snapshot.messages[1]?.content[0]?.text).toBe("First paragraph.\n\nFinal paragraph.");
    expect(snapshot.evidence.branch).toMatchObject({
      currentNodeId: "assistant-current",
      linearized: true,
      complete: true,
    });
  });
});
