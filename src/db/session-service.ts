import type { ProviderId } from "../core/providers/contracts";
import { providerRegistry } from "../core/providers/registry";
import {
  db,
  type ExchangeResponseStatus,
  type ExchangeSubmitStatus,
  type ProviderExchangeRecord,
  type SessionRecord,
  type SessionWorkspacePanel,
  type SessionWorkspaceSnapshot,
  type TurnRecord,
  type TurnStatus,
} from "./database";

const HISTORY_MIGRATION_KEY = "session-history-v1";
const WORKSPACE_MIGRATION_KEY = "session-workspaces-v1";
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
  status:
    | "prechecked"
    | "prepared"
    | "staged"
    | "submitted"
    | "rolled-back"
    | "duplicate"
    | "failed"
    | "unavailable"
    | "aborted";
  message?: string | undefined;
}

export interface BufferedResponseUpdate {
  panelId: string;
  status: ExchangeResponseStatus;
  responseText?: string;
  message?: string;
}

export interface SessionDetail {
  session: SessionRecord;
  turns: Array<{
    turn: TurnRecord;
    exchanges: ProviderExchangeRecord[];
  }>;
}

export type SessionWorkspaceInput = Omit<SessionWorkspaceSnapshot, "updatedAt"> & {
  updatedAt?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 42)}...` : title || "新会话";
}

function emptyWorkspace(timestamp = nowIso()): SessionWorkspaceSnapshot {
  return { layoutMode: "tiles", panels: [], updatedAt: timestamp };
}

export function isProviderWorkspaceUrl(providerId: ProviderId, value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && providerRegistry.match(url.href)?.definition.id === providerId
    );
  } catch {
    return false;
  }
}

export function normalizeSessionWorkspace(
  input: SessionWorkspaceInput,
  timestamp = nowIso(),
): SessionWorkspaceSnapshot {
  const seenPanels = new Set<string>();
  const seenProviders = new Set<ProviderId>();
  const panels = input.panels
    .toSorted((left, right) => left.order - right.order)
    .map((panel, order): SessionWorkspacePanel => {
      if (!panel.panelId.trim()) throw new Error("工作区 panelId 不能为空");
      if (seenPanels.has(panel.panelId)) throw new Error("工作区包含重复 panelId");
      if (seenProviders.has(panel.providerId)) throw new Error("工作区包含重复 Provider");
      if (!isProviderWorkspaceUrl(panel.providerId, panel.url)) {
        throw new Error(`工作区 URL 不属于 ${panel.providerId} 官方站点`);
      }
      if (!Number.isFinite(panel.widthRatio) || panel.widthRatio <= 0) {
        throw new Error("工作区面板宽度比例必须大于 0");
      }
      seenPanels.add(panel.panelId);
      seenProviders.add(panel.providerId);
      return { ...panel, order };
    });
  return {
    layoutMode: input.layoutMode,
    panels,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function createFallbackSessionWorkspace(
  exchanges: readonly ProviderExchangeRecord[],
  timestamp = nowIso(),
): SessionWorkspaceSnapshot {
  const panelsByProvider = new Map<ProviderId, ProviderExchangeRecord>();
  for (const exchange of exchanges.toSorted(
    (left, right) => left.targetIndex - right.targetIndex,
  )) {
    if (!panelsByProvider.has(exchange.providerId)) {
      panelsByProvider.set(exchange.providerId, exchange);
    }
  }
  return {
    layoutMode: "tiles",
    panels: [...panelsByProvider.values()].map((exchange, order) => ({
      panelId: exchange.panelId || crypto.randomUUID(),
      providerId: exchange.providerId,
      url: providerRegistry.get(exchange.providerId).definition.defaultUrl,
      order,
      selected: true,
      widthRatio: 1,
    })),
    updatedAt: timestamp,
  };
}

async function fallbackWorkspaceForSession(sessionId: string): Promise<SessionWorkspaceSnapshot> {
  return createFallbackSessionWorkspace(
    await db.exchanges.where("sessionId").equals(sessionId).toArray(),
  );
}

export async function migrateLegacyHistory(): Promise<void> {
  if (!(await db.metadata.get(HISTORY_MIGRATION_KEY))) {
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
          const exchanges: ProviderExchangeRecord[] = record.targets.map((target, targetIndex) => ({
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
          }));
          await db.sessions.put({
            id: sessionId,
            title: titleFromPrompt(record.prompt),
            createdAt: record.createdAt,
            updatedAt: record.createdAt,
            status: "archived",
            workspace: createFallbackSessionWorkspace(exchanges, record.createdAt),
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
          await db.exchanges.bulkPut(exchanges);
        }

        await db.metadata.put({ key: HISTORY_MIGRATION_KEY, value: nowIso() });
      },
    );
  }
  await migrateSessionWorkspaceSnapshots();
}

export async function migrateSessionWorkspaceSnapshots(): Promise<void> {
  if (await db.metadata.get(WORKSPACE_MIGRATION_KEY)) return;
  const sessions = await db.sessions.toArray();
  for (const session of sessions) {
    if (session.workspace) continue;
    await db.sessions.update(session.id, {
      workspace: await fallbackWorkspaceForSession(session.id),
    });
  }
  await db.metadata.put({ key: WORKSPACE_MIGRATION_KEY, value: nowIso() });
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
  id: string = crypto.randomUUID(),
  workspace: SessionWorkspaceInput = emptyWorkspace(),
): Promise<SessionRecord> {
  const timestamp = nowIso();
  const session: SessionRecord = {
    id,
    title: titleFromPrompt(firstPrompt),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "active",
    workspace: normalizeSessionWorkspace(workspace, timestamp),
  };
  await db.transaction("rw", db.sessions, async () => {
    const active = await db.sessions.where("status").equals("active").toArray();
    await db.sessions.bulkPut(active.map((item) => ({ ...item, status: "archived" as const })));
    await db.sessions.add(session);
  });
  return session;
}

export async function activateSession(id: string): Promise<SessionRecord> {
  return await db.transaction("rw", db.sessions, async () => {
    const target = await db.sessions.get(id);
    if (!target) throw new Error("会话不存在");
    const active = await db.sessions.where("status").equals("active").toArray();
    await db.sessions.bulkPut(
      active
        .filter((session) => session.id !== id)
        .map((session) => ({ ...session, status: "archived" as const })),
    );
    const updated = { ...target, status: "active" as const, updatedAt: nowIso() };
    await db.sessions.put(updated);
    return updated;
  });
}

export async function getSessionWorkspaceSnapshot(
  sessionId: string,
): Promise<SessionWorkspaceSnapshot | undefined> {
  const session = await db.sessions.get(sessionId);
  if (!session) return undefined;
  return session.workspace
    ? normalizeSessionWorkspace(session.workspace, session.workspace.updatedAt)
    : await fallbackWorkspaceForSession(sessionId);
}

export async function updateSessionWorkspaceSnapshot(
  sessionId: string,
  workspace: SessionWorkspaceInput,
): Promise<SessionWorkspaceSnapshot> {
  const timestamp = nowIso();
  const normalized = normalizeSessionWorkspace(workspace, timestamp);
  const updated = await db.sessions.update(sessionId, {
    workspace: normalized,
    updatedAt: timestamp,
  });
  if (!updated) throw new Error("会话不存在");
  return normalized;
}

export async function createTurn(
  sessionId: string,
  prompt: string,
  targets: readonly SessionTarget[],
  id: string = crypto.randomUUID(),
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

/**
 * Persists a turn only after the runtime confirms at least one real submission.
 * Early response events can be supplied and are committed in the same transaction.
 */
export async function recordSuccessfulTurn(
  sessionId: string,
  prompt: string,
  targets: readonly SessionTarget[],
  results: readonly SubmitResultLike[],
  responseUpdates: readonly BufferedResponseUpdate[] = [],
  id: string = crypto.randomUUID(),
): Promise<TurnRecord> {
  const resultByPanel = new Map(results.map((result) => [result.panelId, result]));
  const submittedTargets = targets.filter((target) => {
    const status = resultByPanel.get(target.panelId)?.status;
    return status === "submitted" || status === "duplicate";
  });
  if (!submittedTargets.length) throw new Error("没有成功发送的站点，不能记录轮次");

  const latestResponseByPanel = new Map<string, BufferedResponseUpdate>();
  for (const update of responseUpdates) {
    const previous = latestResponseByPanel.get(update.panelId);
    const responseText = update.responseText ?? previous?.responseText;
    const message = update.message ?? previous?.message;
    latestResponseByPanel.set(update.panelId, {
      panelId: update.panelId,
      status: update.status,
      ...(responseText !== undefined ? { responseText } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  }

  const timestamp = nowIso();
  return await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error("会话不存在");
    const last = await db.turns.where("sessionId").equals(sessionId).last();
    const exchanges: ProviderExchangeRecord[] = targets.map((target, targetIndex) => {
      const result = resultByPanel.get(target.panelId);
      const submitStatus = result ? submitStatusFromResult(result.status) : "unavailable";
      const response = latestResponseByPanel.get(target.panelId);
      const responseStatus =
        submitStatus === "submitted" ? (response?.status ?? "waiting") : "failed";
      const message = response?.message ?? result?.message;
      return {
        id: crypto.randomUUID(),
        sessionId,
        turnId: id,
        ...target,
        targetIndex,
        submitStatus,
        responseStatus,
        ...(submitStatus === "submitted" ? { submittedAt: timestamp } : {}),
        ...(response?.responseText !== undefined ? { responseText: response.responseText } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(submitStatus !== "submitted" || TERMINAL_RESPONSE_STATUSES.has(responseStatus)
          ? { completedAt: timestamp }
          : {}),
      };
    });
    const submitted = exchanges.filter((exchange) => exchange.submitStatus === "submitted");
    const allTerminal = submitted.every((exchange) =>
      TERMINAL_RESPONSE_STATUSES.has(exchange.responseStatus),
    );
    const completed = submitted.filter(
      (exchange) => exchange.responseStatus === "completed",
    ).length;
    const status: TurnStatus = !allTerminal
      ? "waiting"
      : completed === submitted.length
        ? "completed"
        : completed > 0 || submitted.some((exchange) => exchange.responseText)
          ? "partial"
          : "failed";
    const turn: TurnRecord = {
      id,
      sessionId,
      sequence: (last?.sequence ?? 0) + 1,
      prompt,
      createdAt: timestamp,
      status,
    };
    await db.turns.add(turn);
    await db.exchanges.bulkAdd(exchanges);
    await db.sessions.update(sessionId, {
      updatedAt: timestamp,
      ...(session.title === "新会话" ? { title: titleFromPrompt(prompt) } : {}),
    });
    return turn;
  });
}

function submitStatusFromResult(status: SubmitResultLike["status"]): ExchangeSubmitStatus {
  if (status === "duplicate") return "submitted";
  if (status === "prechecked" || status === "staged") return "prepared";
  if (status === "rolled-back") return "aborted";
  return status;
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

export async function discardTurn(id: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    const turn = await db.turns.get(id);
    if (!turn) return;
    await db.exchanges.where("turnId").equals(id).delete();
    await db.turns.delete(id);
    await db.sessions.update(turn.sessionId, { updatedAt: nowIso() });
  });
}
