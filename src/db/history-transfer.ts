import { z } from "zod";
import { providerIdSchema } from "../core/messaging/protocol";
import { db, type ProviderExchangeRecord, type SessionRecord, type TurnRecord } from "./database";

export const HISTORY_FILE_EXTENSION = ".maiw.jsonl";
export const MAX_HISTORY_IMPORT_BYTES = 50 * 1024 * 1024;

const sessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(500),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(["active", "archived", "imported"]),
});

const turnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  prompt: z.string().max(100_000),
  createdAt: z.iso.datetime(),
  status: z.enum(["preparing", "aborted", "waiting", "completed", "partial", "failed"]),
});

const exchangeSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  providerName: z.string().min(1).max(200),
  targetIndex: z.number().int().nonnegative(),
  submitStatus: z.enum(["pending", "prepared", "submitted", "aborted", "failed", "unavailable"]),
  responseStatus: z.enum([
    "waiting",
    "streaming",
    "completed",
    "partial",
    "timeout",
    "failed",
    "unsupported",
  ]),
  responseText: z.string().max(2_000_000).optional(),
  submittedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  message: z.string().max(2_000).optional(),
});

const manifestSchema = z.object({
  type: z.literal("manifest"),
  format: z.literal("multi-ai-workspace-history"),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  counts: z.object({
    sessions: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    exchanges: z.number().int().nonnegative(),
  }),
});

const lineSchema = z.discriminatedUnion("type", [
  manifestSchema,
  z.object({ type: z.literal("session"), data: sessionSchema }),
  z.object({ type: z.literal("turn"), data: turnSchema }),
  z.object({ type: z.literal("exchange"), data: exchangeSchema }),
]);

export interface ImportSummary {
  sessions: number;
  turns: number;
  exchanges: number;
}

export async function exportHistoryJsonl(): Promise<string> {
  const sessions = await db.sessions.orderBy("createdAt").toArray();
  const turns = await db.turns.orderBy("createdAt").toArray();
  const exchanges = await db.exchanges.toArray();
  const lines: unknown[] = [
    {
      type: "manifest",
      format: "multi-ai-workspace-history",
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: { sessions: sessions.length, turns: turns.length, exchanges: exchanges.length },
    },
    ...sessions.map((data) => ({ type: "session", data })),
    ...turns.map((data) => ({ type: "turn", data })),
    ...exchanges.map((data) => ({ type: "exchange", data })),
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

export async function importHistoryJsonl(text: string): Promise<ImportSummary> {
  const rawLines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!rawLines.length) throw new Error("历史文件为空");
  const parsed = rawLines.map((line, index) => {
    try {
      return lineSchema.parse(JSON.parse(line) as unknown);
    } catch (error) {
      throw new Error(`历史文件第 ${index + 1} 行格式无效`, { cause: error });
    }
  });
  const manifest = parsed[0];
  if (manifest?.type !== "manifest") throw new Error("历史文件第一行必须是 manifest");
  if (parsed.slice(1).some((line) => line.type === "manifest"))
    throw new Error("历史文件包含重复 manifest");

  const sessions = parsed.flatMap((line) => (line.type === "session" ? [line.data] : []));
  const turns = parsed.flatMap((line) => (line.type === "turn" ? [line.data] : []));
  const exchanges = parsed.flatMap((line) => (line.type === "exchange" ? [line.data] : []));
  if (
    manifest.counts.sessions !== sessions.length ||
    manifest.counts.turns !== turns.length ||
    manifest.counts.exchanges !== exchanges.length
  ) {
    throw new Error("历史文件清单数量与实际内容不一致");
  }

  const sessionIds = new Set(sessions.map((session) => session.id));
  const turnIds = new Set(turns.map((turn) => turn.id));
  if (sessionIds.size !== sessions.length || turnIds.size !== turns.length)
    throw new Error("历史文件包含重复 ID");
  if (turns.some((turn) => !sessionIds.has(turn.sessionId)))
    throw new Error("历史文件包含无效的 turn.sessionId");
  if (
    exchanges.some(
      (exchange) => !sessionIds.has(exchange.sessionId) || !turnIds.has(exchange.turnId),
    )
  ) {
    throw new Error("历史文件包含无效的 exchange 引用");
  }

  const sessionIdMap = new Map(sessions.map((session) => [session.id, crypto.randomUUID()]));
  const turnIdMap = new Map(turns.map((turn) => [turn.id, crypto.randomUUID()]));
  const importedSessions: SessionRecord[] = sessions.map((session) => ({
    ...session,
    id: sessionIdMap.get(session.id)!,
    status: "imported",
  }));
  const importedTurns: TurnRecord[] = turns.map((turn) => ({
    ...turn,
    id: turnIdMap.get(turn.id)!,
    sessionId: sessionIdMap.get(turn.sessionId)!,
  }));
  const importedExchanges: ProviderExchangeRecord[] = exchanges.map((exchange) => ({
    id: crypto.randomUUID(),
    sessionId: sessionIdMap.get(exchange.sessionId)!,
    turnId: turnIdMap.get(exchange.turnId)!,
    panelId: exchange.panelId,
    providerId: exchange.providerId,
    providerName: exchange.providerName,
    targetIndex: exchange.targetIndex,
    submitStatus: exchange.submitStatus,
    responseStatus: exchange.responseStatus,
    ...(exchange.responseText !== undefined ? { responseText: exchange.responseText } : {}),
    ...(exchange.submittedAt !== undefined ? { submittedAt: exchange.submittedAt } : {}),
    ...(exchange.completedAt !== undefined ? { completedAt: exchange.completedAt } : {}),
    ...(exchange.message !== undefined ? { message: exchange.message } : {}),
  }));

  await db.transaction("rw", db.sessions, db.turns, db.exchanges, async () => {
    await db.sessions.bulkAdd(importedSessions);
    await db.turns.bulkAdd(importedTurns);
    await db.exchanges.bulkAdd(importedExchanges);
  });
  return {
    sessions: importedSessions.length,
    turns: importedTurns.length,
    exchanges: importedExchanges.length,
  };
}
