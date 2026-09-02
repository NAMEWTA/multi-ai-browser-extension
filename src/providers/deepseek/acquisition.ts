export type DeepSeekAcquisitionCompleteness = "verified" | "bounded" | "partial" | "unknown";

export interface DeepSeekAcquisitionContent {
  readonly type: "text";
  readonly text: string;
  readonly markdown?: string;
}

export interface DeepSeekAcquisitionMessage {
  readonly providerMessageId: string;
  readonly parentId?: string;
  readonly role: "user" | "assistant";
  readonly sequence?: number;
  readonly content: readonly DeepSeekAcquisitionContent[];
}

export type DeepSeekAcquisitionStopReason =
  | "complete"
  | "empty"
  | "invalid-envelope"
  | "missing-active-message"
  | "broken-parent-chain"
  | "ambiguous-branch";

export interface DeepSeekAcquisitionEvidence {
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly capturedCount: number;
  readonly stopReason: DeepSeekAcquisitionStopReason;
  readonly pageCount: 1;
  readonly currentMessageId?: string;
}

export interface DeepSeekAcquisitionResult {
  readonly source: "conversation-api";
  readonly completeness: DeepSeekAcquisitionCompleteness;
  readonly messages: readonly DeepSeekAcquisitionMessage[];
  readonly evidence: DeepSeekAcquisitionEvidence;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedMessage {
  readonly message: DeepSeekAcquisitionMessage;
  readonly sourceIndex: number;
  readonly stableIdentity: boolean;
}

interface BranchSelection {
  readonly messages: readonly DeepSeekAcquisitionMessage[];
  readonly rootVerified: boolean;
  readonly stopReason: DeepSeekAcquisitionStopReason;
  readonly completeness: DeepSeekAcquisitionCompleteness;
}

const MESSAGE_PATHS = [
  ["data", "biz_data", "chat_messages"],
  ["data", "biz_data", "messages"],
  ["biz_data", "chat_messages"],
  ["biz_data", "messages"],
  ["data", "chat_messages"],
  ["data", "messages"],
  ["chat_messages"],
  ["messages"],
] as const;

const CURRENT_MESSAGE_PATHS = [
  ["data", "biz_data", "chat_session", "current_message_id"],
  ["data", "biz_data", "current_message_id"],
  ["biz_data", "chat_session", "current_message_id"],
  ["biz_data", "current_message_id"],
  ["chat_session", "current_message_id"],
  ["current_message_id"],
  ["currentMessageId"],
] as const;

const EXPECTED_COUNT_PATHS = [
  ["data", "biz_data", "total_count"],
  ["data", "biz_data", "message_count"],
  ["biz_data", "total_count"],
  ["biz_data", "message_count"],
  ["total_count"],
  ["message_count"],
  ["total"],
] as const;

const EXCLUDED_FRAGMENT_TYPES = ["think", "thinking", "reasoning", "search", "tool", "status"];
const USER_FRAGMENT_TYPES = new Set(["request", "user", "prompt"]);
const ASSISTANT_FRAGMENT_TYPES = new Set(["response", "assistant", "answer", "final"]);
const NEUTRAL_FRAGMENT_TYPES = new Set(["", "text", "markdown", "content", "paragraph", "code"]);

/**
 * Converts an already-obtained DeepSeek history response into the active conversation branch.
 * This parser is deliberately side-effect free: authentication and network access belong to core.
 */
export function parseDeepSeekHistory(payload: unknown): DeepSeekAcquisitionResult {
  const rawMessages = locateMessageArray(payload);
  if (!rawMessages) return emptyResult("invalid-envelope");

  const parsed = rawMessages.flatMap((value, index) => {
    const message = parseMessage(value, index);
    return message ? [message] : [];
  });
  if (!parsed.length) {
    const count = expectedCount(payload);
    return result(
      [],
      "unknown",
      false,
      "empty",
      count === undefined ? {} : { expectedCount: count },
    );
  }

  const currentMessageId = firstIdAtPaths(payload, CURRENT_MESSAGE_PATHS);
  const count = expectedCount(payload);
  const selection = selectBranch(parsed, currentMessageId);
  // An API total may count inactive sibling nodes, so it is not an expected count for a
  // linearized active branch unless both counts agree.
  const comparableExpectedCount =
    count === selection.messages.length ? count : currentMessageId ? undefined : count;
  return result(
    selection.messages,
    selection.completeness,
    selection.rootVerified,
    selection.stopReason,
    {
      ...(comparableExpectedCount === undefined ? {} : { expectedCount: comparableExpectedCount }),
      ...(currentMessageId ? { currentMessageId } : {}),
    },
  );
}

function parseMessage(value: unknown, sourceIndex: number): ParsedMessage | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const explicitId = firstId(raw.message_id, raw.messageId, raw.id, raw.uuid);
  const providerMessageId = explicitId ?? `deepseek-envelope-index:${sourceIndex}`;
  const parentId = firstId(raw.parent_id, raw.parentId, raw.parent_message_id);
  const role = normalizeRole(raw.role, raw.sender_role, raw.message_role, raw.type, raw.fragments);
  if (!role) return undefined;

