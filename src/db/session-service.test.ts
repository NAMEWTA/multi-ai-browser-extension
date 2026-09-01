import { beforeEach, describe, expect, it } from "vitest";
import { db, type SessionRecord } from "./database";
import {
  activateSession,
  applyResponseUpdate,
  createSession,
  deleteSession,
  getActiveSession,
  getSessionDetail,
  listSessions,
  recordSuccessfulTurn,
  renameSession,
  setSessionPinned,
  toggleSessionPinned,
  updateSessionWorkspaceSnapshot,
} from "./session-service";

const targets = [
  { panelId: "panel-ds", providerId: "deepseek" as const, providerName: "DeepSeek" },
  { panelId: "panel-k", providerId: "kimi" as const, providerName: "Kimi" },
];

function sessionFixture(id: string, createdAt: string): SessionRecord {
  return {
    id,
    title: id,
    createdAt,
    contentUpdatedAt: createdAt,
    lastOpenedAt: createdAt,
    source: "local",
    workspace: { layoutMode: "tiles", panels: [], updatedAt: createdAt },
  };
}

describe("session history", () => {
  beforeEach(async () => {
    await Promise.all([
      db.sessions.clear(),
      db.turns.clear(),
      db.exchanges.clear(),
      db.metadata.clear(),
    ]);
  });

  it("keeps multiple turns and provider replies in one active session", async () => {
    const session = await createSession("问题 A");
    const first = await recordSuccessfulTurn(
      session.id,
      "问题 A",
      targets,
      targets.map((target) => ({ panelId: target.panelId, status: "submitted" })),
    );
    await applyResponseUpdate(first.id, "panel-ds", "completed", "DeepSeek A");
    await applyResponseUpdate(first.id, "panel-k", "completed", "Kimi A");

    const sameSession = (await getActiveSession())!;
    const second = await recordSuccessfulTurn(
      sameSession.id,
      "问题 B",
      targets,
      targets.map((target) => ({ panelId: target.panelId, status: "submitted" })),
    );
    expect(sameSession.id).toBe(session.id);
    expect(second.sequence).toBe(2);

    const detail = await getSessionDetail(session.id);
    expect(detail?.turns).toHaveLength(2);
    expect(detail?.turns[0]?.turn.status).toBe("completed");
    expect(detail?.turns[0]?.exchanges.map((item) => item.responseText)).toEqual([
      "DeepSeek A",
      "Kimi A",
    ]);
  });

  it("stores active identity in metadata without rewriting another session", async () => {
    const first = await createSession("第一项任务", "first");
    const firstBefore = await db.sessions.get(first.id);
    const second = await createSession("第二项任务", "second");

    expect((await getActiveSession())?.id).toBe(second.id);
    expect(await db.sessions.get(first.id)).toEqual(firstBefore);

    const secondBefore = await db.sessions.get(second.id);
    await activateSession(first.id);
    expect((await getActiveSession())?.id).toBe(first.id);
    expect(await db.sessions.get(second.id)).toEqual(secondBefore);
  });

  it("cleans a stale active identity and clears it when the active session is deleted", async () => {
    await db.metadata.put({ key: "active-session-id", value: "missing" });
    expect(await getActiveSession()).toBeUndefined();
    expect(await db.metadata.get("active-session-id")).toBeUndefined();

    const session = await createSession("待删除");
    await deleteSession(session.id);
    expect(await db.metadata.get("active-session-id")).toBeUndefined();
  });

  it("persists complete provider URLs without changing content ordering time", async () => {
    const session = await createSession("第一项任务");
    const contentUpdatedAt = session.contentUpdatedAt;
    const deepSeekUrl = "https://chat.deepseek.com/a/chat/s/full-session-id?source=workspace";
    await updateSessionWorkspaceSnapshot(session.id, {
      layoutMode: "tiles",
      panels: [
        {
          panelId: "panel-ds",
          providerId: "deepseek",
          url: deepSeekUrl,
          order: 0,
          selected: true,
          widthRatio: 1.7,
        },
      ],
    });

    expect((await db.sessions.get(session.id))?.contentUpdatedAt).toBe(contentUpdatedAt);
    expect((await db.sessions.get(session.id))?.workspace.panels[0]).toMatchObject({
      url: deepSeekUrl,
      widthRatio: 1.7,
    });
  });

  it("rejects a workspace URL assigned to the wrong provider", async () => {
    const session = await createSession("错误 URL");
    await expect(
      updateSessionWorkspaceSnapshot(session.id, {
        layoutMode: "tiles",
        panels: [
          {
            panelId: "panel-k",
            providerId: "kimi",
            url: "https://chat.deepseek.com/a/chat/s/not-kimi",
            order: 0,
            selected: true,
            widthRatio: 1,
          },
        ],
      }),
    ).rejects.toThrow("不属于 kimi");
  });

  it("keeps unpinned order stable across open, send, reply and workspace autosave", async () => {
    await db.sessions.bulkAdd([
      sessionFixture("old", "2026-08-01T00:00:00.000Z"),
      sessionFixture("middle", "2026-08-02T00:00:00.000Z"),
      sessionFixture("new", "2026-08-03T00:00:00.000Z"),
    ]);
    const expected = ["new", "middle", "old"];
    expect((await listSessions()).map((session) => session.id)).toEqual(expected);

    await activateSession("old");
    await updateSessionWorkspaceSnapshot("old", { layoutMode: "adaptive", panels: [] });
    const turn = await recordSuccessfulTurn(
      "old",
      "仍然不重排",
      [targets[0]!],
      [{ panelId: "panel-ds", status: "submitted" }],
      [],
      "stable-turn",
    );
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "完成");

    expect((await listSessions()).map((session) => session.id)).toEqual(expected);
    expect((await db.sessions.get("old"))?.lastOpenedAt).not.toBe("2026-08-01T00:00:00.000Z");
    expect((await db.sessions.get("old"))?.contentUpdatedAt).not.toBe("2026-08-01T00:00:00.000Z");
  });

  it("renames a session without changing its conversation ordering timestamp", async () => {
    const session = await createSession("原标题", "rename-me");

    const renamed = await renameSession(session.id, "  第一次\r\n对话  ");

    expect(renamed.title).toBe("第一次 对话");
    expect(renamed.contentUpdatedAt).toBe(session.contentUpdatedAt);
    expect((await getSessionDetail(session.id))?.session.title).toBe("第一次 对话");
  });

  it("rejects invalid session rename requests", async () => {
    const session = await createSession("原标题", "rename-validation");

    await expect(renameSession(session.id, "   ")).rejects.toThrow("会话标题不能为空");
    await expect(renameSession(session.id, "x".repeat(121))).rejects.toThrow(
      "会话标题不能超过 120 个字符",
    );
    await expect(renameSession("missing", "新标题")).rejects.toThrow("会话不存在");
    expect((await db.sessions.get(session.id))?.title).toBe("原标题");
  });

  it("orders pinned sessions explicitly and restores creation order when unpinned", async () => {
    await db.sessions.bulkAdd([
      sessionFixture("old", "2026-08-01T00:00:00.000Z"),
      sessionFixture("middle", "2026-08-02T00:00:00.000Z"),
      sessionFixture("new", "2026-08-03T00:00:00.000Z"),
    ]);
    await setSessionPinned("old", true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const middlePinned = await toggleSessionPinned("middle");
    expect(middlePinned.pinnedAt).toBeDefined();
    expect((await listSessions()).map((session) => session.id)).toEqual(["middle", "old", "new"]);

    const pinnedAt = middlePinned.pinnedAt;
    expect((await setSessionPinned("middle", true)).pinnedAt).toBe(pinnedAt);
    await setSessionPinned("middle", false);
    expect((await listSessions()).map((session) => session.id)).toEqual(["old", "new", "middle"]);
  });

  it("records a successful turn and buffered reply atomically", async () => {
    const session = await createSession("延迟落库");
    const turn = await recordSuccessfulTurn(
      session.id,
      "发送成功后再记录",
      targets,
      [
        { panelId: "panel-ds", status: "submitted" },
        { panelId: "panel-k", status: "failed", message: "点击失败" },
      ],
      [
        {
          panelId: "panel-ds",
          status: "completed",
          responseText: "提前到达的回复",
        },
      ],
      "successful-turn",
    );
    const detail = await getSessionDetail(session.id);
    expect(turn.status).toBe("completed");
    expect(detail?.turns[0]?.exchanges).toMatchObject([
      { submitStatus: "submitted", responseText: "提前到达的回复" },
      { submitStatus: "failed", responseStatus: "failed" },
    ]);
  });

  it("does not record an unsuccessful turn", async () => {
    const session = await createSession("失败不记录");
    await expect(
      recordSuccessfulTurn(session.id, "全部失败", targets, [
        { panelId: "panel-ds", status: "failed" },
        { panelId: "panel-k", status: "aborted" },
      ]),
    ).rejects.toThrow("不能记录轮次");
    expect(await db.turns.count()).toBe(0);
  });

  it("aggregates mixed response terminal states as a partial turn", async () => {
    const session = await createSession("部分回复");
    const turn = await recordSuccessfulTurn(
      session.id,
      "部分回复",
      targets,
      targets.map((target) => ({ panelId: target.panelId, status: "submitted" })),
    );
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "有效回复");
    await applyResponseUpdate(turn.id, "panel-k", "timeout", undefined, "等待超时");
    expect((await getSessionDetail(session.id))?.turns[0]?.turn.status).toBe("partial");
  });

  it("keeps a completed revision when stale or nonterminal updates arrive later", async () => {
    const session = await createSession("乱序回复");
    const turn = await recordSuccessfulTurn(
      session.id,
      "保持最终正文",
      [targets[0]!],
      [{ panelId: "panel-ds", status: "submitted" }],
    );
    const observedAt = "2026-09-01T08:00:00.000Z";
    const metadata = (revision: number, terminalReason?: "completed") => ({
      captureId: "capture-1",
      revision,
      observedAt,
      ...(terminalReason ? { terminalReason } : {}),
    });

    await applyResponseUpdate(
      turn.id,
      "panel-ds",
      "streaming",
      "# 你好",
      undefined,
      "# 你好",
      metadata(7),
    );
    await applyResponseUpdate(
      turn.id,
      "panel-ds",
      "completed",
      "你好\n这是完整回答\nEND-SENTINEL",
      undefined,
      "# 你好\n\n这是完整回答\n\nEND-SENTINEL",
      metadata(8, "completed"),
    );
    await applyResponseUpdate(
      turn.id,
      "panel-ds",
      "streaming",
      "# 你好",
      undefined,
      "# 你好",
      metadata(7),
    );
    await applyResponseUpdate(
      turn.id,
      "panel-ds",
      "streaming",
      "错误的后续流",
      undefined,
      "错误的后续流",
      metadata(9),
    );
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "另一采集", undefined, "另一采集", {
      ...metadata(99, "completed"),
      captureId: "capture-2",
    });

    const exchange = (await getSessionDetail(session.id))?.turns[0]?.exchanges[0];
    expect(exchange).toMatchObject({
      responseStatus: "completed",
      captureId: "capture-1",
      responseRevision: 8,
      terminalReason: "completed",
      responseText: expect.stringContaining("END-SENTINEL"),
      responseMarkdown: expect.stringContaining("END-SENTINEL"),
    });
  });

  it("reduces buffered responses by revision before creating exchanges", async () => {
    const session = await createSession("早到乱序回复");
    const turn = await recordSuccessfulTurn(
      session.id,
      "缓冲最终正文",
      [targets[0]!],
      [{ panelId: "panel-ds", status: "submitted" }],
      [
        {
          panelId: "panel-ds",
          status: "completed",
          captureId: "capture-buffered",
          revision: 8,
          observedAt: "2026-09-01T08:00:08.000Z",
          terminalReason: "completed",
          responseText: "完整缓冲回答",
          responseMarkdown: "## 完整缓冲回答",
        },
        {
          panelId: "panel-ds",
          status: "streaming",
          captureId: "capture-buffered",
          revision: 7,
          observedAt: "2026-09-01T08:00:07.000Z",
          responseText: "# 你好",
          responseMarkdown: "# 你好",
        },
      ],
    );

    expect((await getSessionDetail(session.id))?.turns[0]?.exchanges[0]).toMatchObject({
      turnId: turn.id,
      responseStatus: "completed",
      responseRevision: 8,
      responseText: "完整缓冲回答",
      responseMarkdown: "## 完整缓冲回答",
    });
  });
});
