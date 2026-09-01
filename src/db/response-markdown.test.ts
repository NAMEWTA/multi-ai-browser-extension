import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import { exportHistoryJsonl, importHistoryJsonl } from "./history-transfer";
import {
  applyResponseUpdate,
  createSession,
  getSessionDetail,
  recordSuccessfulTurn,
} from "./session-service";

describe("turn prompt metadata and Markdown responses", () => {
  beforeEach(async () => {
    await Promise.all([
      db.sessions.clear(),
      db.turns.clear(),
      db.exchanges.clear(),
      db.metadata.clear(),
    ]);
  });

  it("keeps the original question, prompt snapshots and both response formats", async () => {
    const session = await createSession();
    const turn = await recordSuccessfulTurn(
      session.id,
      "Style\nBe concise.\n\n用户\nWhat is Go?",
      [
        {
          panelId: "panel-qwen",
          providerId: "qwen",
          providerName: "通义千问",
        },
      ],
      [{ panelId: "panel-qwen", status: "submitted" }],
      [],
      "turn-markdown",
      {
        userQuestion: "What is Go?",
        appliedPromptTemplates: [
          { id: "prompt-style", name: "Style", content: "Be concise.", order: 0 },
        ],
      },
    );

    await applyResponseUpdate(
      turn.id,
      "panel-qwen",
      "completed",
      "Go is a language.",
      undefined,
      "## Go\n\nGo is a **language**.",
      {
        captureId: "capture-native",
        revision: 1,
        observedAt: "2026-09-01T08:00:00.000Z",
        terminalReason: "completed",
        captureSource: "native-copy",
        nativeMimeType: "text/markdown",
      },
    );

    const detail = await getSessionDetail(session.id);
    expect(detail?.session.title).toBe("What is Go?");
    expect(detail?.turns[0]?.turn).toMatchObject({
      userQuestion: "What is Go?",
      appliedPromptTemplates: [{ name: "Style", content: "Be concise.", order: 0 }],
    });
    expect(detail?.turns[0]?.exchanges[0]).toMatchObject({
      responseText: "Go is a language.",
      responseMarkdown: "## Go\n\nGo is a **language**.",
      captureSource: "native-copy",
      nativeMimeType: "text/markdown",
    });
  });

  it("round-trips prompt snapshots and Markdown through history JSONL", async () => {
    const session = await createSession();
    const turn = await recordSuccessfulTurn(
      session.id,
      "Review\nCheck correctness.\n\n用户\nReview this code",
      [{ panelId: "panel-qwen", providerId: "qwen", providerName: "通义千问" }],
      [{ panelId: "panel-qwen", status: "submitted" }],
      [],
      "turn-export",
      {
        userQuestion: "Review this code",
        appliedPromptTemplates: [
          { id: "review", name: "Review", content: "Check correctness.", order: 0 },
        ],
      },
    );
    await applyResponseUpdate(turn.id, "panel-qwen", "completed", "OK", undefined, "**OK**", {
      captureId: "capture-export",
      revision: 1,
      observedAt: "2026-09-01T08:00:00.000Z",
      terminalReason: "completed",
      captureSource: "native-copy",
      nativeMimeType: "text/markdown",
    });

    const jsonl = await exportHistoryJsonl();
    await Promise.all([db.sessions.clear(), db.turns.clear(), db.exchanges.clear()]);
    await importHistoryJsonl(jsonl);

    const importedSession = (await db.sessions.toArray())[0]!;
    const detail = await getSessionDetail(importedSession.id);
    expect(detail?.turns[0]?.turn.userQuestion).toBe("Review this code");
    expect(detail?.turns[0]?.turn.appliedPromptTemplates?.[0]?.name).toBe("Review");
    expect(detail?.turns[0]?.exchanges[0]?.responseMarkdown).toBe("**OK**");
  });
});
