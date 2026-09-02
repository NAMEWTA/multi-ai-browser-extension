export type DoubaoAcquisitionCompleteness = "verified" | "bounded" | "partial" | "unknown";

export interface DoubaoAcquisitionContent {
  readonly type: "text";
  readonly text: string;
  readonly markdown?: string;
}

export interface DoubaoAcquisitionMessage {
  readonly providerMessageId: string;
  readonly parentId?: string;
  readonly role: "user" | "assistant";
  readonly sequence?: number;
  readonly content: readonly DoubaoAcquisitionContent[];
}

export type DoubaoAcquisitionStopReason =
  | "complete"
  | "has-more"
  | "duplicate-cursor"
  | "duplicate-page"
  | "missing-next-cursor"
  | "invalid-page"
  | "max-pages";

export interface DoubaoAcquisitionEvidence {
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly capturedCount: number;
  readonly stopReason: DoubaoAcquisitionStopReason;
  readonly pageCount: number;
}

export interface DoubaoAcquisitionResult {
  readonly source: "conversation-api";
  readonly completeness: DoubaoAcquisitionCompleteness;
  readonly messages: readonly DoubaoAcquisitionMessage[];
  readonly evidence: DoubaoAcquisitionEvidence;
}

export interface DoubaoPaginationState {
  readonly source: "conversation-api";
  readonly messages: readonly DoubaoAcquisitionMessage[];
  readonly seenCursors: readonly string[];
  readonly seenPageSignatures: readonly string[];
  readonly pageCount: number;
  readonly maxPages: number;
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly nextCursor?: string;
  readonly stopReason: DoubaoAcquisitionStopReason;
  readonly terminal: boolean;
}

export interface DoubaoPageTransition {
  readonly state: DoubaoPaginationState;
  readonly result: DoubaoAcquisitionResult;
  readonly nextCursor?: string;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedPage {
  readonly messages: readonly DoubaoAcquisitionMessage[];
  readonly hasMore: boolean;
  readonly explicitCursor?: string;
  readonly expectedCount?: number;
  readonly signature: string;
}

const BODY_PATHS = [
  ["downlink_body", "pull_singe_chain_downlink_body"],
  ["downlink_body", "pull_single_chain_downlink_body"],
  ["pull_singe_chain_downlink_body"],
  ["pull_single_chain_downlink_body"],
  ["data", "downlink_body", "pull_singe_chain_downlink_body"],
  ["data", "downlink_body", "pull_single_chain_downlink_body"],
] as const;

const EXCLUDED_BLOCK_TYPES = ["think", "reasoning", "search", "tool", "status", "suggestion"];
const CONTENT_KEYS = [
  "text",
  "markdown",
  "content",
  "paragraph",
  "code",
  "quote",
  "title",
  "text_block",
  "markdown_block",
  "code_block",
  "quote_block",
] as const;

export function createDoubaoPaginationState(
  options: { readonly maxPages?: number } = {},
): DoubaoPaginationState {
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? 1_000));
  return {
    source: "conversation-api",
    messages: [],
    seenCursors: [],
    seenPageSignatures: [],
    pageCount: 0,
    maxPages,
    cursorExhausted: false,
    branchRootVerified: false,
    stopReason: "has-more",
    terminal: false,
  };
}

/**
 * Consumes one already-fetched `/im/chain/single` response. The state contains API data only;
 * accepting DOM messages here would make ordering and completeness evidence ambiguous.
 */
export function parseDoubaoChainPage(
  payload: unknown,
  state: DoubaoPaginationState,
  requestCursor?: string | number,
): DoubaoPageTransition {
  if (state.terminal) return transition(state);
  if (state.pageCount >= state.maxPages) {
    return transition(finish(state, "max-pages"));
  }

  const normalizedRequestCursor = normalizeCursor(requestCursor);
  if (normalizedRequestCursor && state.seenCursors.includes(normalizedRequestCursor)) {
    return transition(finish(state, "duplicate-cursor"));
  }

  const page = parsePage(payload, state.pageCount + 1);
  const seenCursors = normalizedRequestCursor
    ? [...state.seenCursors, normalizedRequestCursor]
    : state.seenCursors;
  const pageCount = state.pageCount + 1;
  if (!page) {
    return transition(finish({ ...state, seenCursors, pageCount }, "invalid-page"));
  }

  if (state.seenPageSignatures.includes(page.signature)) {
    return transition(finish({ ...state, seenCursors, pageCount }, "duplicate-page"));
  }

  const messages = mergeMessages(state.messages, page.messages);
  const expectedCount = maximumDefined(state.expectedCount, page.expectedCount);
  const nextBase: DoubaoPaginationState = {
    ...withoutNextCursor(state),
    messages,
    seenCursors,
    seenPageSignatures: [...state.seenPageSignatures, page.signature],
    pageCount,
    ...(expectedCount === undefined ? {} : { expectedCount }),
  };

  if (!page.hasMore) {
    return transition({
      ...nextBase,
      cursorExhausted: true,
      branchRootVerified: true,
      stopReason: "complete",
      terminal: true,
    });
  }

  const nextCursor = page.explicitCursor ?? deriveCursor(page.messages, normalizedRequestCursor);
  if (!nextCursor) return transition(finish(nextBase, "missing-next-cursor"));
  if (nextCursor === normalizedRequestCursor || seenCursors.includes(nextCursor)) {
    return transition(finish(nextBase, "duplicate-cursor"));
  }
  if (pageCount >= state.maxPages) return transition(finish(nextBase, "max-pages"));

  return transition({
    ...nextBase,
    nextCursor,
    stopReason: "has-more",
    terminal: false,
  });
}

