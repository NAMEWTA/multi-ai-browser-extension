export const providerErrorCodes = [
  "COMPOSER_MISSING",
  "COMPOSER_NOT_READY",
  "COMPOSER_NOT_EMPTY",
  "PROMPT_MISMATCH",
  "SUBMIT_MISSING",
  "SUBMIT_DISABLED",
  "SUBMIT_UNCONFIRMED",
  "PROVIDER_BUSY",
  "NEW_CONVERSATION_MISSING",
  "NEW_CONVERSATION_UNCONFIRMED",
  "RESPONSE_CAPTURE_FAILED",
  "LOGIN_REQUIRED",
  "VERIFICATION_REQUIRED",
  "TIMEOUT",
  "ABORTED",
  "UNSUPPORTED_PAGE",
  "UNKNOWN",
] as const;

export type ProviderErrorCode = (typeof providerErrorCodes)[number];

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ProviderError("ABORTED", "操作已取消", { cause: error });
  }
  if (error instanceof Error) {
    return new ProviderError("UNKNOWN", error.message, { cause: error });
  }
  return new ProviderError("UNKNOWN", "未知网页操作错误");
}
