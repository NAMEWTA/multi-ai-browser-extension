import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import {
  activateSession,
  applyResponseUpdate,
  applySubmitResults,
  createSession,
  createTurn,
  discardTurn,
  ensureActiveSession,
  getActiveSession,
  getSessionDetail,
  getSessionWorkspaceSnapshot,
  listSessions,
  migrateLegacyHistory,
  migrateSessionWorkspaceSnapshots,
  recordSuccessfulTurn,
  updateSessionWorkspaceSnapshot,
} from "./session-service";

const targets = [
  { panelId: "panel-ds", providerId: "deepseek" as const, providerName: "DeepSeek" },
  { panelId: "panel-k", providerId: "kimi" as const, providerName: "Kimi" },
];

describe("session history", () => {
  beforeEach(async () => {
    await Promise.all([
      db.sendRecords.clear(),
      db.sessions.clear(),
      db.turns.clear(),
      db.exchanges.clear(),
      db.metadata.clear(),
    ]);
  });

  it("keeps multiple turns and provider replies in one active session", async () => {
    const session = await ensureActiveSession("问题 A");
    const first = await createTurn(session.id, "问题 A", targets);
    await applySubmitResults(
      first.id,
      targets.map((target) => ({ panelId: target.panelId, status: "submitted" })),
    );
    await applyResponseUpdate(first.id, "panel-ds", "completed", "DeepSeek A");
    await applyResponseUpdate(first.id, "panel-k", "completed", "Kimi A");

    const sameSession = await ensureActiveSession("问题 B");
    const second = await createTurn(sameSession.id, "问题 B", targets);
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

  it("archives the current session only when a new session is created", async () => {
    const first = await createSession("第一项任务");
    const second = await createSession("第二项任务");
    expect((await db.sessions.get(first.id))?.status).toBe("archived");
    expect((await db.sessions.get(second.id))?.status).toBe("active");
  });

  it("persists complete provider URLs and switches the active session", async () => {
    const first = await createSession("第一项任务");
    const deepSeekUrl = "https://chat.deepseek.com/a/chat/s/full-session-id?source=workspace";
    await updateSessionWorkspaceSnapshot(first.id, {
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
    const second = await createSession("第二项任务");
    await activateSession(first.id);

    expect((await getActiveSession())?.id).toBe(first.id);
    expect((await db.sessions.get(second.id))?.status).toBe("archived");
    expect((await getSessionWorkspaceSnapshot(first.id))?.panels[0]).toMatchObject({
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

  it("migrates an Alpha 5 session to a default provider workspace", async () => {
    const timestamp = "2026-08-30T10:00:00.000Z";
    await db.sessions.add({
      id: "alpha-5-session",
      title: "旧会话",
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "archived",
    });
    await db.exchanges.add({
      id: "exchange-old",
      sessionId: "alpha-5-session",
      turnId: "turn-old",
      panelId: "panel-k",
      providerId: "kimi",
      providerName: "Kimi",
      targetIndex: 0,
      submitStatus: "submitted",
      responseStatus: "unsupported",
    });
    await migrateSessionWorkspaceSnapshots();
    expect((await db.sessions.get("alpha-5-session"))?.workspace?.panels[0]).toMatchObject({
      panelId: "panel-k",
      providerId: "kimi",
      url: "https://www.kimi.com/",
      selected: true,
      widthRatio: 1,
    });
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

  it("does not record a turn when no target submitted and can discard a pending turn", async () => {
    const session = await createSession("失败不记录");
    await expect(
      recordSuccessfulTurn(session.id, "全部失败", targets, [
        { panelId: "panel-ds", status: "failed" },
        { panelId: "panel-k", status: "aborted" },
      ]),
    ).rejects.toThrow("不能记录轮次");
    expect(await db.turns.count()).toBe(0);

    const pending = await createTurn(session.id, "临时轮次", targets);
    await discardTurn(pending.id);
    expect(await db.turns.get(pending.id)).toBeUndefined();
    expect(await db.exchanges.where("turnId").equals(pending.id).count()).toBe(0);
  });

  it("records an aborted preflight without pretending any provider submitted", async () => {
    const session = await createSession("预检失败");
    const turn = await createTurn(session.id, "预检失败", targets);
    await applySubmitResults(turn.id, [
      { panelId: "panel-ds", status: "aborted", message: "其他站点预检失败" },
      { panelId: "panel-k", status: "failed", message: "发送按钮缺失" },
    ]);
    const detail = await getSessionDetail(session.id);
    expect(detail?.turns[0]?.turn.status).toBe("aborted");
    expect(detail?.turns[0]?.exchanges.map((item) => item.submitStatus)).toEqual([
      "aborted",
      "failed",
    ]);
  });

  it("aggregates mixed response terminal states as a partial turn", async () => {
    const session = await createSession("部分回复");
    const turn = await createTurn(session.id, "部分回复", targets);
    await applySubmitResults(
      turn.id,
      targets.map((target) => ({ panelId: target.panelId, status: "submitted" })),
    );
    await applyResponseUpdate(turn.id, "panel-ds", "completed", "有效回复");
    await applyResponseUpdate(turn.id, "panel-k", "timeout", undefined, "等待超时");
    expect((await getSessionDetail(session.id))?.turns[0]?.turn.status).toBe("partial");
  });

  it("migrates each legacy snapshot exactly once", async () => {
    await db.sendRecords.add({
      id: "legacy-1",
      taskId: "task-1",
      prompt: "旧问题",
      createdAt: "2026-08-30T10:00:00.000Z",
      targets: [
        {
          panelId: "panel-ds",
          providerId: "deepseek",
          providerName: "DeepSeek",
          status: "submitted",
        },
      ],
    });
    await migrateLegacyHistory();
    await migrateLegacyHistory();
    expect(await listSessions()).toHaveLength(1);
    expect(
      (await getSessionDetail("legacy-session-legacy-1"))?.turns[0]?.exchanges[0]?.responseStatus,
    ).toBe("unsupported");
  });
});
