export type QwenAcquisitionCompleteness = "verified" | "partial" | "unknown";

export interface QwenAcquisitionContent {
  readonly type: "text";
  readonly text: string;
  readonly markdown?: string;
}

export interface QwenAcquisitionMessage {
  readonly providerMessageId: string;
  readonly parentId?: string;
  readonly role: "user" | "assistant";
  readonly sequence?: number;
  readonly content: readonly QwenAcquisitionContent[];
}

export type QwenAcquisitionStopReason =
  | "complete"
  | "provider-error"
  | "invalid-envelope"
  | "empty"
  | "has-more"
  | "missing-active-message"
  | "broken-parent-chain"
  | "ambiguous-branch"
  | "unstable-message-id";

export interface QwenAcquisitionEvidence {
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly capturedCount: number;
  readonly stopReason: QwenAcquisitionStopReason;
  readonly currentMessageId?: string;
}

export interface QwenAcquisitionResult {
  readonly source: "conversation-api";
  readonly completeness: QwenAcquisitionCompleteness;
  readonly messages: readonly QwenAcquisitionMessage[];
  readonly evidence: QwenAcquisitionEvidence;
  readonly conversationId?: string;
  readonly title?: string;
}

type UnknownRecord = Record<string, unknown>;

interface CollectionPath {
  readonly path: readonly string[];
  readonly trustedDetail: boolean;
}

interface LocatedCollection {
  readonly entries: readonly (readonly [string | undefined, unknown])[];
  readonly trustedDetail: boolean;
}

interface ParsedMessage {
  readonly message: QwenAcquisitionMessage;
  readonly sourceIndex: number;
  readonly stableIdentity: boolean;
  readonly branchEligible: boolean;
}

interface BranchSelection {
  readonly messages: readonly QwenAcquisitionMessage[];
  readonly branchRootVerified: boolean;
  readonly stopReason: QwenAcquisitionStopReason;
  readonly completeness: QwenAcquisitionCompleteness;
}

const COLLECTION_PATHS: readonly CollectionPath[] = [
  { path: ["data", "chat", "history", "messages"], trustedDetail: true },
  { path: ["result", "chat", "history", "messages"], trustedDetail: true },
  { path: ["chat", "history", "messages"], trustedDetail: true },
  { path: ["data", "conversation", "messages"], trustedDetail: true },
  { path: ["result", "conversation", "messages"], trustedDetail: true },
  { path: ["conversation", "messages"], trustedDetail: true },
  { path: ["data", "session", "messages"], trustedDetail: true },
  { path: ["result", "session", "messages"], trustedDetail: true },
  { path: ["session", "messages"], trustedDetail: true },
  { path: ["data", "chat", "messages"], trustedDetail: true },
  { path: ["result", "chat", "messages"], trustedDetail: true },
  { path: ["chat", "messages"], trustedDetail: true },
  { path: ["data", "history", "messages"], trustedDetail: true },
  { path: ["result", "history", "messages"], trustedDetail: true },
  { path: ["history", "messages"], trustedDetail: true },
  { path: ["data", "messages"], trustedDetail: false },
  { path: ["result", "messages"], trustedDetail: false },
  { path: ["messages"], trustedDetail: false },
  { path: ["data", "records"], trustedDetail: false },
  { path: ["result", "records"], trustedDetail: false },
  { path: ["records"], trustedDetail: false },
];

const CURRENT_MESSAGE_PATHS = [
  ["data", "chat", "history", "current_id"],
  ["data", "chat", "history", "currentId"],
  ["data", "chat", "history", "current_message_id"],
  ["data", "chat", "history", "currentMessageId"],
  ["result", "chat", "history", "current_id"],
  ["result", "chat", "history", "current_message_id"],
  ["data", "conversation", "current_message_id"],
  ["data", "conversation", "currentMessageId"],
  ["result", "conversation", "current_message_id"],
  ["conversation", "current_message_id"],
  ["data", "current_message_id"],
  ["data", "currentMessageId"],
  ["current_message_id"],
  ["currentMessageId"],
  ["current_id"],
] as const;

