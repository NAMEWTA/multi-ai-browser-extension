import { builtInProviderMatches } from "../core/providers/built-in-sites";
import {
  ACQUISITION_NETWORK_REQUEST_EVENT,
  MAX_ACQUISITION_RESPONSE_LENGTH,
  dispatchAcquisitionNetworkResponse,
  identifyProviderEndpoint,
  readAcquisitionNetworkRequest,
  type ObservedRequestDescriptor,
  type ProviderEndpointId,
} from "../runtime/acquisition-network-protocol";

const INSTALLATION_KEY = Symbol.for("multi-ai-browser-extension.acquisition-network-main.v2");
const MAX_OBSERVATIONS = 24;
const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "accesstoken",
  "xaccesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "csrftoken",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "clientsecret",
  "apikey",
  "xapikey",
  "secretkey",
  "sessiontoken",
  "bearer",
  "credential",
  "credentials",
  "privatekey",
  "signature",
]);

interface PrivateObservation {
  readonly descriptor: ObservedRequestDescriptor;
  readonly requestUrl: string;
  readonly headers: readonly [string, string][];
  readonly credentials: RequestCredentials;
  readonly bodyText?: string;
  payload?: unknown;
  status?: number;
}

interface XhrState {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  bodyText?: string;
}

export function installAcquisitionNetworkBridge(targetWindow: Window = window): () => void {
  const scope = targetWindow as unknown as Record<PropertyKey, unknown>;
  if (scope[INSTALLATION_KEY]) return () => undefined;

  const observations: PrivateObservation[] = [];
  const restorers: Array<() => void> = [];
  const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();

  const remember = (observation: PrivateObservation): void => {
    const duplicateIndex = observations.findIndex(
      (candidate) =>
        candidate.descriptor.endpointId === observation.descriptor.endpointId &&
        candidate.descriptor.url === observation.descriptor.url &&
        candidate.bodyText === observation.bodyText,
    );
    if (duplicateIndex >= 0) observations.splice(duplicateIndex, 1);
    observations.push(observation);
    while (observations.length > MAX_OBSERVATIONS) observations.shift();
  };

  const originalFetch = targetWindow.fetch;
  const patchedFetch: typeof fetch = function (input, init) {
    const prepared = prepareFetchObservation(targetWindow, input, init).catch(() => undefined);
    const response = originalFetch.call(targetWindow, input, init);
    void prepared.then((observation) => {
      if (!observation) return;
      remember(observation);
      void response
        .then((value) =>
          readJsonPayload(value.clone()).then((payload) => {
            if (payload === undefined) return;
            observation.payload = sanitizeValue(payload);
            observation.status = value.status;
          }),
        )
        .catch(() => undefined);
    });
    return response;
  };
  const restoreFetch = replaceMethod(targetWindow, "fetch", patchedFetch);
  if (restoreFetch) restorers.push(restoreFetch);

  const Xhr = (targetWindow as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest;
  if (Xhr) {
    const originalOpen = Xhr.prototype.open;
    const originalSetRequestHeader = Xhr.prototype.setRequestHeader;
    const originalSend = Xhr.prototype.send;

    Xhr.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      xhrStates.set(this, { method: method.toUpperCase(), url: String(url), headers: [] });
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof Xhr.prototype.open;
    Xhr.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      xhrStates.get(this)?.headers.push([name, value]);
      return originalSetRequestHeader.call(this, name, value);
    };
    Xhr.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const state = xhrStates.get(this);
      if (state && typeof body === "string") state.bodyText = body;
      const observation = state
        ? createObservation(
            targetWindow,
            state.url,
            state.method,
            state.headers,
            "include",
            state.bodyText,
          )
        : undefined;
      if (observation) {
        remember(observation);
        this.addEventListener(
          "load",
          () => {
            if (this.responseType && this.responseType !== "text" && this.responseType !== "json") {
              return;
            }
            const payload =
              this.responseType === "json"
                ? this.response
                : this.responseText.length <= MAX_ACQUISITION_RESPONSE_LENGTH
                  ? parseJson(this.responseText)
                  : undefined;
            if (payload === undefined) return;
            const sanitized = sanitizeValue(payload);
            if (!fitsResponseLimit(sanitized)) return;
            observation.payload = sanitized;
            observation.status = this.status;
          },
          { once: true },
        );
      }
      return originalSend.call(this, body);
    };

    restorers.push(() => {
      Xhr.prototype.open = originalOpen;
      Xhr.prototype.setRequestHeader = originalSetRequestHeader;
      Xhr.prototype.send = originalSend;
    });
  }

  const onRequest = (event: Event): void => {
    const request = readAcquisitionNetworkRequest(event);
    if (!request) return;
    void (async () => {
      try {
        if (request.type === "latest") {
          const observation = observations
            .filter(
              ({ descriptor }) =>
                descriptor.providerId === request.providerId &&
                descriptor.endpointId === request.endpointId,
            )
            .at(-1);
          dispatchAcquisitionNetworkResponse(targetWindow, {
            type: "result",
            token: request.token,
            ...(observation ? { observation: observation.descriptor } : {}),
            ...(observation?.payload !== undefined ? { payload: observation.payload } : {}),
            ...(observation?.status !== undefined ? { status: observation.status } : {}),
          });
          return;
        }

        if (request.type === "replay") {
          const observation = observations.find(
            ({ descriptor }) => descriptor.observationId === request.observationId,
          );
          if (!observation) throw new Error("Observed provider request is no longer available");
          const body = patchBody(
            observation.descriptor.endpointId,
            observation.bodyText,
            request.bodyPatch,
          );
          const response = await originalFetch.call(targetWindow, observation.requestUrl, {
            method: observation.descriptor.method,
            headers: [...observation.headers],
            credentials: observation.credentials,
            ...(body !== undefined ? { body } : {}),
          });
          const payload = await readJsonPayload(response);
          if (payload === undefined) throw new Error("Provider response was not valid JSON");
          dispatchAcquisitionNetworkResponse(targetWindow, {
            type: "result",
            token: request.token,
            observation: observation.descriptor,
            payload: sanitizeValue(payload),
            status: response.status,
          });
          return;
        }

        const url = new URL(request.url, targetWindow.location.href);
        if (url.origin !== targetWindow.location.origin)
          throw new Error("Cross-origin fetch rejected");
        const identified = identifyProviderEndpoint(url.hostname, url.pathname);
        if (
          !identified ||
          identified.providerId !== request.providerId ||
          identified.endpointId !== request.endpointId
        ) {
          throw new Error("Provider endpoint is not allowlisted");
        }
        const response = await originalFetch.call(targetWindow, url.href, {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const payload = await readJsonPayload(response);
        if (payload === undefined) throw new Error("Provider response was not valid JSON");
        dispatchAcquisitionNetworkResponse(targetWindow, {
          type: "result",
          token: request.token,
          payload: sanitizeValue(payload),
          status: response.status,
        });
      } catch (error) {
        dispatchAcquisitionNetworkResponse(targetWindow, {
          type: "error",
          token: request.token,
          message: error instanceof Error ? error.message : "Provider acquisition bridge failed",
        });
      }
    })();
  };

  targetWindow.document.addEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, onRequest);
  const uninstall = (): void => {
    targetWindow.document.removeEventListener(ACQUISITION_NETWORK_REQUEST_EVENT, onRequest);
    for (const restore of restorers.reverse()) restore();
    delete scope[INSTALLATION_KEY];
  };
  scope[INSTALLATION_KEY] = { uninstall };
  return uninstall;
}

