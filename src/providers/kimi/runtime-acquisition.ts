import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import {
  createKimiPaginationState,
  parseKimiMessagesPage,
  type KimiAcquisitionResult,
} from "./acquisition";

export const KIMI_ACQUISITION_ADAPTER_VERSION = "kimi-list-messages-v2";

export const kimiAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "kimi",
  strategiesByPriority: [
    { id: "kimi-list-messages-api", source: "provider-api", acquire: acquireKimiConversation },
  ],
  qualityPolicy: {
    requireComplete: true,
    requireTerminalCursor: true,
    requireBranchEvidence: true,
    minimumMessageRatio: 1,
    minimumContentRatio: 1,
  },
};

async function acquireKimiConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;
  const conversationId = kimiConversationId(pageUrl);
  if (!conversationId) return undefined;

  const observed = await network.latest("kimi", "kimi-list-messages").catch(() => undefined);
  if (!observed?.observation) return undefined;
  const observedAfter = finiteNumber(context.data?.acquisitionObservedAfter);
  const observedAt = Date.parse(observed.observation.observedAt);
  if (observedAfter !== undefined && (!Number.isFinite(observedAt) || observedAt < observedAfter)) {
    return undefined;
  }
  const observedConversationId = scalar(observed.observation.body, "chat_id", "chatId");
  if (!observedConversationId || observedConversationId !== conversationId) return undefined;

  let requestCursor: string | undefined;
  let state = createKimiPaginationState({ maxPages: 1_000 });
  let result: KimiAcquisitionResult | undefined;
  let first = true;

  while (!result || !result.evidence.cursorExhausted) {
    const response = await network
      .replay(
        observed.observation.observationId,
        first
          ? { page_size: 100, page_token: "" }
          : requestCursor
            ? { page_size: 100, page_token: requestCursor }
            : undefined,
      )
      .catch(() => undefined);
    if (response?.payload === undefined || !successful(response.status)) {
      return result ? kimiResultToSnapshot(result, conversationId, pageUrl) : undefined;
    }

    const parsed = parseKimiMessagesPage(response.payload, state, requestCursor);
    state = parsed.state;
    result = parsed.result;
    first = false;
    if (state.terminal || !parsed.nextCursor) break;
    requestCursor = parsed.nextCursor;
    if (context.signal?.aborted) throw context.signal.reason;
  }
  return result ? kimiResultToSnapshot(result, conversationId, pageUrl) : undefined;
}

export function kimiResultToSnapshot(
  result: KimiAcquisitionResult,
  conversationId: string,
  url?: string,
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
    ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
  }));
  const capturedContentChars = messages.reduce(
    (total, message) => total + message.content.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );
  const complete =
    result.completeness === "verified" &&
    result.evidence.cursorExhausted &&
    result.evidence.branchRootVerified;
  return {
    schemaVersion: 1,
    providerId: "kimi",
    conversationId,
    ...(url ? { url } : {}),
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
        `pages:${result.evidence.pageCount}`,
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
      strategyId: "kimi-list-messages-api",
      entries: complete
        ? []
        : [
            {
              code: "KIMI_LIST_MESSAGES_NOT_VERIFIED",
              severity: "warning",
              message: `Kimi pagination stopped with ${result.evidence.stopReason}.`,
            },
          ],
    },
  };
}

function kimiConversationId(value: string): string | undefined {
  const url = new URL(value);
  const queryId = url.searchParams.get("chat_id") ?? url.searchParams.get("chatId");
  if (queryId?.trim()) return queryId.trim();
  const match = /\/chat\/([^/?#]+)/i.exec(url.pathname);
  return match?.[1]?.trim() || undefined;
}

function scalar(body: unknown, ...keys: readonly string[]): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function successful(status: number | undefined): boolean {
  return status === undefined || (status >= 200 && status < 300);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