const HAS_MORE_PATHS = [
  ["data", "chat", "history", "has_more"],
  ["data", "conversation", "has_more"],
  ["data", "page_info", "has_more"],
  ["data", "has_more"],
  ["result", "has_more"],
  ["page_info", "has_more"],
  ["pagination", "has_more"],
  ["has_more"],
] as const;

const EXPECTED_COUNT_PATHS = [
  ["data", "chat", "history", "message_count"],
  ["data", "chat", "history", "total_count"],
  ["data", "conversation", "message_count"],
  ["data", "conversation", "total_count"],
  ["data", "message_count"],
  ["data", "total_count"],
  ["result", "message_count"],
  ["result", "total_count"],
  ["message_count"],
  ["total_count"],
  ["total"],
] as const;

const CONVERSATION_ID_PATHS = [
  ["data", "chat", "id"],
  ["data", "chat", "chat_id"],
  ["data", "conversation", "id"],
  ["data", "conversation", "conversation_id"],
  ["result", "chat", "id"],
  ["result", "conversation", "id"],
  ["chat", "id"],
  ["conversation", "id"],
  ["chat_id"],
  ["conversation_id"],
  ["session_id"],
] as const;

const TITLE_PATHS = [
  ["data", "chat", "title"],
  ["data", "conversation", "title"],
  ["result", "chat", "title"],
  ["result", "conversation", "title"],
  ["chat", "title"],
  ["conversation", "title"],
  ["title"],
] as const;

const EXCLUDED_CONTENT_TYPES = ["think", "reasoning", "search", "tool", "status", "suggestion"];
const ANSWER_PHASES = ["answer", "final", "output", "response"];

/** Parses a previously observed Qwen conversation JSON response without performing I/O. */
export function parseQwenConversation(payload: unknown): QwenAcquisitionResult {
  if (providerRejected(payload)) return emptyResult("provider-error");
  const located = locateCollection(payload);
  if (!located) return emptyResult("invalid-envelope");

  const parsed = located.entries.flatMap(([mapKey, value], index) =>
    parseEntry(value, mapKey, index),
  );
  if (!parsed.length) return emptyResult("empty");

  const currentMessageId = firstIdAtPaths(payload, CURRENT_MESSAGE_PATHS);
  const hasMore = booleanAtPaths(payload, HAS_MORE_PATHS);
  const cursorExhausted = hasMore === false || (hasMore === undefined && located.trustedDetail);
  const selection = selectBranch(parsed, currentMessageId, cursorExhausted, hasMore === true);
  const declaredCount = firstNumberAtPaths(payload, EXPECTED_COUNT_PATHS);
  const comparableExpectedCount =
    declaredCount === selection.messages.length ? declaredCount : undefined;
  const conversationId = firstIdAtPaths(payload, CONVERSATION_ID_PATHS);
  const title = firstStringAtPaths(payload, TITLE_PATHS);

  return {
    source: "conversation-api",
    completeness: selection.completeness,
    messages: selection.messages,
    evidence: {
      cursorExhausted,
      branchRootVerified: selection.branchRootVerified,
      ...(comparableExpectedCount === undefined ? {} : { expectedCount: comparableExpectedCount }),
      capturedCount: selection.messages.length,
      stopReason: selection.stopReason,
      ...(currentMessageId ? { currentMessageId } : {}),
    },
    ...(conversationId ? { conversationId } : {}),
    ...(title ? { title } : {}),
  };
}

function parseEntry(
  value: unknown,
  mapKey: string | undefined,
  sourceIndex: number,
): ParsedMessage[] {
  const raw = asRecord(value);
  if (!raw) return [];
  const role = normalizeRole(raw.role, raw.sender_role, raw.author, raw.type);
  if (role) {
    const parsed = parseSingleMessage(raw, mapKey, sourceIndex, role);
    return parsed ? [parsed] : [];
  }
  return parseTurnRecord(raw, mapKey, sourceIndex);
}

