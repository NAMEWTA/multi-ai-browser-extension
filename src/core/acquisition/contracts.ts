import type { ProviderId } from "../providers/contracts";

export const acquisitionSources = [
  "provider-api",
  "network",
  "native-copy",
  "virtual-dom",
  "dom",
] as const;

export type AcquisitionSource = (typeof acquisitionSources)[number];
export type ConversationRole = "user" | "assistant" | "system" | "tool" | "unknown";
export type ContentBlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "list"
  | "table"
  | "quote"
  | "math"
  | "image"
  | "attachment"
  | "unknown";

export type AcquisitionMetadataValue = string | number | boolean | null;

export interface ContentBlock {
  readonly kind: ContentBlockKind;
  readonly text: string;
  readonly markdown?: string;
  readonly language?: string;
  readonly url?: string;
  readonly attributes?: Readonly<Record<string, AcquisitionMetadataValue>>;
}

export interface Message {
  /** Stable within one provider conversation. */
  readonly id: string;
  readonly role: ConversationRole;
  readonly content: readonly ContentBlock[];
  readonly parentId?: string;
  readonly branchId?: string;
  readonly createdAt?: number;
}

export type AcquisitionCompletenessState = "complete" | "partial" | "unknown";

export interface AcquisitionCompleteness {
  readonly state: AcquisitionCompletenessState;
  readonly capturedMessageCount: number;
  readonly expectedMessageCount?: number;
  readonly capturedContentChars: number;
  readonly expectedContentChars?: number;
  readonly hasBeginning?: boolean;
  readonly hasEnd?: boolean;
}

export interface CursorEvidence {
  readonly value?: string;
  readonly hasMore: boolean;
  readonly reachedStart?: boolean;
  readonly reachedEnd?: boolean;
}

export interface BranchEvidence {
  readonly branchId?: string;
  readonly currentNodeId?: string;
  readonly capturedNodeIds: readonly string[];
  readonly linearized: boolean;
  readonly complete: boolean;
}

export interface AcquisitionEvidence {
  readonly stableMessageKeys: readonly string[];
  readonly signals: readonly string[];
  readonly cursor?: CursorEvidence;
  readonly branch?: BranchEvidence;
}

export type AcquisitionDiagnosticSeverity = "info" | "warning" | "error";

export interface AcquisitionDiagnostic {
  readonly code: string;
  readonly severity: AcquisitionDiagnosticSeverity;
  readonly message: string;
  readonly messageId?: string;
  readonly details?: Readonly<Record<string, AcquisitionMetadataValue>>;
}

export interface AcquisitionDiagnostics {
  readonly strategyId: string;
  readonly durationMs?: number;
  readonly entries: readonly AcquisitionDiagnostic[];
}

export interface ConversationSnapshot {
  readonly schemaVersion: 1;
  readonly providerId: ProviderId;
  readonly conversationId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly capturedAt: number;
  readonly messages: readonly Message[];
  /** One snapshot always has exactly one acquisition source. */
  readonly source: AcquisitionSource;
  readonly completeness: AcquisitionCompleteness;
  readonly evidence: AcquisitionEvidence;
  readonly diagnostics: AcquisitionDiagnostics;
}

export interface AcquisitionContext {
  readonly providerId: ProviderId;
  readonly document?: Document;
  readonly window?: Window;
  readonly signal?: AbortSignal;
  readonly requestId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface AcquisitionStrategy {
  readonly id: string;
  readonly source: AcquisitionSource;
  acquire(context: AcquisitionContext): Promise<ConversationSnapshot | undefined>;
}

export interface AcquisitionQualityPolicy {
  readonly statusTerms?: readonly string[];
  readonly minimumMessageRatio?: number;
  readonly minimumContentRatio?: number;
  readonly requireComplete?: boolean;
  readonly requireTerminalCursor?: boolean;
  readonly requireBranchEvidence?: boolean;
}

export interface ProviderAcquisitionAdapter {
  readonly providerId: ProviderId;
  /** Earlier entries have higher priority. The engine never blends their results. */
  readonly strategiesByPriority: readonly AcquisitionStrategy[];
  readonly qualityPolicy?: AcquisitionQualityPolicy;
}

export interface AcquisitionQualityReport {
  readonly accepted: boolean;
  readonly diagnostics: readonly AcquisitionDiagnostic[];
}

export type AcquisitionAttemptStatus = "unavailable" | "rejected" | "error" | "selected";

export interface AcquisitionAttempt {
  readonly strategyId: string;
  readonly source: AcquisitionSource;
  readonly status: AcquisitionAttemptStatus;
  readonly diagnostics: readonly AcquisitionDiagnostic[];
}

export interface AcquisitionSelection {
  readonly snapshot: ConversationSnapshot;
  readonly selectedStrategyId: string;
  readonly attempts: readonly AcquisitionAttempt[];
}
