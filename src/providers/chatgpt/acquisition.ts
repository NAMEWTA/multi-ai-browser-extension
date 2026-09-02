import type { ConversationSnapshot, Message } from "../../core/acquisition";

type UnknownRecord = Record<string, unknown>;

interface ConversationNode {
  readonly id: string;
  readonly parentId?: string;
  readonly message?: Message;
}

export function parseChatGptConversation(
  payload: unknown,
  conversationId: string,
  url?: string,
): ConversationSnapshot {
  const envelope = record(payload);
  const mapping = record(envelope?.mapping ?? record(envelope?.data)?.mapping);
  const currentNodeId = identifier(
    envelope?.current_node,
    envelope?.currentNode,
    record(envelope?.data)?.current_node,
  );
  const nodes = new Map<string, ConversationNode>();
  for (const [mappingId, value] of Object.entries(mapping ?? {})) {
    const node = parseNode(mappingId, value);
    if (node) nodes.set(node.id, node);
  }

  const branch = currentNodeId ? walkActiveBranch(nodes, currentNodeId) : undefined;
  const selectedNodes = branch?.nodes ?? [...nodes.values()];
  const messages = selectedNodes.flatMap((node) => (node.message ? [node.message] : []));
  const complete = Boolean(
    currentNodeId && branch?.complete && messages.at(-1)?.role === "assistant",
  );
  const capturedContentChars = messages.reduce(
    (total, message) => total + message.content.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );

  return {
    schemaVersion: 1,
    providerId: "chatgpt",
    conversationId,
    ...(url ? { url } : {}),
    capturedAt: Date.now(),
    messages,
    source: "provider-api",
    completeness: {
      state: complete ? "complete" : messages.length ? "partial" : "unknown",
      capturedMessageCount: messages.length,
      capturedContentChars,
      hasBeginning: branch?.complete ?? false,
      hasEnd: complete,
    },
    evidence: {
      stableMessageKeys: messages.map(({ id }) => id),
      signals: [currentNodeId ? "active-node-present" : "active-node-missing"],
      branch: {
        ...(currentNodeId ? { currentNodeId } : {}),
        capturedNodeIds: messages.map(({ id }) => id),
        linearized: Boolean(branch),
        complete,
      },
    },
    diagnostics: {
      strategyId: "chatgpt-conversation-api",
      entries: complete
        ? []
        : [
            {
              code: "CHATGPT_ACTIVE_BRANCH_INCOMPLETE",
              severity: "warning",
              message: "ChatGPT active conversation branch was not terminal and complete.",
            },
          ],
    },
  };
}

function parseNode(mappingId: string, value: unknown): ConversationNode | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = identifier(raw.id, mappingId);
  if (!id) return undefined;
  const parentId = identifier(raw.parent);
  const rawMessage = record(raw.message);
  const role = chatRole(record(rawMessage?.author)?.role);
  const text = role ? messageText(rawMessage?.content) : "";
  const createdAt = timestamp(rawMessage?.create_time);
  return {
    id,
    ...(parentId ? { parentId } : {}),
    ...(role && text
      ? {
          message: {
            id,
            role,
            content: [{ kind: "paragraph", text, markdown: text }],
            ...(parentId ? { parentId } : {}),
            ...(createdAt !== undefined ? { createdAt } : {}),
          },
        }
      : {}),
  };
}

function walkActiveBranch(
  nodes: ReadonlyMap<string, ConversationNode>,
  currentNodeId: string,
): { readonly nodes: readonly ConversationNode[]; readonly complete: boolean } {
  const reversed: ConversationNode[] = [];
  const visited = new Set<string>();
  let current = nodes.get(currentNodeId);
  let complete = false;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    reversed.push(current);
    if (!current.parentId) {
      complete = true;
      break;
    }
    current = nodes.get(current.parentId);
  }
  return { nodes: reversed.reverse(), complete };
}

function messageText(value: unknown): string {
  const content = record(value);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return distinctText(parts).join("\n\n").trim();
}

function distinctText(values: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const text =
      typeof value === "string"
        ? value
        : (textValue(record(value)?.text) ?? textValue(record(value)?.content) ?? "");
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function chatRole(value: unknown): Message["role"] | undefined {
  if (value === "user") return "user";
  if (value === "assistant") return "assistant";
  return undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function identifier(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}