function parseSingleMessage(
  raw: UnknownRecord,
  mapKey: string | undefined,
  sourceIndex: number,
  role: QwenAcquisitionMessage["role"],
): ParsedMessage | undefined {
  const explicitId = firstId(
    raw.message_id,
    raw.messageId,
    raw.id,
    raw.fid,
    raw.req_id,
    raw.request_id,
    mapKey,
  );
  const providerMessageId = explicitId ?? `qwen-envelope-index:${sourceIndex}`;
  const parentId = firstId(raw.parent_id, raw.parentId, raw.parent_message_id, raw.parentMessageId);
  const text = extractMessageText(raw, role);
  if (!text) return undefined;
  const sequence = messageSequence(raw);

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
    branchEligible: true,
  };
}

function parseTurnRecord(
  raw: UnknownRecord,
  mapKey: string | undefined,
  sourceIndex: number,
): ParsedMessage[] {
  const baseId = firstId(raw.request_id, raw.req_id, raw.turn_id, raw.id, mapKey);
  const stableIdentity = baseId !== undefined;
  const generatedBase = baseId ?? `qwen-turn-index:${sourceIndex}`;
  const request = firstRecord(raw.user_message, raw.request_message, raw.request);
  const response = firstRecord(raw.assistant_message, raw.response_message, raw.response);
  const userText =
    (request ? extractMessageText(request, "user") : undefined) ??
    firstText(raw.question, raw.query, raw.prompt, asRecord(raw.meta_data)?.ori_query);
  const assistantText =
    (response ? extractMessageText(response, "assistant") : undefined) ??
    firstText(raw.answer, raw.output, typeof raw.response === "string" ? raw.response : undefined);
  if (!userText && !assistantText) return [];

  const sequence = messageSequence(raw);
  const parentId = firstId(raw.parent_id, raw.parent_req_id, raw.parent_request_id);
  const userId = `${generatedBase}:user`;
  const messages: ParsedMessage[] = [];
  if (userText) {
    messages.push({
      message: {
        providerMessageId: userId,
        ...(parentId ? { parentId } : {}),
        role: "user",
        ...(sequence === undefined ? {} : { sequence: sequence * 2 }),
        content: [{ type: "text", text: userText, markdown: userText }],
      },
      sourceIndex: sourceIndex * 2,
      stableIdentity,
      branchEligible: false,
    });
  }
  if (assistantText) {
    const assistantId = `${generatedBase}:assistant`;
    messages.push({
      message: {
        providerMessageId: assistantId,
        ...(userText ? { parentId: userId } : parentId ? { parentId } : {}),
        role: "assistant",
        ...(sequence === undefined ? {} : { sequence: sequence * 2 + 1 }),
        content: [{ type: "text", text: assistantText, markdown: assistantText }],
      },
      sourceIndex: sourceIndex * 2 + 1,
      stableIdentity,
      branchEligible: false,
    });
  }
  return messages;
}

function extractMessageText(raw: UnknownRecord, role: QwenAcquisitionMessage["role"]): string {
  const contentList = arrayValue(raw.content_list, raw.contentList, raw.contents, raw.parts);
  if (contentList) {
    const fromPhases = extractContentList(contentList, role);
    if (fromPhases) return fromPhases;
  }

  for (const value of [raw.content, raw.message_content, raw.text, raw.markdown]) {
    const parts = extractContentParts(parseMaybeJson(value));
    if (parts.length) return joinDistinct(parts);
  }

  if (role === "user") {
    return firstText(raw.query, raw.question, raw.prompt, asRecord(raw.meta_data)?.ori_query) ?? "";
  }
  return firstText(raw.answer, raw.output) ?? "";
}

