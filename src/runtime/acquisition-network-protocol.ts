import type { ProviderId } from "../core/providers/contracts";

export const ACQUISITION_NETWORK_REQUEST_EVENT = "maw:acquisition-network:request:v2";
export const ACQUISITION_NETWORK_RESPONSE_EVENT = "maw:acquisition-network:response:v2";
export const MAX_ACQUISITION_REQUEST_LENGTH = 64_000;
export const MAX_ACQUISITION_RESPONSE_LENGTH = 8_000_000;

export type ProviderEndpointId =
  | "deepseek-history"
  | "doubao-chain"
  | "kimi-list-messages"
  | "qwen-conversation"
  | "chatgpt-conversation"
  | "claude-conversation";

export interface ObservedRequestDescriptor {
  readonly observationId: string;
  readonly providerId: ProviderId;
  readonly endpointId: ProviderEndpointId;
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
  readonly observedAt: string;
}

export type AcquisitionNetworkRequest =
  | {
      readonly type: "latest";
      readonly token: string;
      readonly providerId: ProviderId;
      readonly endpointId: ProviderEndpointId;
    }
  | {
      readonly type: "replay";
      readonly token: string;
      readonly observationId: string;
      readonly bodyPatch?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "fetch-json";
      readonly token: string;
      readonly providerId: ProviderId;
      readonly endpointId: ProviderEndpointId;
      readonly url: string;
    };

export type AcquisitionNetworkResponse =
  | {
      readonly type: "result";
      readonly token: string;
      readonly observation?: ObservedRequestDescriptor;
      readonly payload?: unknown;
      readonly status?: number;
    }
  | { readonly type: "error"; readonly token: string; readonly message: string };

export function dispatchAcquisitionNetworkRequest(
  targetWindow: Window,
  message: AcquisitionNetworkRequest,
): void {
  dispatch(
    targetWindow,
    ACQUISITION_NETWORK_REQUEST_EVENT,
    message,
    MAX_ACQUISITION_REQUEST_LENGTH,
  );
}

export function dispatchAcquisitionNetworkResponse(
  targetWindow: Window,
  message: AcquisitionNetworkResponse,
): void {
  let detail: string;
  try {
    detail = serialize(message);
  } catch {
    detail = serialize({
      type: "error",
      token: message.token,
      message: "Provider response could not be serialized",
    } satisfies AcquisitionNetworkResponse);
  }
  if (detail.length > MAX_ACQUISITION_RESPONSE_LENGTH) {
    detail = serialize({
      type: "error",
      token: message.token,
      message: "Provider response exceeds the supported size",
    } satisfies AcquisitionNetworkResponse);
  }
  dispatchDetail(targetWindow, ACQUISITION_NETWORK_RESPONSE_EVENT, detail);
}

export function readAcquisitionNetworkRequest(event: Event): AcquisitionNetworkRequest | undefined {
  const value = readDetail(event, MAX_ACQUISITION_REQUEST_LENGTH);
  if (!isRecord(value) || !isToken(value.token) || typeof value.type !== "string") return undefined;
  if (value.type === "latest") {
    return isProviderId(value.providerId) &&
      isEndpointId(value.endpointId) &&
      isProviderEndpointPair(value.providerId, value.endpointId)
      ? {
          type: "latest",
          token: value.token,
          providerId: value.providerId,
          endpointId: value.endpointId,
        }
      : undefined;
  }
  if (value.type === "replay") {
    if (!isObservationId(value.observationId)) return undefined;
    return {
      type: "replay",
      token: value.token,
      observationId: value.observationId,
      ...(isRecord(value.bodyPatch) ? { bodyPatch: value.bodyPatch } : {}),
    };
  }
  if (value.type === "fetch-json") {
    return isProviderId(value.providerId) &&
      isEndpointId(value.endpointId) &&
      isProviderEndpointPair(value.providerId, value.endpointId) &&
      typeof value.url === "string" &&
      value.url.length <= 2_000
      ? {
          type: "fetch-json",
          token: value.token,
          providerId: value.providerId,
          endpointId: value.endpointId,
          url: value.url,
        }
      : undefined;
  }
  return undefined;
}

