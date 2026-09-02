import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { parseDeepSeekHistory, type DeepSeekAcquisitionResult } from "./acquisition";

export const DEEPSEEK_ACQUISITION_ADAPTER_VERSION = "deepseek-history-v2";

export const deepseekAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "deepseek",
  strategiesByPriority: [
    {
      id: "deepseek-conversation-api",
      source: "provider-api",
      acquire: acquireDeepSeekConversation,
    },
  ],
  qualityPolicy: {
    requireComplete: true,
    requireBranchEvidence: true,
    minimumMessageRatio: 1,
    minimumContentRatio: 1,
  },
};

async function acquireDeepSeekConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;
  const conversationId = deepseekConversationId(pageUrl);
  if (!conversationId) return undefined;

  let payload: unknown;
  const observed = await network.latest("deepseek", "deepseek-history").catch(() => undefined);
  if (observed?.observation && observationIsCurrent(observed.observation.observedAt, context)) {
    payload =
      observed.payload ??
      (await network.replay(observed.observation.observationId).catch(() => undefined))?.payload;
  }
  if (payload === undefined) {
    const url = new URL("/api/v0/chat/history_messages", pageUrl);
    url.searchParams.set("chat_session_id", conversationId);
    payload = (
      await network.fetchJson("deepseek", "deepseek-history", url.href).catch(() => undefined)
    )?.payload;
  }
  if (payload === undefined) return undefined;
  return deepseekResultToSnapshot(parseDeepSeekHistory(payload), conversationId, pageUrl);
}

export function deepseekResultToSnapshot(
  result: DeepSeekAcquisitionResult,
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
  }));
  const capturedContentChars = messages.reduce(
    (total, message) => total + message.content.reduce((sum, block) => sum + block.text.length, 0),
    0,
  );
  const branchComplete =
    result.evidence.branchRootVerified && result.evidence.stopReason === "complete";
  const complete =
    result.completeness === "verified" || (result.completeness === "bounded" && branchComplete);
  return {
    schemaVersion: 1,
    providerId: "deepseek",
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
      hasBeginning: result.evidence.branchRootVerified,
      hasEnd: Boolean(result.evidence.currentMessageId) || branchComplete,
    },
    evidence: {
      stableMessageKeys: messages.map(({ id }) => id),
      signals: [
        `stop:${result.evidence.stopReason}`,
        `verification:${result.completeness}`,
        `pages:${result.evidence.pageCount}`,
      ],
      branch: {
        ...(result.evidence.currentMessageId
          ? { currentNodeId: result.evidence.currentMessageId }
          : {}),
        capturedNodeIds: messages.map(({ id }) => id),
        linearized: result.evidence.branchRootVerified,
        complete: branchComplete,
      },
    },
    diagnostics: {
      strategyId: "deepseek-conversation-api",
      entries: complete
        ? []
        : [
            {
              code: "DEEPSEEK_HISTORY_NOT_VERIFIED",
              severity: "warning",
              message: `DeepSeek history stopped with ${result.evidence.stopReason}.`,
            },
          ],
    },
  };
}

function deepseekConversationId(value: string): string | undefined {
  const url = new URL(value);
  const match = /\/(?:a\/)?chat\/(?:s\/)?([^/?#]+)/i.exec(url.pathname);
  return match?.[1]?.trim() || url.searchParams.get("chat_session_id") || undefined;
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
