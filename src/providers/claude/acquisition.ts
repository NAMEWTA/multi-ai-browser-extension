import type { ConversationSnapshot, Message } from "../../core/acquisition";

type UnknownRecord = Record<string, unknown>;

export function parseClaudeConversation(
  payload: unknown,
  conversationId: string,
  url?: string,
): ConversationSnapshot {
  const envelope = record(payload);
  const messagesValue =
    envelope?.chat_messages ??
    envelope?.messages ??
    record(envelope?.data)?.chat_messages ??
    record(envelope?.data)?.messages;
  const rawMessages = Array.isArray(messagesValue) ? messagesValue : [];
  const messages = rawMessages
    .flatMap((value, index) => {
      const message = parseMessage(value, index);
      return message ? [message] : [];
    })
    .toSorted((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  const hasMore =
    envelope?.has_more === true ||
    record(envelope?.pagination)?.has_more === true ||
    record(envelope?.page_info)?.has_more === true;
  const stableIds = messages.every((message) => !message.id.startsWith("claude-message:"));
  const complete = Boolean(
    messages.length && messages.at(-1)?.role === "assistant" && stableIds && !hasMore,
  );
  const title = text(envelope?.name);
  const capturedContentChars = messages.reduce(
    (total, message) => total + message.content.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );

  return {
    schemaVersion: 1,
    providerId: "claude",
    conversationId,
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    capturedAt: Date.now(),
    messages,
    source: "provider-api",
    completeness: {
      state: complete ? "complete" : messages.length ? "partial" : "unknown",
      capturedMessageCount: messages.length,
      capturedContentChars,
      hasBeginning: messages.length > 0,
      hasEnd: complete,
    },
    evidence: {
      stableMessageKeys: messages.map(({ id }) => id),
      signals: [
        complete ? "terminal-assistant-message" : "terminal-message-missing",
        stableIds ? "stable-message-ids" : "generated-message-ids",
        hasMore ? "pagination-has-more" : "full-conversation-endpoint",
      ],
    },
    diagnostics: {
      strategyId: "claude-conversation-api",
      entries: complete
        ? []
        : [
            {
              code: "CLAUDE_CONVERSATION_NOT_TERMINAL",
              severity: "warning",
              message: "Claude conversation did not end with an assistant message.",
            },
          ],
    },
  };
}

function parseMessage(value: unknown, index: number): Message | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const role = claudeRole(raw.sender ?? raw.role ?? record(raw.author)?.role);
  if (!role) return undefined;
  const id = identifier(raw.uuid, raw.id, raw.message_id) ?? `claude-message:${index}:${role}`;
  const body = contentText(raw.content ?? raw.text ?? raw.message);
  if (!body) return undefined;
  const createdAt = timestamp(raw.created_at ?? raw.createdAt);
  return {
    id,
    role,
    content: [{ kind: "paragraph", text: body, markdown: body }],
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n").trim();
  if (!Array.isArray(value)) {
    const raw = record(value);
    return contentText(raw?.text ?? raw?.content ?? "");
  }
  const parts: string[] = [];
  for (const block of value) {
    if (typeof block === "string") {
      const normalized = contentText(block);
      if (normalized && !parts.includes(normalized)) parts.push(normalized);
      continue;
    }
    const raw = record(block);
    const type = text(raw?.type)?.toLocaleLowerCase() ?? "";
    if (/(thinking|tool|search|status)/.test(type)) continue;
    const normalized = contentText(raw?.text ?? raw?.content ?? "");
    if (normalized && !parts.includes(normalized)) parts.push(normalized);
  }
  return parts.join("\n\n").trim();
}

function claudeRole(value: unknown): Message["role"] | undefined {
  const normalized = text(value)?.toLocaleLowerCase();
  if (normalized === "human" || normalized === "user") return "user";
  if (normalized === "assistant" || normalized === "ai") return "assistant";
  return undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function identifier(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}
