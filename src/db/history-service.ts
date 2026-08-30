import type { ProviderRunResult } from "../core/messaging/protocol";
import type { ProviderId } from "../core/providers/contracts";
import { db, type SendRecord, type SendTargetRecord } from "./database";

interface SaveSendTarget {
  panelId: string;
  providerId: ProviderId;
  providerName: string;
}

export async function saveSendRecord(
  taskId: string,
  prompt: string,
  targets: readonly SaveSendTarget[],
  results: readonly ProviderRunResult[],
): Promise<SendRecord> {
  const byPanel = new Map(results.map((result) => [result.panelId, result]));
  const record: SendRecord = {
    id: crypto.randomUUID(),
    taskId,
    prompt,
    createdAt: new Date().toISOString(),
    targets: targets.map((target): SendTargetRecord => {
      const result = byPanel.get(target.panelId);
      const status =
        result?.status === "submitted" || result?.status === "duplicate"
          ? "submitted"
          : result?.status === "failed"
            ? "failed"
            : "unavailable";
      return {
        ...target,
        status,
        ...(result?.message ? { message: result.message } : {}),
      };
    }),
  };
  await db.sendRecords.add(record);
  return record;
}

export async function listSendRecords(limit = 100): Promise<SendRecord[]> {
  return await db.sendRecords.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function getSendRecord(id: string): Promise<SendRecord | undefined> {
  return await db.sendRecords.get(id);
}

export async function deleteSendRecord(id: string): Promise<void> {
  await db.sendRecords.delete(id);
}
