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

const ACTIVE_SESSION_KEY = "active-session-id";
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

export async function getActiveSession(): Promise<SessionRecord | undefined> {
  const activeId = (await db.metadata.get(ACTIVE_SESSION_KEY))?.value;
  if (!activeId) return undefined;
  const session = await db.sessions.get(activeId);
  if (!session) await db.metadata.delete(ACTIVE_SESSION_KEY);
  return session;
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
    contentUpdatedAt: timestamp,
    lastOpenedAt: timestamp,
    source: "local",
    workspace: normalizeSessionWorkspace(workspace, timestamp),
  };
  await db.transaction("rw", db.sessions, db.metadata, async () => {
    await db.sessions.add(session);
    await db.metadata.put({ key: ACTIVE_SESSION_KEY, value: session.id });
  });
  return session;
}

export async function activateSession(id: string): Promise<SessionRecord> {
  return await db.transaction("rw", db.sessions, db.metadata, async () => {
    const target = await db.sessions.get(id);
    if (!target) throw new Error("会话不存在");
    const updated = { ...target, lastOpenedAt: nowIso() };
    await db.sessions.put(updated);
    await db.metadata.put({ key: ACTIVE_SESSION_KEY, value: id });
    return updated;
  });
}

export async function updateSessionWorkspaceSnapshot(
  sessionId: string,
  workspace: SessionWorkspaceInput,
): Promise<SessionWorkspaceSnapshot> {
  const timestamp = nowIso();
  const normalized = normalizeSessionWorkspace(workspace, timestamp);
  const updated = await db.sessions.update(sessionId, {
    workspace: normalized,
  });
  if (!updated) throw new Error("会话不存在");
  return normalized;
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
      contentUpdatedAt: timestamp,
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
    await db.sessions.update(turn.sessionId, { contentUpdatedAt: timestamp });
  });
}

export async function listSessions(limit = 100): Promise<SessionRecord[]> {
  const sessions = await db.sessions.toArray();
  return sessions.toSorted(compareSessions).slice(0, limit);
}

function compareSessions(left: SessionRecord, right: SessionRecord): number {
  if (left.pinnedAt && !right.pinnedAt) return -1;
  if (!left.pinnedAt && right.pinnedAt) return 1;
  if (left.pinnedAt && right.pinnedAt) {
    const pinnedOrder = right.pinnedAt.localeCompare(left.pinnedAt);
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  const createdOrder = right.createdAt.localeCompare(left.createdAt);
  return createdOrder !== 0 ? createdOrder : left.id.localeCompare(right.id);
}

export async function setSessionPinned(id: string, pinned: boolean): Promise<SessionRecord> {
  const session = await db.sessions.get(id);
  if (!session) throw new Error("会话不存在");
  if (pinned === Boolean(session.pinnedAt)) return session;
  if (pinned) {
    const updated = { ...session, pinnedAt: nowIso() };
    await db.sessions.put(updated);
    return updated;
  }
  const updated = { ...session };
  delete updated.pinnedAt;
  await db.sessions.put(updated);
  return updated;
}

export async function toggleSessionPinned(id: string): Promise<SessionRecord> {
  const session = await db.sessions.get(id);
  if (!session) throw new Error("会话不存在");
  return await setSessionPinned(id, !session.pinnedAt);
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
  await db.transaction("rw", db.sessions, db.turns, db.exchanges, db.metadata, async () => {
    await db.exchanges.where("sessionId").equals(id).delete();
    await db.turns.where("sessionId").equals(id).delete();
    await db.sessions.delete(id);
    if ((await db.metadata.get(ACTIVE_SESSION_KEY))?.value === id) {
      await db.metadata.delete(ACTIVE_SESSION_KEY);
    }
  });
}
