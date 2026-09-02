import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { parseQwenConversation, type QwenAcquisitionResult } from "./acquisition";

export const QWEN_ACQUISITION_ADAPTER_VERSION = "qwen-conversation-v2";

export const qwenAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "qwen",
  strategiesByPriority: [
    {
      id: "qwen-conversation-api",
      source: "provider-api",
      acquire: acquireQwenConversation,
    },
  ],
  qualityPolicy: {
    requireComplete: true,
    requireTerminalCursor: true,
    requireBranchEvidence: true,
    minimumMessageRatio: 1,
    minimumContentRatio: 1,
  },
};

async function acquireQwenConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;

  const latest = await network.latest("qwen", "qwen-conversation").catch(() => undefined);
  if (!latest?.observation || (latest.status !== undefined && latest.status >= 400)) {
    return undefined;
  }
  const observedAfter = finiteNumber(context.data?.acquisitionObservedAfter);
  if (!observationIsFresh(latest.observation.observedAt, observedAfter)) return undefined;
  const pageConversationId = qwenConversationId(pageUrl);
  const observedConversationId =
    scalarId(
      latest.observation.body,
      "conversation_id",
      "conversationId",
      "chat_id",
      "session_id",
    ) ?? qwenConversationId(latest.observation.url);
  if (
    pageConversationId &&
    observedConversationId &&
    pageConversationId !== observedConversationId
  ) {
    return undefined;
  }

  let payload = latest.payload;
  // Replaying a Qwen POST can submit another prompt or mutate a conversation. Only replay a
  // previously observed read request; otherwise let native Copy/DOM handle the current turn.
  if (payload === undefined && latest.observation.method.toUpperCase() === "GET") {
    const replayed = await network.replay(latest.observation.observationId).catch(() => undefined);
    if (replayed?.status !== undefined && replayed.status >= 400) return undefined;
    payload = replayed?.payload;
  }
  if (payload === undefined) return undefined;

  const result = parseQwenConversation(payload);
  if (pageConversationId && result.conversationId && pageConversationId !== result.conversationId) {
    return undefined;
  }
  const conversationId = result.conversationId ?? observedConversationId ?? pageConversationId;
  return qwenResultToSnapshot(result, pageUrl, conversationId);
}

export function qwenResultToSnapshot(
  result: QwenAcquisitionResult,
  url: string,
  conversationId?: string,
): ConversationSnapshot {
  const messages = result.messages.map((message) => ({
    id: message.providerMessageId,
    role: message.role,
    content: message.content.map((block) => ({
      kind: "paragraph" as const,
      text: block.text,
      ...(block.markdown ? { markdown: block.markdown } : {}),
    })),
    ...(message.parentId ? { parentId: message.parentId } : {}),
  }));
  const capturedContentChars = messages.reduce(
    (total, message) => total + message.content.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );
  const complete =
    result.completeness === "verified" &&
    result.evidence.cursorExhausted &&
    result.evidence.branchRootVerified &&
    result.evidence.stopReason === "complete";

  return {
    schemaVersion: 1,
    providerId: "qwen",
    ...(conversationId ? { conversationId } : {}),
    ...(result.title ? { title: result.title } : {}),
    url,
    capturedAt: Date.now(),
    messages,
    source: "provider-api",
    completeness: {
      state: complete ? "complete" : result.completeness === "unknown" ? "unknown" : "partial",
      capturedMessageCount: messages.length,
      ...(result.evidence.expectedCount === undefined
        ? {}
        : { expectedMessageCount: result.evidence.expectedCount }),
      capturedContentChars,
      hasBeginning: complete,
      hasEnd: complete,
    },
    evidence: {
      stableMessageKeys: messages.map(({ id }) => id),
      signals: [
        `stop:${result.evidence.stopReason}`,
        `verification:${result.completeness}`,
        "source:observed-qwen-conversation",
      ],
      cursor: {
        hasMore: !result.evidence.cursorExhausted,
        reachedStart: complete,
        reachedEnd: complete,
      },
      branch: {
        ...(result.evidence.currentMessageId
          ? { currentNodeId: result.evidence.currentMessageId }
          : {}),
        capturedNodeIds: messages.map(({ id }) => id),
        linearized: result.evidence.branchRootVerified,
        complete,
      },
    },
    diagnostics: {
      strategyId: "qwen-conversation-api",
      entries: complete
        ? []
        : [
            {
              code: "QWEN_CONVERSATION_NOT_VERIFIED",
              severity: "warning",
              message: `Qwen conversation stopped with ${result.evidence.stopReason}.`,
            },
          ],
    },
  };
}

function qwenConversationId(value: string): string | undefined {
  const url = new URL(value);
  const explicit = url.searchParams.get("conversation_id") ?? url.searchParams.get("chat_id");
  if (explicit?.trim()) return explicit.trim();
  const match = /\/(?:c|chat|conversation|session)\/([^/?#]+)/i.exec(url.pathname);
  return match?.[1]?.trim() || undefined;
}

function scalarId(body: unknown, ...keys: readonly string[]): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function observationIsFresh(observedAt: string, observedAfter: number | undefined): boolean {
  if (observedAfter === undefined) return true;
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp) && timestamp >= observedAfter;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