function parsePage(payload: unknown, pageOrdinal: number): ParsedPage | undefined {
  const body = locateBody(payload);
  if (!body || !Array.isArray(body.messages)) return undefined;
  const messages = body.messages.flatMap((value, index) => {
    const message = parseMessage(value, index, pageOrdinal);
    return message ? [message] : [];
  });
  const explicitCursor = explicitNextCursor(body);
  const expectedCount = firstNonNegativeInteger(
    body.total_count,
    body.message_count,
    body.total,
    asRecord(body.page_info)?.total_count,
  );
  return {
    messages,
    hasMore: body.has_more === true || body.hasMore === true,
    ...(explicitCursor ? { explicitCursor } : {}),
    ...(expectedCount === undefined ? {} : { expectedCount }),
    signature: pageSignature(body.messages, pageOrdinal),
  };
}

function parseMessage(
  value: unknown,
  pageIndex: number,
  pageOrdinal: number,
): DoubaoAcquisitionMessage | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const role = inferRole(raw);
  if (!role) return undefined;
  const sequence = messageSequence(raw);
  const explicitId = firstId(raw.message_id, raw.id, raw.server_message_id, raw.local_message_id);
  const providerMessageId =
    explicitId ??
    (sequence === undefined
      ? `doubao-page:${pageOrdinal}:item:${pageIndex}:${role}`
      : `doubao-sequence:${sequence}:${role}`);
  const parentId = firstId(raw.parent_id, raw.parent_message_id, raw.reply_to_message_id);
  const text = messageText(raw);
  if (!text) return undefined;

  return {
    providerMessageId,
    ...(parentId ? { parentId } : {}),
    role,
    ...(sequence === undefined ? {} : { sequence }),
    content: [{ type: "text", text, markdown: text }],
  };
}

function inferRole(raw: UnknownRecord): DoubaoAcquisitionMessage["role"] | undefined {
  for (const candidate of [raw.role, raw.sender_role, asRecord(raw.sender)?.role]) {
    const role = typeof candidate === "string" ? candidate.trim().toLocaleLowerCase() : "";
    if (["user", "human", "request"].includes(role)) return "user";
    if (["assistant", "bot", "model", "response"].includes(role)) return "assistant";
  }

  const senderType = firstFiniteNumber(raw.sender_type, raw.user_type);
  if (senderType === 1) return "user";
  if (senderType === 2) return "assistant";
  if (firstId(raw.from_user_id, asRecord(raw.sender)?.user_id)) return "user";
  if (firstId(raw.bot_reply_message_id, raw.reply_id)) return "assistant";
  return undefined;
}

function messageText(raw: UnknownRecord): string {
  const contentBlock = parseMaybeJson(raw.content_block);
  const blockParts = extractContentParts(contentBlock);
  if (blockParts.length) return joinDistinct(blockParts);

  for (const candidate of [
    raw.content_obj,
    raw.message_content,
    raw.content,
    raw.text,
    raw.brief,
    raw.tts_content,
  ]) {
    const parts = extractContentParts(parseMaybeJson(candidate));
    if (parts.length) return joinDistinct(parts);
  }
  return "";
}