function extractContentList(
  contentList: readonly unknown[],
  role: QwenAcquisitionMessage["role"],
): string {
  const records = contentList
    .map(asRecord)
    .filter((value): value is UnknownRecord => Boolean(value));
  const hasAnswerPhase = records.some((record) =>
    ANSWER_PHASES.some((phase) => normalizeType(record.phase).includes(phase)),
  );
  const parts = records.flatMap((record) => {
    const phase = normalizeType(record.phase ?? record.stage);
    const type = normalizeType(record.type ?? record.kind ?? record.content_type);
    if (
      EXCLUDED_CONTENT_TYPES.some((excluded) => phase.includes(excluded) || type.includes(excluded))
    ) {
      return [];
    }
    if (
      role === "assistant" &&
      hasAnswerPhase &&
      !ANSWER_PHASES.some((answer) => phase.includes(answer))
    ) {
      return [];
    }
    return extractContentParts(record);
  });
  return mergeProgressiveParts(parts);
}

function extractContentParts(value: unknown): string[] {
  if (typeof value === "string") {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(extractContentParts);
  const record = asRecord(value);
  if (!record) return [];
  const phase = normalizeType(record.phase ?? record.stage);
  const type = normalizeType(record.type ?? record.kind ?? record.content_type);
  if (
    EXCLUDED_CONTENT_TYPES.some((excluded) => phase.includes(excluded) || type.includes(excluded))
  ) {
    return [];
  }

  const parts: string[] = [];
  for (const key of ["text", "markdown", "content", "value"] as const) {
    if (record[key] !== undefined) parts.push(...extractContentParts(record[key]));
  }
  for (const key of ["parts", "blocks", "items"] as const) {
    if (record[key] !== undefined) parts.push(...extractContentParts(record[key]));
  }
  return parts;
}

function selectBranch(
  parsed: readonly ParsedMessage[],
  currentMessageId: string | undefined,
  cursorExhausted: boolean,
  hasMore: boolean,
): BranchSelection {
  const ordered = [...parsed].toSorted(compareParsed).map(({ message }) => message);
  if (parsed.some((entry) => !entry.stableIdentity)) {
    return partial(ordered, "unstable-message-id");
  }
  if (hasMore) return partial(ordered, "has-more");
  if (!parsed.every((entry) => entry.branchEligible)) {
    return partial(ordered, "ambiguous-branch");
  }
  if (!currentMessageId) return partial(ordered, "ambiguous-branch");

  const byId = new Map(parsed.map((entry) => [entry.message.providerMessageId, entry.message]));
  if (!byId.has(currentMessageId)) return partial(ordered, "missing-active-message");
  const walked = walkParents(byId, currentMessageId);
  if (!walked.rootVerified) return partial(walked.messages, "broken-parent-chain");
  if (!cursorExhausted) return partial(walked.messages, "ambiguous-branch", true);
  return {
    messages: walked.messages,
    branchRootVerified: true,
    stopReason: "complete",
    completeness: "verified",
  };
}

function partial(
  messages: readonly QwenAcquisitionMessage[],
  stopReason: QwenAcquisitionStopReason,
  branchRootVerified = false,
): BranchSelection {
  return {
    messages,
    branchRootVerified,
    stopReason,
    completeness: "partial",
  };
}

function walkParents(
  byId: ReadonlyMap<string, QwenAcquisitionMessage>,
  leafId: string,
): { readonly messages: readonly QwenAcquisitionMessage[]; readonly rootVerified: boolean } {
  const reversed: QwenAcquisitionMessage[] = [];
  const visited = new Set<string>();
  let current = byId.get(leafId);
  let rootVerified = false;
  while (current) {
    if (visited.has(current.providerMessageId)) break;
    visited.add(current.providerMessageId);
    reversed.push(current);
    if (!current.parentId) {
      rootVerified = true;
      break;
    }
    current = byId.get(current.parentId);
  }
  return { messages: reversed.reverse(), rootVerified };
}

function compareParsed(left: ParsedMessage, right: ParsedMessage): number {
  if (
    left.message.sequence !== undefined &&
    right.message.sequence !== undefined &&
    left.message.sequence !== right.message.sequence
  ) {
    return left.message.sequence - right.message.sequence;
  }
  return left.sourceIndex - right.sourceIndex;
}

function locateCollection(payload: unknown): LocatedCollection | undefined {
  for (const candidate of COLLECTION_PATHS) {
    const collection = valueAtPath(payload, candidate.path);
    if (Array.isArray(collection)) {
      return {
        entries: collection.map((value) => [undefined, value] as const),
        trustedDetail: candidate.trustedDetail,
      };
    }
    const record = asRecord(collection);
    if (record) {
      return {
        entries: Object.entries(record),
        trustedDetail: candidate.trustedDetail,
      };
    }
  }
  return undefined;
}

function providerRejected(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  if (record.success === false || record.ok === false) return true;
  const code = record.code ?? asRecord(record.data)?.code;
  return typeof code === "number" && code !== 0 && code !== 200;
}

function messageSequence(raw: UnknownRecord): number | undefined {
  return firstFiniteNumber(
    raw.sequence,
    raw.seq,
    raw.index,
    raw.message_index,
    raw.timestamp,
    raw.created_at,
    raw.create_time,
    raw.createdAt,
  );
}

function booleanAtPaths(
  payload: unknown,
  paths: readonly (readonly string[])[],
): boolean | undefined {
  for (const path of paths) {
    const value = valueAtPath(payload, path);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function firstIdAtPaths(
  payload: unknown,
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const path of paths) {
    const value = firstId(valueAtPath(payload, path));
    if (value) return value;
  }
  return undefined;
}

function firstStringAtPaths(
  payload: unknown,
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const path of paths) {
    const value = valueAtPath(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumberAtPaths(
  payload: unknown,
  paths: readonly (readonly string[])[],
): number | undefined {
  for (const path of paths) {
    const value = firstFiniteNumber(valueAtPath(payload, path));
    if (value !== undefined && value >= 0) return value;
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

function emptyResult(stopReason: QwenAcquisitionStopReason): QwenAcquisitionResult {
  return {
    source: "conversation-api",
    completeness: "unknown",
    messages: [],
    evidence: {
      cursorExhausted: false,
      branchRootVerified: false,
      capturedCount: 0,
      stopReason,
    },
  };
}

function firstRecord(...values: unknown[]): UnknownRecord | undefined {
  return values.map(asRecord).find(Boolean);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function normalizeRole(...values: unknown[]): QwenAcquisitionMessage["role"] | undefined {
  for (const value of values) {
    const normalized = normalizeType(
      typeof value === "object" ? (asRecord(value)?.role ?? asRecord(value)?.name) : value,
    );
    if (["user", "human", "request", "prompt"].includes(normalized)) return "user";
    if (["assistant", "bot", "model", "response", "answer"].includes(normalized)) {
      return "assistant";
    }
  }
  return undefined;
}

function arrayValue(...values: unknown[]): readonly unknown[] | undefined {
  return values.find(Array.isArray) as readonly unknown[] | undefined;
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) return String(value);
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

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function mergeProgressiveParts(parts: readonly string[]): string {
  let accumulated = "";
  for (const raw of parts) {
    const part = normalizeText(raw);
    if (!part) continue;
    if (!accumulated || part.startsWith(accumulated)) {
      accumulated = part;
    } else if (!accumulated.startsWith(part) && !accumulated.endsWith(part)) {
      accumulated += part;
    }
  }
  return accumulated.trim();
}

function joinDistinct(parts: readonly string[]): string {
  return [...new Set(parts.map(normalizeText).filter(Boolean))].join("\n\n");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}
