import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import { exportHistoryJsonl, HISTORY_FORMAT_VERSION, importHistoryJsonl } from "./history-transfer";
import {
  applyResponseUpdate,
  createSession,
  getSessionDetail,
  recordSuccessfulTurn,
  setSessionPinned,
  updateSessionWorkspaceSnapshot,
} from "./session-service";

describe("history JSONL transfer", () => {
  beforeEach(async () => {
    await Promise.all([
      db.sessions.clear(),
      db.turns.clear(),
      db.exchanges.clear(),
      db.metadata.clear(),
    ]);
  });

  it("round-trips the latest workspace contract with remapped IDs", async () => {
    const session = await createSession("导出问题");
    await updateSessionWorkspaceSnapshot(session.id, {
      layoutMode: "adaptive",
      panels: [
        {
          panelId: "panel-ds",
          providerId: "deepseek",
          url: "https://chat.deepseek.com/a/chat/s/preserved?entry=home",
          order: 0,
          selected: false,
          widthRatio: 2.5,
        },
      ],
    });
    await setSessionPinned(session.id, true);
    const turn = await recordSuccessfulTurn(
      session.id,
      "导出问题",
      [{ panelId: "panel-ds", providerId: "deepseek", providerName: "DeepSeek" }],
      [{ panelId: "panel-ds", status: "submitted" }],
    );
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "导出的最终回复");
    const jsonl = await exportHistoryJsonl();
    expect(JSON.parse(jsonl.split("\n")[0]!)).toMatchObject({
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: HISTORY_FORMAT_VERSION,
    });

    await Promise.all([db.sessions.clear(), db.turns.clear(), db.exchanges.clear()]);
    const summary = await importHistoryJsonl(jsonl);
    expect(summary).toEqual({ sessions: 1, turns: 1, exchanges: 1 });
    const imported = (await db.sessions.toArray())[0]!;
    expect(imported.id).not.toBe(session.id);
    expect(imported.source).toBe("imported");
    expect(imported.pinnedAt).toBeDefined();
    expect(imported.workspace).toMatchObject({
      layoutMode: "adaptive",
      panels: [
        {
          providerId: "deepseek",
          url: "https://chat.deepseek.com/a/chat/s/preserved?entry=home",
          selected: false,
          widthRatio: 2.5,
        },
      ],
    });
    expect(imported.workspace.panels[0]?.panelId).not.toBe("panel-ds");
    const detail = await getSessionDetail(imported.id);
    expect(detail?.turns[0]?.exchanges[0]?.responseText).toBe("导出的最终回复");
    expect(detail?.turns[0]?.exchanges[0]?.panelId).toBe(imported.workspace.panels[0]?.panelId);
  });

  it("rejects empty files, obsolete manifests and count mismatches", async () => {
    await expect(importHistoryJsonl("\n")).rejects.toThrow("历史文件为空");
    await expect(
      importHistoryJsonl(
        `${JSON.stringify({
          type: "manifest",
          format: "multi-ai-workspace-history",
          version: 2,
          exportedAt: "2026-08-30T10:00:00.000Z",
          counts: { sessions: 0, turns: 0, exchanges: 0 },
        })}\n`,
      ),
    ).rejects.toThrow("第 1 行格式无效");

    const manifest = {
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: HISTORY_FORMAT_VERSION,
      exportedAt: "2026-08-30T10:00:00.000Z",
      counts: { sessions: 1, turns: 0, exchanges: 0 },
    };
    await expect(importHistoryJsonl(`${JSON.stringify(manifest)}\n`)).rejects.toThrow(
      "清单数量与实际内容不一致",
    );
  });

  it("rejects broken references without writing anything", async () => {
    const timestamp = "2026-08-30T10:00:00.000Z";
    const lines = [
      {
        type: "manifest",
        format: "multi-ai-workspace-history",
        version: HISTORY_FORMAT_VERSION,
        exportedAt: timestamp,
        counts: { sessions: 0, turns: 1, exchanges: 0 },
      },
      {
        type: "turn",
        data: {
          id: "turn-1",
          sessionId: "missing",
          sequence: 1,
          prompt: "x",
          createdAt: timestamp,
          status: "failed",
        },
      },
    ];
    await expect(
      importHistoryJsonl(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`),
    ).rejects.toThrow("turn.sessionId");
    expect(await db.sessions.count()).toBe(0);
  });

  it("rejects provider URLs from the wrong origin and obsolete session fields", async () => {
    const timestamp = "2026-08-30T10:00:00.000Z";
    const manifest = {
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: HISTORY_FORMAT_VERSION,
      exportedAt: timestamp,
      counts: { sessions: 1, turns: 0, exchanges: 0 },
    };
    const session = {
      type: "session",
      data: {
        id: "session-1",
        title: "伪造地址",
        createdAt: timestamp,
        contentUpdatedAt: timestamp,
        lastOpenedAt: timestamp,
        source: "local",
        workspace: {
          layoutMode: "tiles",
          updatedAt: timestamp,
          panels: [
            {
              panelId: "panel-k",
              providerId: "kimi",
              url: "https://example.com/chat/stolen",
              order: 0,
              selected: true,
              widthRatio: 1,
            },
          ],
        },
      },
    };
    await expect(
      importHistoryJsonl(`${JSON.stringify(manifest)}\n${JSON.stringify(session)}\n`),
    ).rejects.toThrow("第 2 行格式无效");

    session.data.workspace.panels[0]!.url = "https://www.kimi.com/chat/valid";
    const obsolete = {
      ...session,
      data: { ...session.data, status: "archived", updatedAt: timestamp },
    };
    await expect(
      importHistoryJsonl(`${JSON.stringify(manifest)}\n${JSON.stringify(obsolete)}\n`),
    ).rejects.toThrow("第 2 行格式无效");
    expect(await db.sessions.count()).toBe(0);
  });
});
