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

export type SessionStatus = "active" | "archived" | "imported";
export type TurnStatus = "preparing" | "aborted" | "waiting" | "completed" | "partial" | "failed";
export type ExchangeSubmitStatus =
  "pending" | "prepared" | "submitted" | "aborted" | "failed" | "unavailable";
export type ExchangeResponseStatus =
  "waiting" | "streaming" | "completed" | "partial" | "timeout" | "failed" | "unsupported";

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  sequence: number;
  prompt: string;
  createdAt: string;
  status: TurnStatus;
}

export interface ProviderExchangeRecord {
  id: string;
  sessionId: string;
  turnId: string;
  panelId: string;
  providerId: ProviderId;
  providerName: string;
  targetIndex: number;
  submitStatus: ExchangeSubmitStatus;
  responseStatus: ExchangeResponseStatus;
  responseText?: string;
  submittedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface MetadataRecord {
  key: string;
  value: string;
}

export class AppDatabase extends Dexie {
  sendRecords!: EntityTable<SendRecord, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  turns!: EntityTable<TurnRecord, "id">;
  exchanges!: EntityTable<ProviderExchangeRecord, "id">;
  metadata!: EntityTable<MetadataRecord, "key">;

  constructor(name = "multi-ai-workspace-v3") {
    super(name);
    this.version(1).stores({
      sendRecords: "id, &taskId, createdAt",
    });
    this.version(2).stores({
      sendRecords: "id, &taskId, createdAt",
      sessions: "id, status, updatedAt, createdAt",
      turns: "id, sessionId, [sessionId+sequence], createdAt",
      exchanges: "id, sessionId, turnId, [turnId+providerId], providerId",
      metadata: "key",
    });
  }
}

export const db = new AppDatabase();
