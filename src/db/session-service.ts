import type { ProviderId } from "../core/providers/contracts";
import {
  db,
  type ExchangeResponseStatus,
  type ExchangeSubmitStatus,
  type ProviderExchangeRecord,
  type SessionRecord,
  type TurnRecord,
  type TurnStatus,
} from "./database";

const HISTORY_MIGRATION_KEY = "session-history-v1";
const TERMINAL_RESPONSE_STATUSES = new Set<ExchangeResponseStatus>([
  "completed",
  "partial",
  "timeout",
  "failed",
  "unsupported",
]);

export interface SessionTarget {
  panelId: string;
  providerId: ProviderId;
  providerName: string;
}

export interface SubmitResultLike {
  panelId: string;
  status: "prepared" | "submitted" | "duplicate" | "failed" | "unavailable" | "aborted";
  message?: string | undefined;
}

export interface SessionDetail {
  session: SessionRecord;
  turns: Array<{
    turn: TurnRecord;
    exchanges: ProviderExchangeRecord[];
  }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 42)}...` : title || "新会话";
}

export async function migrateLegacyHistory(): Promise<void> {
  if (await db.metadata.get(HISTORY_MIGRATION_KEY)) return;

  await db.transaction(
    "rw",
    db.sendRecords,
    db.sessions,
    db.turns,
    db.exchanges,
    db.metadata,
    async () => {
      if (await db.metadata.get(HISTORY_MIGRATION_KEY)) return;
      const records = await db.sendRecords.orderBy("createdAt").toArray();

      for (const record of records) {
        const sessionId = `legacy-session-${record.id}`;
        const turnId = `legacy-turn-${record.id}`;
        await db.sessions.put({
          id: sessionId,
          title: titleFromPrompt(record.prompt),
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
          status: "archived",
        });
        await db.turns.put({
          id: turnId,
          sessionId,
          sequence: 1,
          prompt: record.prompt,
          createdAt: record.createdAt,
          status: record.targets.some((target) => target.status === "submitted")
            ? "partial"
            : "failed",
        });
        await db.exchanges.bulkPut(
          record.targets.map((target, targetIndex) => ({
            id: crypto.randomUUID(),
            sessionId,
            turnId,
            panelId: target.panelId,
            providerId: target.providerId,
            providerName: target.providerName,
            targetIndex,
            submitStatus: target.status,
            responseStatus: "unsupported",
            ...(target.status === "submitted" ? { submittedAt: record.createdAt } : {}),
            completedAt: record.createdAt,
            message: target.message ?? "由旧版发送记录迁移，未采集回复正文",
          })),
        );
      }

      await db.metadata.put({ key: HISTORY_MIGRATION_KEY, value: nowIso() });
    },
  );
}

export async function getActiveSession(): Promise<SessionRecord | undefined> {
  return await db.sessions.where("status").equals("active").last();
}

export async function ensureActiveSession(firstPrompt = ""): Promise<SessionRecord> {
  const active = await getActiveSession();
  if (active) return active;
  return await createSession(firstPrompt);
}

export async function createSession(
  firstPrompt = "",
  id = crypto.randomUUID(),
): Promise<SessionRecord> {
  const timestamp = nowIso();
  const session: SessionRecord = {
    id,
    title: titleFromPrompt(firstPrompt),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "active",
  };
  await db.transaction("rw", db.sessions, async () => {
    const active = await db.sessions.where("status").equals("active").toArray();
    await db.sessions.bulkPut(active.map((item) => ({ ...item, status: "archived" as const })));
    await db.sessions.add(session);
  });
  return session;
}

export async function createTurn(
  sessionId: string,
  prompt: string,
  targets: readonly SessionTarget[],
  id = crypto.randomUUID(),
): Promise<TurnRecord> {
  const timestamp = nowIso();
  return await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error("会话不存在");
    const last = await db.turns.where("sessionId").equals(sessionId).last();
    const turn: TurnRecord = {
      id,
      sessionId,
      sequence: (last?.sequence ?? 0) + 1,
      prompt,
      createdAt: timestamp,
      status: "preparing",
    };
    await db.turns.add(turn);
    await db.exchanges.bulkAdd(
      targets.map((target, targetIndex) => ({
        id: crypto.randomUUID(),
        sessionId,
        turnId: id,
        ...target,
        targetIndex,
        submitStatus: "pending" as const,
        responseStatus: "waiting" as const,
      })),
    );
    await db.sessions.update(sessionId, {
      updatedAt: timestamp,
      ...(session.title === "新会话" ? { title: titleFromPrompt(prompt) } : {}),
    });
    return turn;
  });
}

function submitStatusFromResult(status: SubmitResultLike["status"]): ExchangeSubmitStatus {
  return status === "duplicate" ? "submitted" : status;
}

export async function applySubmitResults(
  turnId: string,
  results: readonly SubmitResultLike[],
): Promise<void> {
  const timestamp = nowIso();
  await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    const turn = await db.turns.get(turnId);
    if (!turn) return;
    const resultByPanel = new Map(results.map((result) => [result.panelId, result]));
    const exchanges = await db.exchanges.where("turnId").equals(turnId).toArray();
    let submitted = 0;

    await db.exchanges.bulkPut(
      exchanges.map((exchange) => {
        const result = resultByPanel.get(exchange.panelId);
        const submitStatus = result ? submitStatusFromResult(result.status) : "unavailable";
        if (submitStatus === "submitted") submitted += 1;
        return {
          ...exchange,
          submitStatus,
          responseStatus: submitStatus === "submitted" ? "waiting" : "failed",
          ...(submitStatus === "submitted"
            ? { submittedAt: timestamp }
            : { completedAt: timestamp }),
          ...(result?.message ? { message: result.message } : {}),
        };
      }),
    );

    const status: TurnStatus =
      submitted > 0
        ? "waiting"
        : results.some((result) => result.status === "aborted")
          ? "aborted"
          : "failed";
    await db.turns.update(turnId, { status });
    await db.sessions.update(turn.sessionId, { updatedAt: timestamp });
  });
}

export async function applyResponseUpdate(
  turnId: string,
  panelId: string,
  status: ExchangeResponseStatus,
  responseText?: string,
  message?: string,
): Promise<void> {
  const timestamp = nowIso();
  await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    const turn = await db.turns.get(turnId);
    if (!turn) return;
    const exchange = await db.exchanges
      .where("turnId")
      .equals(turnId)
      .filter((item) => item.panelId === panelId)
      .first();
    if (!exchange) return;

    await db.exchanges.update(exchange.id, {
      responseStatus: status,
      ...(responseText !== undefined ? { responseText } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(TERMINAL_RESPONSE_STATUSES.has(status) ? { completedAt: timestamp } : {}),
    });

    const exchanges = await db.exchanges.where("turnId").equals(turnId).toArray();
    const updated = exchanges.map((item) =>
      item.id === exchange.id
        ? { ...item, responseStatus: status, responseText: responseText ?? item.responseText }
        : item,
    );
    const submitted = updated.filter((item) => item.submitStatus === "submitted");
    let turnStatus: TurnStatus = "waiting";
    if (
      submitted.length > 0 &&
      submitted.every((item) => TERMINAL_RESPONSE_STATUSES.has(item.responseStatus))
    ) {
      const completed = submitted.filter((item) => item.responseStatus === "completed").length;
      turnStatus =
        completed === submitted.length
          ? "completed"
          : completed > 0 || updated.some((item) => item.responseText)
            ? "partial"
            : "failed";
    }
    await db.turns.update(turnId, { status: turnStatus });
    await db.sessions.update(turn.sessionId, { updatedAt: timestamp });
  });
}

export async function listSessions(limit = 100): Promise<SessionRecord[]> {
  return await db.sessions.orderBy("updatedAt").reverse().limit(limit).toArray();
}

export async function getSessionDetail(id: string): Promise<SessionDetail | undefined> {
  const session = await db.sessions.get(id);
  if (!session) return undefined;
  const turns = await db.turns.where("sessionId").equals(id).sortBy("sequence");
  const exchanges = await db.exchanges.where("sessionId").equals(id).toArray();
  const byTurn = new Map<string, ProviderExchangeRecord[]>();
  for (const exchange of exchanges) {
    const group = byTurn.get(exchange.turnId) ?? [];
    group.push(exchange);
    byTurn.set(exchange.turnId, group);
  }
  return {
    session,
    turns: turns.map((turn) => ({
      turn,
      exchanges: (byTurn.get(turn.id) ?? []).toSorted(
        (left, right) => left.targetIndex - right.targetIndex,
      ),
    })),
  };
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    await db.exchanges.where("sessionId").equals(id).delete();
    await db.turns.where("sessionId").equals(id).delete();
    await db.sessions.delete(id);
  });
}
