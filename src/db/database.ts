import Dexie, { type EntityTable } from "dexie";
import type { ProviderId } from "../core/providers/contracts";

export interface SendTargetRecord {
  panelId: string;
  providerId: ProviderId;
  providerName: string;
  status: "submitted" | "failed" | "unavailable";
  message?: string;
}

export interface SendRecord {
  id: string;
  taskId: string;
  prompt: string;
  createdAt: string;
  targets: SendTargetRecord[];
}

export class AppDatabase extends Dexie {
  sendRecords!: EntityTable<SendRecord, "id">;

  constructor(name = "multi-ai-workspace-v3") {
    super(name);
    this.version(1).stores({
      sendRecords: "id, &taskId, createdAt",
    });
  }
}

export const db = new AppDatabase();