  const text = extractMessageText(raw, role);
  if (!text) return undefined;
  const sequence = firstFiniteNumber(
    raw.sequence,
    raw.seq_id,
    raw.index,
    raw.message_index,
    raw.inserted_at,
    raw.created_at,
  );

  return {
    message: {
      providerMessageId,
      ...(parentId ? { parentId } : {}),
      role,
      ...(sequence === undefined ? {} : { sequence }),
      content: [{ type: "text", text, markdown: text }],
    },
    sourceIndex,
    stableIdentity: explicitId !== undefined,
  };
}

function extractMessageText(raw: UnknownRecord, role: DeepSeekAcquisitionMessage["role"]): string {
  const fragments = Array.isArray(raw.fragments) ? raw.fragments : [];
  const fragmentParts = fragments.flatMap((fragment) => {
    const record = asRecord(fragment);
    if (!record) return [];
    const type = normalizeType(record.type ?? record.fragment_type ?? record.kind);
    if (!isFragmentForRole(type, role)) return [];
    const text = firstText(record.content, record.text, record.markdown, record.value);
    return text ? [text] : [];
  });
  if (fragmentParts.length) return joinDistinct(fragmentParts);

  return joinDistinct(extractContentParts(raw.content, role));
}

function extractContentParts(value: unknown, role: DeepSeekAcquisitionMessage["role"]): string[] {
  if (typeof value === "string") return normalizeText(value) ? [normalizeText(value)] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractContentParts(item, role));
  const record = asRecord(value);
  if (!record) return [];
  const type = normalizeType(record.type ?? record.kind ?? record.block_type);
  if (!isFragmentForRole(type, role)) return [];
  const direct = firstText(record.text, record.markdown, record.value);
  if (direct) return [direct];
  return extractContentParts(record.content, role);
}

function isFragmentForRole(type: string, role: DeepSeekAcquisitionMessage["role"]): boolean {
  if (EXCLUDED_FRAGMENT_TYPES.some((excluded) => type.includes(excluded))) return false;
  if (USER_FRAGMENT_TYPES.has(type)) return role === "user";
  if (ASSISTANT_FRAGMENT_TYPES.has(type)) return role === "assistant";
  return NEUTRAL_FRAGMENT_TYPES.has(type);
}

function normalizeRole(...values: unknown[]): DeepSeekAcquisitionMessage["role"] | undefined {
  for (const value of values.slice(0, -1)) {
    const normalized = normalizeType(value);
    if (["user", "human", "request", "prompt"].includes(normalized)) return "user";
    if (["assistant", "bot", "model", "response", "answer"].includes(normalized)) {
      return "assistant";
    }
  }

  const fragments = values.at(-1);
  if (!Array.isArray(fragments)) return undefined;
  const types = fragments
    .map((fragment) => normalizeType(asRecord(fragment)?.type))
    .filter(Boolean);
  const hasUser = types.some((type) => USER_FRAGMENT_TYPES.has(type));
  const hasAssistant = types.some((type) => ASSISTANT_FRAGMENT_TYPES.has(type));
  if (hasUser !== hasAssistant) return hasUser ? "user" : "assistant";
  return undefined;
}