async function prepareFetchObservation(
  targetWindow: Window,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<PrivateObservation | undefined> {
  const RequestConstructor = (targetWindow as unknown as { Request: typeof Request }).Request;
  const request = new RequestConstructor(input, init);
  const bodyText =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.clone().text();
  return createObservation(
    targetWindow,
    request.url,
    request.method,
    [...request.headers.entries()],
    request.credentials,
    bodyText,
  );
}

function createObservation(
  targetWindow: Window,
  rawUrl: string,
  method: string,
  headers: readonly [string, string][],
  credentials: RequestCredentials,
  bodyText?: string,
): PrivateObservation | undefined {
  const url = new URL(rawUrl, targetWindow.location.href);
  if (url.origin !== targetWindow.location.origin) return undefined;
  const identified = identifyProviderEndpoint(url.hostname, url.pathname);
  if (!identified) return undefined;
  const descriptor: ObservedRequestDescriptor = {
    observationId: targetWindow.crypto.randomUUID(),
    ...identified,
    url: publicObservationUrl(url, identified.endpointId),
    method: method.toUpperCase(),
    ...(bodyText ? { body: sanitizeRequestBody(identified.endpointId, bodyText) } : {}),
    observedAt: new Date().toISOString(),
  };
  return {
    descriptor,
    requestUrl: url.href,
    headers: headers.filter(([name]) => !/^cookie$/i.test(name)),
    credentials,
    ...(bodyText ? { bodyText } : {}),
  };
}

function patchBody(
  endpointId: ProviderEndpointId,
  bodyText: string | undefined,
  patch: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (!bodyText || !patch) return bodyText;
  const body = parseJson(bodyText);
  if (!isRecord(body)) return bodyText;
  const allowed = allowedPatchKeys(endpointId);
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key) && isScalar(value)) body[key] = value;
  }
  return JSON.stringify(body);
}