function extractContentParts(value: unknown): string[] {
  if (typeof value === "string") {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(extractContentParts);
  const record = asRecord(value);
  if (!record) return [];
  const type = normalizeType(record.type ?? record.block_type ?? record.kind);
  if (EXCLUDED_BLOCK_TYPES.some((excluded) => type.includes(excluded))) return [];

  const parts: string[] = [];
  for (const key of CONTENT_KEYS) {
    if (record[key] !== undefined) parts.push(...extractContentParts(record[key]));
  }
  if (!parts.length && Array.isArray(record.blocks))
    parts.push(...extractContentParts(record.blocks));
  return parts;
}

function locateBody(payload: unknown): UnknownRecord | undefined {
  for (const path of BODY_PATHS) {
    const body = asRecord(valueAtPath(payload, path));
    if (body) return body;
  }
  const direct = asRecord(payload);
  return direct && Array.isArray(direct.messages) ? direct : undefined;
}

function explicitNextCursor(body: UnknownRecord): string | undefined {
  const cursor = asRecord(body.cursor);
  const pageInfo = asRecord(body.page_info);
  const pagination = asRecord(body.pagination);
  return firstCursor(
    body.next_index_in_conv,
    body.next_anchor_index,
    body.next_cursor,
    body.min_index_in_conv,
    body.index_in_conv,
    cursor?.next_index_in_conv,
    cursor?.index_in_conv,
    pageInfo?.next_index_in_conv,
    pageInfo?.min_index_in_conv,
    pagination?.next_index_in_conv,
    pagination?.min_index_in_conv,
  );
}

function deriveCursor(
  messages: readonly DoubaoAcquisitionMessage[],
  requestCursor: string | undefined,
): string | undefined {
  const sequences = messages
    .map((message) => message.sequence)
    .filter((value): value is number => value !== undefined);
  if (!sequences.length) return undefined;
  const minimum = Math.min(...sequences);
  const candidate = String(minimum);
  if (candidate !== requestCursor) return candidate;
  return minimum > 1 ? String(minimum - 1) : undefined;
}

function messageSequence(raw: UnknownRecord): number | undefined {
  const extra = asRecord(parseMaybeJson(raw.extra));
  const localInfo = asRecord(parseMaybeJson(raw.local_info));
  const messageInfo = asRecord(parseMaybeJson(raw.message_info));
  return firstFiniteNumber(
    raw.index_in_conv,
    raw.index,
    raw.message_index,
    raw.sequence,
    raw.seq_index,
    extra?.index_in_conv,
    extra?.message_index,
    localInfo?.index_in_conv,
    messageInfo?.index_in_conv,
  );
}

function mergeMessages(
  existing: readonly DoubaoAcquisitionMessage[],
  incoming: readonly DoubaoAcquisitionMessage[],
): DoubaoAcquisitionMessage[] {
  const byId = new Map(existing.map((message) => [message.providerMessageId, message]));
  for (const message of incoming) {
    const previous = byId.get(message.providerMessageId);
    const previousLength = previous?.content[0]?.text.length ?? -1;
    const nextLength = message.content[0]?.text.length ?? 0;
    if (!previous || nextLength > previousLength) byId.set(message.providerMessageId, message);
  }
  return [...byId.values()].toSorted((left, right) => {
    if (left.sequence !== undefined && right.sequence !== undefined) {
      return left.sequence - right.sequence;
    }
    if (left.sequence !== undefined) return -1;
    if (right.sequence !== undefined) return 1;
    return 0;
  });
}

function pageSignature(rawMessages: readonly unknown[], pageOrdinal: number): string {
  return rawMessages
    .map((value, index) => {
      const raw = asRecord(value);
      if (!raw) return `invalid:${index}`;
      return (
        firstId(raw.message_id, raw.id, raw.server_message_id) ??
        (messageSequence(raw) === undefined
          ? `anonymous-page:${pageOrdinal}:item:${index}`
          : `${messageSequence(raw)}:${String(raw.role ?? raw.sender_type ?? "?")}`)
      );
    })
    .join("|");
}

function finish(
  state: DoubaoPaginationState,
  stopReason: Exclude<DoubaoAcquisitionStopReason, "complete" | "has-more">,
): DoubaoPaginationState {
  return {
    ...withoutNextCursor(state),
    cursorExhausted: false,
    branchRootVerified: false,
    stopReason,
    terminal: true,
  };
}

function withoutNextCursor(
  state: DoubaoPaginationState,
): Omit<DoubaoPaginationState, "nextCursor"> {
  const { nextCursor, ...rest } = state;
  void nextCursor;
  return rest;
}

function transition(state: DoubaoPaginationState): DoubaoPageTransition {
  const completeness: DoubaoAcquisitionCompleteness = state.cursorExhausted
    ? "verified"
    : state.terminal
      ? state.messages.length
        ? "partial"
        : "unknown"
      : state.messages.length
        ? "bounded"
        : "unknown";
  return {
    state,
    result: {
      source: "conversation-api",
      completeness,
      messages: state.messages,
      evidence: {
        cursorExhausted: state.cursorExhausted,
        branchRootVerified: state.branchRootVerified,
        ...(state.expectedCount === undefined ? {} : { expectedCount: state.expectedCount }),
        capturedCount: state.messages.length,
        stopReason: state.stopReason,
        pageCount: state.pageCount,
      },
    },
    ...(state.nextCursor ? { nextCursor: state.nextCursor } : {}),
  };
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

function firstCursor(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cursor = normalizeCursor(value);
    if (cursor) return cursor;
  }
  return undefined;
}

function normalizeCursor(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return value.trim();
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

function firstNonNegativeInteger(...values: unknown[]): number | undefined {
  const value = firstFiniteNumber(...values);
  return value !== undefined && value >= 0 ? Math.floor(value) : undefined;
}

function maximumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
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
