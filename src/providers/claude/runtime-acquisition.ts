import type {
  AcquisitionContext,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "../../core/acquisition";
import type { AcquisitionNetworkClient } from "../../runtime/acquisition-network-client";
import { parseClaudeConversation } from "./acquisition";

export const CLAUDE_ACQUISITION_ADAPTER_VERSION = "claude-conversation-v2";

export const claudeAcquisitionAdapter: ProviderAcquisitionAdapter = {
  providerId: "claude",
  strategiesByPriority: [
    {
      id: "claude-conversation-api",
      source: "provider-api",
      acquire: acquireClaudeConversation,
    },
  ],
  qualityPolicy: { requireComplete: true },
};

async function acquireClaudeConversation(
  context: AcquisitionContext,
): Promise<ConversationSnapshot | undefined> {
  const network = context.data?.network as AcquisitionNetworkClient | undefined;
  const pageUrl = stringValue(context.data?.url) ?? context.window?.location.href;
  if (!network || !pageUrl) return undefined;
  const observed = await network.latest("claude", "claude-conversation").catch(() => undefined);
  if (!observed?.observation || !observationIsCurrent(observed.observation.observedAt, context)) {
    return undefined;
  }
  const conversationId = claudeConversationId(pageUrl, observed.observation.url);
  const observedConversationId = /\/chat_conversations\/([^/?#]+)/.exec(
    new URL(observed.observation.url).pathname,
  )?.[1];
  if (!conversationId || observedConversationId !== conversationId) {
    return undefined;
  }
  const payload =
    observed.payload ??
    (await network.replay(observed.observation.observationId).catch(() => undefined))?.payload;
  return payload === undefined
    ? undefined
    : parseClaudeConversation(payload, conversationId, pageUrl);
}

function claudeConversationId(pageUrl: string, observedUrl: string): string | undefined {
  const pageMatch = /^\/chat\/([^/?#]+)/.exec(new URL(pageUrl).pathname)?.[1];
  const observedMatch = /\/chat_conversations\/([^/?#]+)/.exec(new URL(observedUrl).pathname)?.[1];
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
