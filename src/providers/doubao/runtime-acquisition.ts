import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import {
  createDoubaoPaginationState,
  parseDoubaoChainPage,
  type DoubaoAcquisitionResult,
} from "./acquisition";

export const DOUBAO_ACQUISITION_ADAPTER_VERSION = "doubao-chain-v2";

export const doubaoAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "doubao",
  strategiesByPriority: [
    { id: "doubao-chain-api", source: "provider-api", acquire: acquireDoubaoConversation },
  ],
  qualityPolicy: {
    requireComplete: true,
    requireTerminalCursor: true,
    minimumMessageRatio: 1,
    minimumContentRatio: 1,
  },
};

async function acquireDoubaoConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;
  const observed = await network.latest("doubao", "doubao-chain").catch(() => undefined);
  if (!observed?.observation || !observationIsCurrent(observed.observation.observedAt, context)) {
    return undefined;
  }
  const pageConversationId = doubaoConversationId(pageUrl);
  const observedConversationId = scalarIdentity(
    observed.observation.body,
    "conversation_id",
    "conversationId",
  );
  if (
    pageConversationId &&
    observedConversationId &&
    pageConversationId !== observedConversationId
  ) {
    return undefined;
  }
  const conversationId = observedConversationId ?? pageConversationId ?? new URL(pageUrl).href;

  let state = createDoubaoPaginationState({ maxPages: 1_000 });
  let requestCursor = scalarCursor(observed.observation.body, "anchor");
  let result: DoubaoAcquisitionResult | undefined;
  let first = true;

  while (!result || !result.evidence.cursorExhausted) {
    const payload =
      first && observed.payload !== undefined
        ? observed.payload
        : (
            await network
              .replay(
                observed.observation.observationId,
                first || requestCursor === undefined
                  ? undefined
                  : { anchor: requestCursor, direction: 1, limit: 20 },
              )
              .catch(() => undefined)
          )?.payload;
    if (payload === undefined)
      return result ? doubaoResultToSnapshot(result, pageUrl, conversationId) : undefined;
    const parsed = parseDoubaoChainPage(payload, state, requestCursor);
    state = parsed.state;
    result = parsed.result;
    first = false;
    if (result.evidence.cursorExhausted || parsed.nextCursor === undefined) break;
    requestCursor = parsed.nextCursor;
    if (context.signal?.aborted) throw context.signal.reason;
  }
  return result ? doubaoResultToSnapshot(result, pageUrl, conversationId) : undefined;
}

export function doubaoResultToSnapshot(
  result: DoubaoAcquisitionResult,
  url: string,
  conversationId = doubaoConversationId(url) ?? new URL(url).href,
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
  const complete = result.completeness === "verified" && result.evidence.cursorExhausted;
  return {
    schemaVersion: 1,
    providerId: "doubao",
    conversationId,
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
        `pages:${result.evidence.pageCount}`,
      ],
      cursor: {
        hasMore: !result.evidence.cursorExhausted,
        reachedStart: complete,
        reachedEnd: complete,
      },
    },
    diagnostics: {
      strategyId: "doubao-chain-api",
      entries: complete
        ? []
        : [
            {
              code: "DOUBAO_PAGINATION_NOT_VERIFIED",
              severity: "warning",
              message: `Doubao pagination stopped with ${result.evidence.stopReason}.`,
            },
          ],
    },
  };
}

function doubaoConversationId(value: string): string | undefined {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  const chatIndex = segments.findIndex((segment) => segment.toLocaleLowerCase() === "chat");
  return chatIndex >= 0 ? segments[chatIndex + 1] : undefined;
}

function scalarCursor(body: unknown, key: string): string | number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function scalarIdentity(body: unknown, ...keys: readonly string[]): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function observationIsCurrent(observedAt: string, context: AcquisitionContext): boolean {
  const boundary = context.data?.acquisitionObservedAfter;
  if (typeof boundary !== "number" || !Number.isFinite(boundary)) return true;
  const observed = Date.parse(observedAt);
  return Number.isFinite(observed) && observed >= boundary;
}