function sanitizeRequestBody(endpointId: ProviderEndpointId, bodyText: string): unknown {
  const body = parseJson(bodyText);
  if (!isRecord(body)) return undefined;
  const allowed = allowedDescriptorKeys(endpointId);
  return Object.fromEntries(
    Object.entries(body).filter(([key, value]) => allowed.has(key) && isScalar(value)),
  );
}

function allowedDescriptorKeys(endpointId: ProviderEndpointId): ReadonlySet<string> {
  if (endpointId === "doubao-chain") {
    return new Set([
      "conversation_id",
      "conversationId",
      "anchor",
      "direction",
      "limit",
      "section_id",
      "bot_id",
    ]);
  }
  if (endpointId === "kimi-list-messages") {
    return new Set(["chat_id", "page_size", "page_token"]);
  }
  return new Set(["conversation_id", "conversationId", "chat_id", "session_id"]);
}

function allowedPatchKeys(endpointId: ProviderEndpointId): ReadonlySet<string> {
  if (endpointId === "doubao-chain") return new Set(["anchor", "direction", "limit"]);
  if (endpointId === "kimi-list-messages") return new Set(["page_size", "page_token"]);
  return new Set();
}

async function readJsonPayload(response: Response): Promise<unknown | undefined> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ACQUISITION_RESPONSE_LENGTH) {
    return undefined;
  }
  const text = await response.text();
  if (!text || text.length > MAX_ACQUISITION_RESPONSE_LENGTH) return undefined;
  return parseJson(text);
}

function publicObservationUrl(url: URL, endpointId: ProviderEndpointId): string {
  const result = new URL(url.pathname, url.origin);
  const allowed = allowedDescriptorKeys(endpointId);
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key)) continue;
    result.searchParams.append(key, value);
    if (result.href.length > 2_000) {
      result.searchParams.delete(key);
      break;
    }
  }
  return result.href;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
  );
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLocaleLowerCase().replaceAll(/[_-]/g, ""));
}

function fitsResponseLimit(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= MAX_ACQUISITION_RESPONSE_LENGTH;
  } catch {
    return false;
  }
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function replaceMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
): (() => void) | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, { configurable: true, writable: true, value: replacement });
  } catch {
    return undefined;
  }
  return () => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  };
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export default defineContentScript({
  matches: [...builtInProviderMatches],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    installAcquisitionNetworkBridge(window);
  },
});