export function readAcquisitionNetworkResponse(
  event: Event,
): AcquisitionNetworkResponse | undefined {
  const value = readDetail(event, MAX_ACQUISITION_RESPONSE_LENGTH);
  if (!isRecord(value) || !isToken(value.token)) return undefined;
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", token: value.token, message: value.message.slice(0, 1_000) };
  }
  if (value.type !== "result") return undefined;
  const observation = readObservation(value.observation);
  return {
    type: "result",
    token: value.token,
    ...(observation ? { observation } : {}),
    ...(value.payload !== undefined ? { payload: value.payload } : {}),
    ...(isHttpStatus(value.status) ? { status: value.status } : {}),
  };
}

export function identifyProviderEndpoint(
  hostname: string,
  pathname: string,
): { providerId: ProviderId; endpointId: ProviderEndpointId } | undefined {
  const host = hostname.toLocaleLowerCase();
  if (host === "chat.deepseek.com" && pathname === "/api/v0/chat/history_messages") {
    return { providerId: "deepseek", endpointId: "deepseek-history" };
  }
  if ((host === "doubao.com" || host === "www.doubao.com") && pathname === "/im/chain/single") {
    return { providerId: "doubao", endpointId: "doubao-chain" };
  }
  if (
    (host === "kimi.com" || host === "www.kimi.com") &&
    pathname.endsWith("/kimi.gateway.chat.v1.ChatService/ListMessages")
  ) {
    return { providerId: "kimi", endpointId: "kimi-list-messages" };
  }
  if (host === "www.qianwen.com" && pathname.startsWith("/api/v2/conversation/")) {
    return { providerId: "qwen", endpointId: "qwen-conversation" };
  }
  if (host === "chatgpt.com" && pathname.startsWith("/backend-api/conversation/")) {
    return { providerId: "chatgpt", endpointId: "chatgpt-conversation" };
  }
  if (
    host === "claude.ai" &&
    /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/?$/.test(pathname)
  ) {
    return { providerId: "claude", endpointId: "claude-conversation" };
  }
  return undefined;
}

function dispatch(
  targetWindow: Window,
  name: string,
  message: unknown,
  maximumLength: number,
): void {
  const detail = serialize(message);
  if (detail.length > maximumLength) {
    throw new RangeError(`Acquisition network event exceeds ${maximumLength} characters.`);
  }
  dispatchDetail(targetWindow, name, detail);
}

function dispatchDetail(targetWindow: Window, name: string, detail: string): void {
  const CustomEventConstructor = (targetWindow as unknown as { CustomEvent: typeof CustomEvent })
    .CustomEvent;
  targetWindow.document.dispatchEvent(new CustomEventConstructor<string>(name, { detail }));
}

function serialize(message: unknown): string {
  const value = JSON.stringify(message);
  if (value === undefined) throw new TypeError("Acquisition network event is not serializable.");
  return value;
}

function readDetail(event: Event, maximumLength: number): unknown {
  const detail = "detail" in event ? (event as CustomEvent<unknown>).detail : undefined;
  if (typeof detail !== "string" || detail.length > maximumLength) return undefined;
  try {
    return JSON.parse(detail) as unknown;
  } catch {
    return undefined;
  }
}

function readObservation(value: unknown): ObservedRequestDescriptor | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isObservationId(value.observationId) ||
    !isProviderId(value.providerId) ||
    !isEndpointId(value.endpointId) ||
    !isProviderEndpointPair(value.providerId, value.endpointId) ||
    typeof value.url !== "string" ||
    value.url.length > 2_000 ||
    typeof value.method !== "string" ||
    value.method.length > 16 ||
    typeof value.observedAt !== "string" ||
    value.observedAt.length > 64
  ) {
    return undefined;
  }
  return {
    observationId: value.observationId,
    providerId: value.providerId,
    endpointId: value.endpointId,
    url: value.url,
    method: value.method,
    ...(value.body !== undefined ? { body: value.body } : {}),
    observedAt: value.observedAt,
  };
}

function isProviderId(value: unknown): value is ProviderId {
  return ["deepseek", "kimi", "coze", "chatgpt", "claude", "qwen", "minimax", "doubao"].includes(
    String(value),
  );
}

function isEndpointId(value: unknown): value is ProviderEndpointId {
  return [
    "deepseek-history",
    "doubao-chain",
    "kimi-list-messages",
    "qwen-conversation",
    "chatgpt-conversation",
    "claude-conversation",
  ].includes(String(value));
}

function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isObservationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isProviderEndpointPair(providerId: ProviderId, endpointId: ProviderEndpointId): boolean {
  return endpointId.startsWith(`${providerId}-`);
}

function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
