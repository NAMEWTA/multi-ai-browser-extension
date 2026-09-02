export type KimiAcquisitionCompleteness = "verified" | "bounded" | "partial" | "unknown";

export interface KimiAcquisitionContent {
  readonly type: "text";
  readonly text: string;
  readonly markdown?: string;
}

export interface KimiAcquisitionMessage {
  readonly providerMessageId: string;
  readonly parentId?: string;
  readonly role: "user" | "assistant";
  readonly createdAt?: number;
  readonly finished: boolean;
  readonly content: readonly KimiAcquisitionContent[];
}

export type KimiAcquisitionStopReason =
  | "complete"
  | "has-more"
  | "duplicate-cursor"
  | "duplicate-page"
  | "conflicting-message"
  | "invalid-page"
  | "unstable-message"
  | "missing-next-cursor"
  | "empty-page-with-cursor"
  | "expected-count-mismatch"
  | "ambiguous-branch"
  | "broken-parent-chain"
  | "invalid-role-order"
  | "unfinished-assistant"
  | "max-pages";

export interface KimiAcquisitionEvidence {
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly capturedCount: number;
  readonly stopReason: KimiAcquisitionStopReason;
  readonly pageCount: number;
  readonly currentMessageId?: string;
}

export interface KimiAcquisitionResult {
  readonly source: "conversation-api";
  readonly completeness: KimiAcquisitionCompleteness;
  readonly messages: readonly KimiAcquisitionMessage[];
  readonly evidence: KimiAcquisitionEvidence;
}

export interface KimiPaginationState {
  readonly source: "conversation-api";
  readonly messages: readonly KimiAcquisitionMessage[];
  readonly seenCursors: readonly string[];
  readonly seenPageSignatures: readonly string[];
  readonly pageCount: number;
  readonly maxPages: number;
  readonly cursorExhausted: boolean;
  readonly branchRootVerified: boolean;
  readonly expectedCount?: number;
  readonly nextCursor?: string;
  readonly currentMessageId?: string;
  readonly stopReason: KimiAcquisitionStopReason;
  readonly terminal: boolean;
}

export interface KimiPageTransition {
  readonly state: KimiPaginationState;
  readonly result: KimiAcquisitionResult;
  readonly nextCursor?: string;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedPage {
  readonly messages: readonly KimiAcquisitionMessage[];
  readonly stable: boolean;
  readonly signature: string;
  readonly cursorPresent: boolean;
  readonly nextCursor?: string;
  readonly expectedCount?: number;
}

type Linearization =
  | {
      readonly messages: readonly KimiAcquisitionMessage[];
      readonly complete: true;
      readonly currentMessageId: string;
    }
  | {
      readonly messages: readonly KimiAcquisitionMessage[];
      readonly complete: false;
      readonly stopReason: Exclude<KimiAcquisitionStopReason, "complete" | "has-more">;
      readonly currentMessageId?: string;
    };

const ROOT_CURSOR = "<initial-page>";
const BODY_PATHS = [[], ["data"], ["result"], ["data", "result"]] as const;

export function createKimiPaginationState(
  options: { readonly maxPages?: number } = {},
): KimiPaginationState {
  return {
    source: "conversation-api",
    messages: [],
    seenCursors: [],
    seenPageSignatures: [],
    pageCount: 0,
    maxPages: Math.max(1, Math.floor(options.maxPages ?? 1_000)),
    cursorExhausted: false,
    branchRootVerified: false,
    stopReason: "has-more",
    terminal: false,
  };
}

/** Consumes one ListMessages JSON page without consulting DOM, storage, cookies or auth state. */
export function parseKimiMessagesPage(
  payload: unknown,
  state: KimiPaginationState,
  requestCursor?: string,
): KimiPageTransition {
  if (state.terminal) return transition(state);
  if (state.pageCount >= state.maxPages) return transition(finish(state, "max-pages"));

  const cursorKey = normalizeCursor(requestCursor) ?? ROOT_CURSOR;
  if (state.seenCursors.includes(cursorKey)) {
    return transition(finish(state, "duplicate-cursor"));
  }

  const parsed = parsePage(payload);
  const advanced: KimiPaginationState = {
    ...state,
    seenCursors: [...state.seenCursors, cursorKey],
    pageCount: state.pageCount + 1,
  };
  if (!parsed) return transition(finish(advanced, "invalid-page"));
  if (state.seenPageSignatures.includes(parsed.signature)) {
    return transition(finish(advanced, "duplicate-page"));
  }

  const merged = mergeMessages(state.messages, parsed.messages);
  const expectedCount = maximumDefined(state.expectedCount, parsed.expectedCount);
  const collected: KimiPaginationState = {
    ...advanced,
    messages: merged.messages,
    seenPageSignatures: [...state.seenPageSignatures, parsed.signature],
    ...(expectedCount === undefined ? {} : { expectedCount }),
  };
  if (merged.conflict) return transition(finish(collected, "conflicting-message"));
  if (!parsed.stable) return transition(finish(collected, "unstable-message"));
  if (!parsed.cursorPresent) return transition(finish(collected, "missing-next-cursor"));

  if (parsed.nextCursor) {
    if (parsed.messages.length === 0) {
      return transition(finish(collected, "empty-page-with-cursor"));
    }
    if (
      parsed.nextCursor === cursorKey ||
      state.seenCursors.includes(parsed.nextCursor) ||
      parsed.nextCursor === ROOT_CURSOR
    ) {
      return transition(finish(collected, "duplicate-cursor"));
    }
    if (collected.pageCount >= collected.maxPages) {
      return transition(finish(collected, "max-pages"));
    }
    const continuing: KimiPaginationState = {
      ...collected,
      nextCursor: parsed.nextCursor,
      cursorExhausted: false,
      branchRootVerified: false,
      stopReason: "has-more",
      terminal: false,
    };
    return transition(continuing);
  }

  if (expectedCount !== undefined && merged.messages.length !== expectedCount) {
    return transition(finish(collected, "expected-count-mismatch"));
  }

  const linearized = linearizeMessages(merged.messages);
  if (!linearized.complete) {
    return transition(
      finish(
        {
          ...collected,
          messages: linearized.messages,
          ...(linearized.currentMessageId ? { currentMessageId: linearized.currentMessageId } : {}),
        },
        linearized.stopReason,
      ),
    );
  }

  return transition({
    ...withoutNextCursor(collected),
    messages: linearized.messages,
    cursorExhausted: true,
    branchRootVerified: true,
    ...(linearized.currentMessageId ? { currentMessageId: linearized.currentMessageId } : {}),
    stopReason: "complete",
    terminal: true,
  });
}

function parsePage(payload: unknown): ParsedPage | undefined {
  const body = locateBody(payload);
  if (!body || !Array.isArray(body.messages)) return undefined;

  const parsed = body.messages.map(parseMessage);
  const messages = parsed.flatMap((entry) => (entry ? [entry] : []));
  const cursor = nextPageCursor(body);
  const count = expectedCount(body);
  return {
    messages,
    stable: parsed.every(Boolean),
    signature: pageSignature(body.messages, parsed),
    cursorPresent: cursor.present,
    ...(cursor.value ? { nextCursor: cursor.value } : {}),
    ...(count === undefined ? {} : { expectedCount: count }),
  };
}

function parseMessage(value: unknown): KimiAcquisitionMessage | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const providerMessageId = firstId(raw.id, raw.messageId, raw.message_id);
  const role = parseRole(raw.role, raw.senderRole, raw.sender_role);
  if (!providerMessageId || !role) return undefined;