function selectBranch(
  parsed: readonly ParsedMessage[],
  currentMessageId: string | undefined,
): BranchSelection {
  const ordered = [...parsed].toSorted(compareParsedMessages).map(({ message }) => message);
  const byId = new Map(parsed.map((entry) => [entry.message.providerMessageId, entry]));

  if (currentMessageId) {
    if (!byId.has(currentMessageId)) {
      return {
        messages: ordered,
        rootVerified: false,
        stopReason: "missing-active-message",
        completeness: "partial",
      };
    }
    const walked = walkParents(byId, currentMessageId);
    return {
      messages: walked.messages,
      rootVerified: walked.rootVerified,
      stopReason: walked.rootVerified ? "complete" : "broken-parent-chain",
      completeness: walked.rootVerified ? "verified" : "partial",
    };
  }

  const parentIds = new Set(parsed.map(({ message }) => message.parentId).filter(Boolean));
  const leaves = parsed.filter(({ message }) => !parentIds.has(message.providerMessageId));
  if (leaves.length === 1 && leaves[0]?.stableIdentity) {
    const walked = walkParents(byId, leaves[0].message.providerMessageId);
    if (walked.rootVerified && walked.messages.length === parsed.length) {
      return {
        messages: walked.messages,
        rootVerified: true,
        stopReason: "complete",
        completeness: "bounded",
      };
    }
  }

  return {
    messages: ordered,
    rootVerified: false,
    stopReason: "ambiguous-branch",
    completeness: "bounded",
  };
}

function walkParents(
  byId: ReadonlyMap<string, ParsedMessage>,
  leafId: string,
): { readonly messages: readonly DeepSeekAcquisitionMessage[]; readonly rootVerified: boolean } {
  const reversed: DeepSeekAcquisitionMessage[] = [];
  const visited = new Set<string>();
  let current = byId.get(leafId)?.message;
  let rootVerified = false;

  while (current) {
    if (visited.has(current.providerMessageId)) break;
    visited.add(current.providerMessageId);
    reversed.push(current);
    if (!current.parentId) {
      rootVerified = true;
      break;
    }
    current = byId.get(current.parentId)?.message;
  }

  return { messages: reversed.reverse(), rootVerified };
}

function compareParsedMessages(left: ParsedMessage, right: ParsedMessage): number {
  const leftSequence = left.message.sequence;
  const rightSequence = right.message.sequence;
  if (leftSequence !== undefined && rightSequence !== undefined && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return left.sourceIndex - right.sourceIndex;
}

function locateMessageArray(payload: unknown): readonly unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  for (const path of MESSAGE_PATHS) {
    const value = valueAtPath(payload, path);
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function expectedCount(payload: unknown): number | undefined {
  for (const path of EXPECTED_COUNT_PATHS) {
    const value = firstFiniteNumber(valueAtPath(payload, path));
    if (value !== undefined && value >= 0) return value;
  }
  return undefined;
}

function firstIdAtPaths(
  payload: unknown,
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const path of paths) {
    const id = firstId(valueAtPath(payload, path));
    if (id) return id;
  }
  return undefined;
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function result(
  messages: readonly DeepSeekAcquisitionMessage[],
  completeness: DeepSeekAcquisitionCompleteness,
  branchRootVerified: boolean,
  stopReason: DeepSeekAcquisitionStopReason,
  options: { readonly expectedCount?: number; readonly currentMessageId?: string } = {},
): DeepSeekAcquisitionResult {
  return {
    source: "conversation-api",
    completeness,
    messages,
    evidence: {
      cursorExhausted: true,
      branchRootVerified,
      ...(options.expectedCount === undefined ? {} : { expectedCount: options.expectedCount }),
      capturedCount: messages.length,
      stopReason,
      pageCount: 1,
      ...(options.currentMessageId ? { currentMessageId: options.currentMessageId } : {}),
    },
  };
}

function emptyResult(stopReason: DeepSeekAcquisitionStopReason): DeepSeekAcquisitionResult {
  return result([], "unknown", false, stopReason);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) return String(value);
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function joinDistinct(parts: readonly string[]): string {
  return [...new Set(parts.map(normalizeText).filter(Boolean))].join("\n\n");
}
