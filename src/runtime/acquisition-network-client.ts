import type { ProviderId } from "../core/providers/contracts";
import {
  ACQUISITION_NETWORK_RESPONSE_EVENT,
  dispatchAcquisitionNetworkRequest,
  readAcquisitionNetworkResponse,
  type ObservedRequestDescriptor,
  type ProviderEndpointId,
} from "./acquisition-network-protocol";

export interface AcquisitionNetworkResult {
  readonly observation?: ObservedRequestDescriptor;
  readonly payload?: unknown;
  readonly status?: number;
}

export interface AcquisitionNetworkClient {
  latest(providerId: ProviderId, endpointId: ProviderEndpointId): Promise<AcquisitionNetworkResult>;
  replay(
    observationId: string,
    bodyPatch?: Readonly<Record<string, unknown>>,
  ): Promise<AcquisitionNetworkResult>;
  fetchJson(
    providerId: ProviderId,
    endpointId: ProviderEndpointId,
    url: string,
  ): Promise<AcquisitionNetworkResult>;
}

const DEFAULT_TIMEOUT_MS = 12_000;

export function createAcquisitionNetworkClient(
  targetWindow: Window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): AcquisitionNetworkClient {
  const invoke = async (
    request:
      | { type: "latest"; providerId: ProviderId; endpointId: ProviderEndpointId }
      | { type: "replay"; observationId: string; bodyPatch?: Readonly<Record<string, unknown>> }
      | { type: "fetch-json"; providerId: ProviderId; endpointId: ProviderEndpointId; url: string },
  ): Promise<AcquisitionNetworkResult> => {
    const token = createToken(targetWindow);
    return await new Promise<AcquisitionNetworkResult>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | undefined, result?: AcquisitionNetworkResult): void => {
        if (settled) return;
        settled = true;
        targetWindow.document.removeEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, onResponse);
        targetWindow.clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result ?? {});
      };
      const onResponse = (event: Event): void => {
        const response = readAcquisitionNetworkResponse(event);
        if (!response || response.token !== token) return;
        if (response.type === "error") {
          finish(new Error(response.message));
          return;
        }
        finish(undefined, {
          ...(response.observation ? { observation: response.observation } : {}),
          ...(response.payload !== undefined ? { payload: response.payload } : {}),
          ...(response.status !== undefined ? { status: response.status } : {}),
        });
      };
      targetWindow.document.addEventListener(ACQUISITION_NETWORK_RESPONSE_EVENT, onResponse);
      const timeout = targetWindow.setTimeout(
        () => finish(new Error("Provider conversation request timed out")),
        normalizedTimeout(timeoutMs),
      );
      try {
        dispatchAcquisitionNetworkRequest(targetWindow, { ...request, token });
      } catch (caught) {
        finish(caught instanceof Error ? caught : new Error(String(caught)));
      }
    });
  };

  return {
    latest: (providerId, endpointId) => invoke({ type: "latest", providerId, endpointId }),
    replay: (observationId, bodyPatch) =>
      invoke({ type: "replay", observationId, ...(bodyPatch ? { bodyPatch } : {}) }),
    fetchJson: (providerId, endpointId, url) =>
      invoke({ type: "fetch-json", providerId, endpointId, url }),
  };
}

function normalizedTimeout(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

function createToken(targetWindow: Window): string {
  if (typeof targetWindow.crypto.randomUUID === "function") return targetWindow.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  targetWindow.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
