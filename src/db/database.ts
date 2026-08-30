import Dexie, { type EntityTable } from "dexie";
import type { ProviderId } from "../core/providers/contracts";

export type SessionSource = "local" | "imported";
export type SessionLayoutMode = "tiles" | "adaptive";
export type TurnStatus = "preparing" | "aborted" | "waiting" | "completed" | "partial" | "failed";
export type ExchangeSubmitStatus =
  "pending" | "prepared" | "submitted" | "aborted" | "failed" | "unavailable";
export type ExchangeResponseStatus =
  "waiting" | "streaming" | "completed" | "partial" | "timeout" | "failed" | "unsupported";

export interface SessionWorkspacePanel {
  panelId: string;
  providerId: ProviderId;
  url: string;
  order: number;
  selected: boolean;
  widthRatio: number;
}

export interface SessionWorkspaceSnapshot {
  layoutMode: SessionLayoutMode;
  panels: SessionWorkspacePanel[];
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  contentUpdatedAt: string;
  lastOpenedAt: string;
  pinnedAt?: string;
  source: SessionSource;
  workspace: SessionWorkspaceSnapshot;
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
  sessions!: EntityTable<SessionRecord, "id">;
  turns!: EntityTable<TurnRecord, "id">;
  exchanges!: EntityTable<ProviderExchangeRecord, "id">;
  metadata!: EntityTable<MetadataRecord, "key">;

  constructor(name = "multi-ai-workspace-v4") {
    super(name);
    this.version(1).stores({
      sessions: "id, source, createdAt, contentUpdatedAt, lastOpenedAt, pinnedAt",
      turns: "id, sessionId, [sessionId+sequence], createdAt",
      exchanges: "id, sessionId, turnId, [turnId+providerId], providerId",
      metadata: "key",
    });
  }
}

export const db = new AppDatabase();
