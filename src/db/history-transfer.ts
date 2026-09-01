import { z } from "zod";
import { providerIds } from "../core/providers/contracts";
import { db, type ProviderExchangeRecord, type SessionRecord, type TurnRecord } from "./database";
import { isProviderWorkspaceUrl, normalizeSessionWorkspace } from "./session-service";

export const HISTORY_FILE_EXTENSION = ".maiw.jsonl";
export const MAX_HISTORY_IMPORT_BYTES = 50 * 1024 * 1024;
export const HISTORY_FORMAT_VERSION = 3;

const providerIdSchema = z.enum(providerIds);
const workspacePanelSchema = z
  .object({
    panelId: z.string().trim().min(1).max(500),
    providerId: providerIdSchema,
    url: z.url().max(8_192),
    order: z.number().int().nonnegative(),
    selected: z.boolean(),
    widthRatio: z.number().positive().finite().max(1_000),
  })
  .strict()
  .superRefine((panel, context) => {
    if (!isProviderWorkspaceUrl(panel.providerId, panel.url)) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "URL 必须是对应 Provider 的官方 HTTPS 地址",
      });
    }
  });

const workspaceSchema = z
  .object({
    layoutMode: z.enum(["tiles", "adaptive"]),
    panels: z.array(workspacePanelSchema).max(providerIds.length),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((workspace, context) => {
    if (new Set(workspace.panels.map((panel) => panel.panelId)).size !== workspace.panels.length) {
      context.addIssue({ code: "custom", path: ["panels"], message: "panelId 不能重复" });
    }
    if (
      new Set(workspace.panels.map((panel) => panel.providerId)).size !== workspace.panels.length
    ) {
      context.addIssue({ code: "custom", path: ["panels"], message: "Provider 不能重复" });
    }
  });

const sessionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().max(500),
    createdAt: z.iso.datetime(),
    contentUpdatedAt: z.iso.datetime(),
    lastOpenedAt: z.iso.datetime(),
    pinnedAt: z.iso.datetime().optional(),
    source: z.enum(["local", "imported"]),
    workspace: workspaceSchema,
  })
  .strict();

const turnSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    sequence: z.number().int().positive(),
    prompt: z.string().max(100_000),
    userQuestion: z.string().max(100_000).optional(),
    appliedPromptTemplates: z
      .array(
        z
          .object({
            id: z.string().min(1).max(500),
            name: z.string().min(1).max(120),
            content: z.string().max(50_000),
            order: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    createdAt: z.iso.datetime(),
    status: z.enum(["preparing", "aborted", "waiting", "completed", "partial", "failed"]),
  })
  .strict();

const exchangeSchema = z
  .object({
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
    responseMarkdown: z.string().max(2_000_000).optional(),
    captureId: z.string().min(1).max(100).optional(),
    responseRevision: z.number().int().positive().optional(),
    responseObservedAt: z.iso.datetime().optional(),
    terminalReason: z
      .enum([
        "completed",
        "interrupted",
        "aborted",
        "timeout",
        "navigation",
        "verification",
        "uncertain-final",
        "failed",
        "unsupported",
      ])
      .optional(),
    captureSource: z.enum(["dom", "native-copy", "provider-api"]).optional(),
    nativeMimeType: z.enum(["text/markdown", "text/plain", "text/html"]).optional(),
    submittedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    message: z.string().max(2_000).optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    type: z.literal("manifest"),
    format: z.literal("multi-ai-workspace-history"),
    version: z.literal(HISTORY_FORMAT_VERSION),
    exportedAt: z.iso.datetime(),
    counts: z
      .object({
        sessions: z.number().int().nonnegative(),
        turns: z.number().int().nonnegative(),
        exchanges: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

type ParsedLine =
  | { type: "session"; data: z.infer<typeof sessionSchema> }
  | { type: "turn"; data: z.infer<typeof turnSchema> }
  | { type: "exchange"; data: z.infer<typeof exchangeSchema> };

function parseDataLine(raw: unknown): ParsedLine {
  const envelope = z
    .object({ type: z.enum(["session", "turn", "exchange"]), data: z.unknown() })
    .strict()
    .parse(raw);
  if (envelope.type === "session") {
    return { type: "session", data: sessionSchema.parse(envelope.data) };
  }
  if (envelope.type === "turn") {
    return { type: "turn", data: turnSchema.parse(envelope.data) };
  }
  return { type: "exchange", data: exchangeSchema.parse(envelope.data) };
}

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
      version: HISTORY_FORMAT_VERSION,
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

  let manifest: z.infer<typeof manifestSchema>;
  try {
    manifest = manifestSchema.parse(JSON.parse(rawLines[0]!) as unknown);
  } catch (error) {
    throw new Error("历史文件第 1 行格式无效", { cause: error });
  }

  const parsed = rawLines.slice(1).map((line, offset) => {
    try {
      return parseDataLine(JSON.parse(line) as unknown);
    } catch (error) {
      throw new Error(`历史文件第 ${offset + 2} 行格式无效`, { cause: error });
    }
  });
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
  const exchangeIds = new Set(exchanges.map((exchange) => exchange.id));
  if (
    sessionIds.size !== sessions.length ||
    turnIds.size !== turns.length ||
    exchangeIds.size !== exchanges.length
  ) {
    throw new Error("历史文件包含重复 ID");
  }
  if (turns.some((turn) => !sessionIds.has(turn.sessionId))) {
    throw new Error("历史文件包含无效的 turn.sessionId");
  }
  const turnSessions = new Map(turns.map((turn) => [turn.id, turn.sessionId]));
  if (
    exchanges.some(
      (exchange) =>
        !sessionIds.has(exchange.sessionId) ||
        turnSessions.get(exchange.turnId) !== exchange.sessionId,
    )
  ) {
    throw new Error("历史文件包含无效的 exchange 引用");
  }

  const sessionIdMap = new Map(sessions.map((session) => [session.id, crypto.randomUUID()]));
  const turnIdMap = new Map(turns.map((turn) => [turn.id, crypto.randomUUID()]));
  const panelIdMap = new Map<string, string>();
  const panelKey = (sessionId: string, panelId: string) => JSON.stringify([sessionId, panelId]);
  for (const session of sessions) {
    for (const panel of session.workspace.panels) {
      panelIdMap.set(panelKey(session.id, panel.panelId), crypto.randomUUID());
    }
  }
  for (const exchange of exchanges) {
    const key = panelKey(exchange.sessionId, exchange.panelId);
    if (!panelIdMap.has(key)) panelIdMap.set(key, crypto.randomUUID());
  }

  const importedTurns: TurnRecord[] = turns.map((turn) => ({
    id: turnIdMap.get(turn.id)!,
    sessionId: sessionIdMap.get(turn.sessionId)!,
    sequence: turn.sequence,
    prompt: turn.prompt,
    ...(turn.userQuestion !== undefined ? { userQuestion: turn.userQuestion } : {}),
    ...(turn.appliedPromptTemplates !== undefined
      ? { appliedPromptTemplates: turn.appliedPromptTemplates }
      : {}),
    createdAt: turn.createdAt,
    status: turn.status,
  }));
  const importedExchanges: ProviderExchangeRecord[] = exchanges.map((exchange) => ({
    id: crypto.randomUUID(),
    sessionId: sessionIdMap.get(exchange.sessionId)!,
    turnId: turnIdMap.get(exchange.turnId)!,
    panelId: panelIdMap.get(panelKey(exchange.sessionId, exchange.panelId))!,
    providerId: exchange.providerId,
    providerName: exchange.providerName,
    targetIndex: exchange.targetIndex,
    submitStatus: exchange.submitStatus,
    responseStatus: exchange.responseStatus,
    ...(exchange.responseText !== undefined ? { responseText: exchange.responseText } : {}),
    ...(exchange.responseMarkdown !== undefined
      ? { responseMarkdown: exchange.responseMarkdown }
      : {}),
    ...(exchange.captureId !== undefined ? { captureId: exchange.captureId } : {}),
    ...(exchange.responseRevision !== undefined
      ? { responseRevision: exchange.responseRevision }
      : {}),
    ...(exchange.responseObservedAt !== undefined
      ? { responseObservedAt: exchange.responseObservedAt }
      : {}),
    ...(exchange.terminalReason !== undefined ? { terminalReason: exchange.terminalReason } : {}),
    ...(exchange.captureSource !== undefined ? { captureSource: exchange.captureSource } : {}),
    ...(exchange.nativeMimeType !== undefined ? { nativeMimeType: exchange.nativeMimeType } : {}),
    ...(exchange.submittedAt !== undefined ? { submittedAt: exchange.submittedAt } : {}),
    ...(exchange.completedAt !== undefined ? { completedAt: exchange.completedAt } : {}),
    ...(exchange.message !== undefined ? { message: exchange.message } : {}),
  }));
  const importedSessions: SessionRecord[] = sessions.map((session) => ({
    id: sessionIdMap.get(session.id)!,
    title: session.title,
    createdAt: session.createdAt,
    contentUpdatedAt: session.contentUpdatedAt,
    lastOpenedAt: session.lastOpenedAt,
    ...(session.pinnedAt !== undefined ? { pinnedAt: session.pinnedAt } : {}),
    source: "imported",
    workspace: normalizeSessionWorkspace({
      ...session.workspace,
      panels: session.workspace.panels.map((panel) => ({
        ...panel,
        panelId: panelIdMap.get(panelKey(session.id, panel.panelId))!,
      })),
    }),
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