  const text = messageText(raw);
  if (!text) return undefined;
  const parentId = firstId(raw.parentId, raw.parent_id);
  const createdAt = timestamp(raw.createTime, raw.create_time, raw.createdAt, raw.created_at);
  const status = normalized(raw.status, raw.messageStatus, raw.message_status);
  const finished =
    role === "user" ||
    ["finished", "complete", "completed", "success"].some((term) => status.endsWith(term));
  return {
    providerMessageId,
    ...(parentId ? { parentId } : {}),
    role,
    ...(createdAt === undefined ? {} : { createdAt }),
    finished,
    content: [{ type: "text", text, markdown: text }],
  };
}

function messageText(raw: UnknownRecord): string {
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const parts = blocks.flatMap((value) => {
    const block = asRecord(value);
    if (!block) return [];
    const text = asRecord(block.text);
    const content = firstText(text?.content, block.markdown);
    return content ? [content] : [];
  });
  if (parts.length) return joinDistinct(parts);
  return firstText(raw.content, raw.text) ?? "";
}

function parseRole(...values: unknown[]): KimiAcquisitionMessage["role"] | undefined {
  for (const value of values) {
    const role = normalized(value);
    if (role === "user" || role.endsWith("_user")) return "user";
    if (role === "assistant" || role.endsWith("_assistant")) return "assistant";
  }
  return undefined;
}

function locateBody(payload: unknown): UnknownRecord | undefined {
  for (const path of BODY_PATHS) {
    const body = asRecord(valueAtPath(payload, path));
    if (body && Array.isArray(body.messages)) return body;
  }
  return undefined;
}

function nextPageCursor(body: UnknownRecord): {
  readonly present: boolean;
  readonly value?: string;
} {
  for (const key of ["nextPageToken", "next_page_token"] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (value === "") return { present: true };
    const normalizedValue = normalizeCursor(value);
    return normalizedValue ? { present: true, value: normalizedValue } : { present: false };
  }
  if (body.hasMore === false || body.has_more === false) return { present: true };
  return { present: false };
}

