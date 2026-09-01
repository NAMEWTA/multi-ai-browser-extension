import { describe, expect, it } from "vitest";
import { providerResponseUpdateSchema } from "./protocol";

describe("provider response Markdown protocol", () => {
  it("accepts a bounded Markdown snapshot", () => {
    const parsed = providerResponseUpdateSchema.parse({
      type: "PROVIDER_RESPONSE_UPDATE",
      panelId: "panel-qwen",
      providerId: "qwen",
      sessionId: "session-1",
      turnId: "turn-1",
      captureId: "capture-1",
      revision: 3,
      observedAt: "2026-09-01T08:00:00.000Z",
      status: "completed",
      terminalReason: "completed",
      text: "Title",
      markdown: "# Title",
    });

    expect(parsed.markdown).toBe("# Title");
  });
});
