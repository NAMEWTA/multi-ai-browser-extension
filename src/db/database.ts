import Dexie, { type EntityTable } from "dexie";
import type {
  AcquisitionCompleteness,
  AcquisitionEvidence,
  AcquisitionSource,
  ContentBlock,
  ConversationRole,
} from "../core/acquisition/contracts";
import type {
  NativeCopyMimeType,
  ProviderId,
  ResponseCaptureSource,
  ResponseTerminalReason,
} from "../core/providers/contracts";

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
  /** The question before reusable prompt templates were applied. */
  userQuestion?: string;
  /** Immutable snapshots of the templates used for this send. */
  appliedPromptTemplates?: AppliedPromptTemplate[];
  createdAt: string;
  status: TurnStatus;
}

export interface AppliedPromptTemplate {
  id: string;
  name: string;
  content: string;
  order: number;
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
  responseMarkdown?: string;
  captureId?: string;
  responseRevision?: number;
  responseObservedAt?: string;
  terminalReason?: ResponseTerminalReason;
  captureSource?: ResponseCaptureSource;
  nativeMimeType?: NativeCopyMimeType;
  submittedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface MetadataRecord {
  key: string;
  value: string;
}

export type AcquisitionVerification = "verified" | "bounded" | "partial" | "unknown";

/**
 * Immutable persistence envelope for one provider message revision.
 * Conversation-level acquisition metadata is copied onto every revision so it can be audited later.
 */
export interface AcquisitionSnapshotRecord {
  id: string;
  schemaVersion: 2;
  turnId: string;
  panelId: string;
  providerId: ProviderId;
  conversationId: string;
  providerMessageId: string;
  revision: number;
  role: ConversationRole;
  content: readonly ContentBlock[];
  parentId?: string;
  branchId?: string;
  messageCreatedAt?: number;
  source: AcquisitionSource;
  completeness: AcquisitionCompleteness;
  verification: AcquisitionVerification;
  /** True only for the assistant message selected as this extension turn's response. */
  selected?: boolean;
  evidence: AcquisitionEvidence;
  adapterVersion: string;
  capturedAt: number;
  persistedAt: number;
}

export class AppDatabase extends Dexie {
  sessions!: EntityTable<SessionRecord, "id">;
  turns!: EntityTable<TurnRecord, "id">;
  exchanges!: EntityTable<ProviderExchangeRecord, "id">;
  metadata!: EntityTable<MetadataRecord, "key">;
  acquisitionSnapshots!: EntityTable<AcquisitionSnapshotRecord, "id">;

  constructor(name = "multi-ai-workspace-v4") {
    super(name);
    this.version(1).stores({
      sessions: "id, source, createdAt, contentUpdatedAt, lastOpenedAt, pinnedAt",
      turns: "id, sessionId, [sessionId+sequence], createdAt",
      exchanges: "id, sessionId, turnId, [turnId+providerId], providerId",
      metadata: "key",
    });
    this.version(2).stores({
      sessions: "id, source, createdAt, contentUpdatedAt, lastOpenedAt, pinnedAt",
      turns: "id, sessionId, [sessionId+sequence], createdAt",
      exchanges: "id, sessionId, turnId, [turnId+providerId], providerId",
      metadata: "key",
      acquisitionSnapshots:
        "id, [turnId+panelId], [providerId+conversationId+providerMessageId], &[providerId+conversationId+providerMessageId+revision], capturedAt, persistedAt",
    });
    this.version(3).stores({
      sessions: "id, source, createdAt, contentUpdatedAt, lastOpenedAt, pinnedAt",
      turns: "id, sessionId, [sessionId+sequence], createdAt",
      exchanges: "id, sessionId, turnId, [turnId+providerId], providerId",
      metadata: "key",
      acquisitionSnapshots:
        "id, turnId, [turnId+panelId], [providerId+conversationId+providerMessageId], &[turnId+panelId+providerId+conversationId+providerMessageId+revision], capturedAt, persistedAt",
    });
  }
}

export const db = new AppDatabase();
