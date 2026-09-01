import type { NativeCopyMimeType, NativeCopyPayload } from "../core/providers/contracts";

export const NATIVE_COPY_REQUEST_EVENT = "maw:native-copy:request:v1";
export const NATIVE_COPY_RESPONSE_EVENT = "maw:native-copy:response:v1";
export const MAX_NATIVE_COPY_TEXT_LENGTH = 2_000_000;

export interface NativeCopyArmMessage {
  readonly type: "arm";
  readonly token: string;
  readonly suppressSystemClipboard: boolean;
  readonly timeoutMs?: number;
}

export interface NativeCopyCancelMessage {
  readonly type: "cancel";
  readonly token: string;
}

export type NativeCopyRequestMessage = NativeCopyArmMessage | NativeCopyCancelMessage;

export interface NativeCopyArmedMessage {
  readonly type: "armed";
  readonly token: string;
}

export interface NativeCopyCapturedMessage {
  readonly type: "captured";
  readonly token: string;
  readonly payload: NativeCopyPayload;
}

export interface NativeCopyErrorMessage {
  readonly type: "error";
  readonly token: string;
  readonly message: string;
}

export interface NativeCopyCanceledMessage {
  readonly type: "canceled";
  readonly token: string;
}

export type NativeCopyResponseMessage =
  | NativeCopyArmedMessage
  | NativeCopyCapturedMessage
  | NativeCopyErrorMessage
  | NativeCopyCanceledMessage;

export function dispatchNativeCopyRequest(
  targetWindow: Window,
  message: NativeCopyRequestMessage,
): void {
  dispatchMessage(targetWindow, NATIVE_COPY_REQUEST_EVENT, message);
}

export function dispatchNativeCopyResponse(
  targetWindow: Window,
  message: NativeCopyResponseMessage,
): void {
  dispatchMessage(targetWindow, NATIVE_COPY_RESPONSE_EVENT, message);
}

export function readNativeCopyRequest(event: Event): NativeCopyRequestMessage | undefined {
  const value = readEventDetail(event);
  if (!isRecord(value) || !isToken(value.token)) return undefined;
  if (value.type === "cancel") return { type: "cancel", token: value.token };
  if (value.type !== "arm" || typeof value.suppressSystemClipboard !== "boolean") return undefined;
  return {
    type: "arm",
    token: value.token,
    suppressSystemClipboard: value.suppressSystemClipboard,
    ...(isTimeout(value.timeoutMs) ? { timeoutMs: value.timeoutMs } : {}),
  };
}

export function readNativeCopyResponse(event: Event): NativeCopyResponseMessage | undefined {
  const value = readEventDetail(event);
  if (!isRecord(value) || !isToken(value.token) || typeof value.type !== "string") {
    return undefined;
  }
  if (value.type === "armed" || value.type === "canceled") {
    return { type: value.type, token: value.token };
  }
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", token: value.token, message: value.message };
  }
  if (value.type === "captured" && isNativeCopyPayload(value.payload)) {
    return { type: "captured", token: value.token, payload: value.payload };
  }
  return undefined;
}

function dispatchMessage(
  targetWindow: Window,
  eventName: string,
  message: NativeCopyRequestMessage | NativeCopyResponseMessage,
): void {
  const CustomEventConstructor = (targetWindow as unknown as { CustomEvent: typeof CustomEvent })
    .CustomEvent;
  targetWindow.document.dispatchEvent(
    new CustomEventConstructor<string>(eventName, { detail: JSON.stringify(message) }),
  );
}

function readEventDetail(event: Event): unknown {
  const detail = "detail" in event ? (event as CustomEvent<unknown>).detail : undefined;
  if (typeof detail !== "string") return undefined;
  try {
    return JSON.parse(detail) as unknown;
  } catch {
    return undefined;
  }
}

function isNativeCopyPayload(value: unknown): value is NativeCopyPayload {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    value.text.length <= MAX_NATIVE_COPY_TEXT_LENGTH &&
    isNativeCopyMimeType(value.mimeType)
  );
}

function isNativeCopyMimeType(value: unknown): value is NativeCopyMimeType {
  return value === "text/markdown" || value === "text/plain" || value === "text/html";
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 30_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
