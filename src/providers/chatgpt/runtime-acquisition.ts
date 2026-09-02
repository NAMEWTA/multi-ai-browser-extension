import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { parseChatGptConversation } from "./acquisition";

export const CHATGPT_ACQUISITION_ADAPTER_VERSION = "chatgpt-conversation-v2";

export const chatGptAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "chatgpt",
  strategiesByPriority: [
    {
      id: "chatgpt-conversation-api",
      source: "provider-api",
      acquire: acquireChatGptConversation,
    },
  ],
  qualityPolicy: { requireComplete: true, requireBranchEvidence: true },
};

async function acquireChatGptConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;
  const observed = await network.latest("chatgpt", "chatgpt-conversation").catch(() => undefined);
  if (!observed?.observation || !observationIsCurrent(observed.observation.observedAt, context)) {
    return undefined;
  }
  const conversationId = chatGptConversationId(pageUrl, observed.observation.url);
  if (!conversationId || !observed.observation.url.includes(`/conversation/${conversationId}`)) {
    return undefined;
  }
  const payload =
    observed.payload ??
    (await network.replay(observed.observation.observationId).catch(() => undefined))?.payload;
  return payload === undefined
    ? undefined
    : parseChatGptConversation(payload, conversationId, pageUrl);
}

function chatGptConversationId(pageUrl: string, observedUrl: string): string | undefined {
  const pageMatch = /^\/c\/([^/?#]+)/.exec(new URL(pageUrl).pathname)?.[1];
  const observedMatch = /\/backend-api\/conversation\/([^/?#]+)/.exec(
    new URL(observedUrl).pathname,
  )?.[1];
  return pageMatch ?? observedMatch;
}

function observationIsCurrent(observedAt: string, context: AcquisitionContext): boolean {
  const boundary = context.data?.acquisitionObservedAfter;
  if (typeof boundary !== "number" || !Number.isFinite(boundary)) return true;
  const observed = Date.parse(observedAt);
  return Number.isFinite(observed) && observed >= boundary;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
