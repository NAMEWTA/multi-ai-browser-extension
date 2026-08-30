import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import { exportHistoryJsonl, importHistoryJsonl } from "./history-transfer";
import {
  applyResponseUpdate,
  applySubmitResults,
  createSession,
  createTurn,
  getSessionDetail,
} from "./session-service";

describe("history JSONL transfer", () => {
  beforeEach(async () => {
    await Promise.all([db.sessions.clear(), db.turns.clear(), db.exchanges.clear()]);
  });

  it("round-trips versioned session, turn and response records with remapped IDs", async () => {
    const session = await createSession("导出问题");
    const turn = await createTurn(session.id, "导出问题", [
      { panelId: "panel-ds", providerId: "deepseek", providerName: "DeepSeek" },
    ]);
    await applySubmitResults(turn.id, [{ panelId: "panel-ds", status: "submitted" }]);
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "导出的最终回复");
    const jsonl = await exportHistoryJsonl();
    expect(JSON.parse(jsonl.split("\n")[0]!)).toMatchObject({
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: 1,
    });

    await Promise.all([db.sessions.clear(), db.turns.clear(), db.exchanges.clear()]);
    const summary = await importHistoryJsonl(jsonl);
    expect(summary).toEqual({ sessions: 1, turns: 1, exchanges: 1 });
    const imported = (await db.sessions.toArray())[0]!;
    expect(imported.id).not.toBe(session.id);
    expect(imported.status).toBe("imported");
    expect((await getSessionDetail(imported.id))?.turns[0]?.exchanges[0]?.responseText).toBe(
      "导出的最终回复",
    );
  });

  it("rejects an invalid manifest before writing anything", async () => {
    await expect(importHistoryJsonl('{"type":"turn","data":{}}\n')).rejects.toThrow(
      "第 1 行格式无效",
    );
    expect(await db.sessions.count()).toBe(0);
  });

  it("rejects empty files, count mismatches and broken references", async () => {
    await expect(importHistoryJsonl("\n")).rejects.toThrow("历史文件为空");
    const manifest = {
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: 1,
      exportedAt: "2026-08-30T10:00:00.000Z",
      counts: { sessions: 1, turns: 0, exchanges: 0 },
    };
    await expect(importHistoryJsonl(`${JSON.stringify(manifest)}\n`)).rejects.toThrow(
      "清单数量与实际内容不一致",
    );

    const brokenReference = [
      { ...manifest, counts: { sessions: 0, turns: 1, exchanges: 0 } },
      {
        type: "turn",
        data: {
          id: "turn-1",
          sessionId: "missing",
          sequence: 1,
          prompt: "x",
          createdAt: "2026-08-30T10:00:00.000Z",
          status: "failed",
        },
      },
    ];
    await expect(
      importHistoryJsonl(`${brokenReference.map((line) => JSON.stringify(line)).join("\n")}\n`),
    ).rejects.toThrow("turn.sessionId");
    expect(await db.sessions.count()).toBe(0);
  });
});