function linearizeMessages(messages: readonly KimiAcquisitionMessage[]): Linearization {
  const chronological = sortChronologically(messages);
  if (!messages.length) {
    return { messages: [], complete: false, stopReason: "invalid-role-order" };
  }

  const byId = new Map(messages.map((message) => [message.providerMessageId, message]));
  const parentIds = new Set(messages.map((message) => message.parentId).filter(Boolean));
  const leaves = messages.filter((message) => !parentIds.has(message.providerMessageId));
  if (leaves.length !== 1) {
    return { messages: chronological, complete: false, stopReason: "ambiguous-branch" };
  }

  const currentMessageId = leaves[0]!.providerMessageId;
  const reversed: KimiAcquisitionMessage[] = [];
  const visited = new Set<string>();
  let current: KimiAcquisitionMessage | undefined = leaves[0];
  while (current) {
    if (visited.has(current.providerMessageId)) {
      return {
        messages: chronological,
        complete: false,
        stopReason: "broken-parent-chain",
        currentMessageId,
      };
    }
    visited.add(current.providerMessageId);
    reversed.push(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
    if (!current) {
      return {
        messages: chronological,
        complete: false,
        stopReason: "broken-parent-chain",
        currentMessageId,
      };
    }
  }

  const chain = reversed.reverse();
  if (chain.length !== messages.length) {
    return {
      messages: chronological,
      complete: false,
      stopReason: "ambiguous-branch",
      currentMessageId,
    };
  }
  if (
    chain.at(-1)?.role !== "assistant" ||
    chain.some((message, index) => message.role !== (index % 2 === 0 ? "user" : "assistant"))
  ) {
    return {
      messages: chain,
      complete: false,
      stopReason: "invalid-role-order",
      currentMessageId,
    };
  }
  if (chain.some((message) => message.role === "assistant" && !message.finished)) {
    return {
      messages: chain,
      complete: false,
      stopReason: "unfinished-assistant",
      currentMessageId,
    };
  }
  return { messages: chain, complete: true, currentMessageId };
}

function mergeMessages(
  existing: readonly KimiAcquisitionMessage[],
  incoming: readonly KimiAcquisitionMessage[],
): { readonly messages: readonly KimiAcquisitionMessage[]; readonly conflict: boolean } {
  const byId = new Map(existing.map((message) => [message.providerMessageId, message]));
  let conflict = false;
  for (const message of incoming) {
    const previous = byId.get(message.providerMessageId);
    if (!previous) {
      byId.set(message.providerMessageId, message);
    } else if (messageFingerprint(previous) !== messageFingerprint(message)) {
      conflict = true;
    }
  }
  return { messages: [...byId.values()], conflict };
}

function sortChronologically(
  messages: readonly KimiAcquisitionMessage[],
): KimiAcquisitionMessage[] {
  const order = new Map(messages.map((message, index) => [message, index]));
  return [...messages].toSorted((left, right) => {
    if (
      left.createdAt !== undefined &&
      right.createdAt !== undefined &&
      left.createdAt !== right.createdAt
    ) {
      return left.createdAt - right.createdAt;
    }
    return (order.get(left) ?? 0) - (order.get(right) ?? 0);
  });
}

function pageSignature(
  values: readonly unknown[],
  parsed: readonly (KimiAcquisitionMessage | undefined)[],
): string {
  return (
    values
      .map((value, index) => {
        const message = parsed[index];
        if (message) return messageFingerprint(message);
        const raw = asRecord(value);
        return raw
          ? `unstable:${firstId(raw.id, raw.messageId, raw.message_id) ?? index}`
          : `invalid:${index}`;
      })
      .join("|") || "<empty-page>"
  );
}

function messageFingerprint(message: KimiAcquisitionMessage): string {
  return JSON.stringify([
    message.providerMessageId,
    message.parentId,
    message.role,
    message.createdAt,
    message.finished,
    message.content,
  ]);
}

function finish(
  state: KimiPaginationState,
  stopReason: Exclude<KimiAcquisitionStopReason, "complete" | "has-more">,
): KimiPaginationState {
  return {
    ...withoutNextCursor(state),
    cursorExhausted: false,
    branchRootVerified: false,
    stopReason,
    terminal: true,
  };
}

function withoutNextCursor(state: KimiPaginationState): Omit<KimiPaginationState, "nextCursor"> {
  const { nextCursor, ...rest } = state;
  void nextCursor;
  return rest;
}

function transition(state: KimiPaginationState): KimiPageTransition {
  const completeness: KimiAcquisitionCompleteness =
    state.cursorExhausted && state.branchRootVerified
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
        ...(state.currentMessageId ? { currentMessageId: state.currentMessageId } : {}),
      },
    },
    ...(state.nextCursor ? { nextCursor: state.nextCursor } : {}),
  };
}

function expectedCount(body: UnknownRecord): number | undefined {
  return firstNonNegativeInteger(
    body.totalCount,
    body.total_count,
    body.messageCount,
    body.message_count,
  );
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

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = normalizeText(value);
    if (text) return text;
  }
  return undefined;
}

function timestamp(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeCursor(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalized(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().toLocaleLowerCase();
  }
  return "";
}

function firstNonNegativeInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  return undefined;
}

function maximumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function joinDistinct(parts: readonly string[]): string {
  return [...new Set(parts.map(normalizeText).filter(Boolean))].join("\n\n");
}
