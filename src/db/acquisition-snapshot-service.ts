import type { ConversationSnapshot, Message } from "../core/acquisition/contracts";
import { db, type AcquisitionSnapshotRecord, type AcquisitionVerification } from "./database";

export interface SaveAcquisitionSnapshotInput {
  readonly turnId: string;
  readonly panelId: string;
  readonly providerMessageId: string;
  readonly revision: number;
  readonly adapterVersion: string;
  readonly verification: AcquisitionVerification;
  readonly snapshot: ConversationSnapshot;
}

export interface AcquisitionSnapshotWriteResult {
  readonly record: AcquisitionSnapshotRecord;
  readonly inserted: boolean;
}

export interface CurrentFinalAcquisitionBody {
  readonly text: string;
  readonly markdown: string;
  readonly snapshot: AcquisitionSnapshotRecord;
}

const FINAL_VERIFICATIONS = new Set<AcquisitionVerification>(["verified", "bounded"]);

/**
 * Persists one immutable message revision. Retrying the same provider identity returns the first
 * committed record instead of mutating evidence or promoting its completeness.
 */
export async function saveAcquisitionSnapshot(
  input: SaveAcquisitionSnapshotInput,
): Promise<AcquisitionSnapshotWriteResult> {
  validateInput(input);
  const records = input.snapshot.messages.map((message) =>
    toRecord(input, message, message.id === input.providerMessageId),
  );
  const selectedRecord = records.find((record) => record.selected);
  if (!selectedRecord) {
    throw new Error(`snapshot does not contain message id: ${input.providerMessageId}`);
  }

  return await db.transaction("rw", db.acquisitionSnapshots, async () => {
    let selectedResult: AcquisitionSnapshotWriteResult | undefined;
    for (const record of records) {
      const existing = await db.acquisitionSnapshots.get(record.id);
      if (!existing) await db.acquisitionSnapshots.add(record);
      if (record.selected) {
        selectedResult = { record: existing ?? record, inserted: !existing };
      }
    }
    return selectedResult!;
  });
}

/** Returns the newest persisted revision for a turn/panel, regardless of completeness. */
export async function getCurrentAcquisitionSnapshot(
  turnId: string,
  panelId: string,
): Promise<AcquisitionSnapshotRecord | undefined> {
  requireIdentity("turnId", turnId);
  requireIdentity("panelId", panelId);

  const records = await db.acquisitionSnapshots
    .where("[turnId+panelId]")
    .equals([turnId, panelId])
    .toArray();
  const latestByProviderMessage = new Map<string, AcquisitionSnapshotRecord>();
  for (const record of records) {
    const key = JSON.stringify([
      record.providerId,
      record.conversationId,
      record.providerMessageId,
    ]);
    const previous = latestByProviderMessage.get(key);
    if (!previous || record.revision > previous.revision) {
      latestByProviderMessage.set(key, record);
    }
  }
  const currentMessages = [...latestByProviderMessage.values()];
  const selected = currentMessages.filter((record) => record.selected !== false);
  return (selected.length ? selected : currentMessages).toSorted(compareCapturedNewestFirst)[0];
}

/**
 * Returns a final body only when the current revision is complete and its verification is strong
 * enough. It deliberately does not fall back to an older final revision when the current one is
 * partial or unknown.
 */
export async function getCurrentFinalAcquisitionBody(
  turnId: string,
  panelId: string,
): Promise<CurrentFinalAcquisitionBody | undefined> {
  const current = await getCurrentAcquisitionSnapshot(turnId, panelId);
  if (!current || !isFinalSnapshot(current)) return undefined;

  const text = contentText(current.content, false);
  if (!text) return undefined;
  return {
    text,
    markdown: contentText(current.content, true),
    snapshot: current,
  };
}

function validateInput(input: SaveAcquisitionSnapshotInput): void {
  requireIdentity("turnId", input.turnId);
  requireIdentity("panelId", input.panelId);
  requireIdentity("providerMessageId", input.providerMessageId);
  requireIdentity("adapterVersion", input.adapterVersion);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error("revision must be a non-negative safe integer");
  }
  if (!Number.isFinite(input.snapshot.capturedAt)) {
    throw new Error("snapshot.capturedAt must be finite");
  }
  requireIdentity("snapshot.conversationId", input.snapshot.conversationId);
  findMessage(input.snapshot.messages, input.providerMessageId);
}

function toRecord(
  input: SaveAcquisitionSnapshotInput,
  message: Message,
  selected: boolean,
): AcquisitionSnapshotRecord {
  const conversationId = input.snapshot.conversationId!;
  const persistedAt = Date.now();

  return {
    id: snapshotId(
      input.turnId,
      input.panelId,
      input.snapshot.providerId,
      conversationId,
      message.id,
      input.revision,
    ),
    schemaVersion: 2,
    turnId: input.turnId,
    panelId: input.panelId,
    providerId: input.snapshot.providerId,
    conversationId,
    providerMessageId: message.id,
    revision: input.revision,
    role: message.role,
    content: message.content,
    ...(message.parentId === undefined ? {} : { parentId: message.parentId }),
    ...(message.branchId === undefined ? {} : { branchId: message.branchId }),
    ...(message.createdAt === undefined ? {} : { messageCreatedAt: message.createdAt }),
    source: input.snapshot.source,
    completeness: input.snapshot.completeness,
    verification: input.verification,
    selected,
    evidence: input.snapshot.evidence,
    adapterVersion: input.adapterVersion,
    capturedAt: input.snapshot.capturedAt,
    persistedAt,
  };
}

function findMessage(messages: readonly Message[], providerMessageId: string): Message {
  const matches = messages.filter((message) => message.id === providerMessageId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `snapshot contains duplicate message id: ${providerMessageId}`
        : `snapshot does not contain message id: ${providerMessageId}`,
    );
  }
  return matches[0]!;
}

function snapshotId(
  turnId: string,
  panelId: string,
  providerId: string,
  conversationId: string,
  providerMessageId: string,
  revision: number,
): string {
  return JSON.stringify([turnId, panelId, providerId, conversationId, providerMessageId, revision]);
}

function requireIdentity(name: string, value: string | undefined): asserts value is string {
  if (!value?.trim()) throw new Error(`${name} must not be empty`);
}

function compareCapturedNewestFirst(
  left: AcquisitionSnapshotRecord,
  right: AcquisitionSnapshotRecord,
): number {
  if (left.capturedAt !== right.capturedAt) return right.capturedAt - left.capturedAt;
  if (left.persistedAt !== right.persistedAt) return right.persistedAt - left.persistedAt;
  return right.id.localeCompare(left.id);
}

function isFinalSnapshot(record: AcquisitionSnapshotRecord): boolean {
  if (record.role !== "assistant") return false;
  if (record.completeness.state !== "complete") return false;
  if (!FINAL_VERIFICATIONS.has(record.verification)) return false;
  if (record.completeness.hasBeginning === false || record.completeness.hasEnd === false) {
    return false;
  }

  const cursor = record.evidence.cursor;
  if (cursor?.hasMore || cursor?.reachedEnd === false) return false;
  const branch = record.evidence.branch;
  if (branch && (!branch.complete || !branch.linearized)) return false;
  return true;
}

function contentText(content: AcquisitionSnapshotRecord["content"], markdown: boolean): string {
  return content
    .map((block) => (markdown ? (block.markdown ?? block.text) : block.text).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
