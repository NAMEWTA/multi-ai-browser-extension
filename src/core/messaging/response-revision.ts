import type { ProviderResponseUpdate } from "./protocol";

export type RevisionedResponseUpdate = Omit<ProviderResponseUpdate, "type">;

const TERMINAL_STATUSES = new Set<RevisionedResponseUpdate["status"]>([
  "completed",
  "partial",
  "timeout",
  "failed",
  "unsupported",
]);

export function mergeResponseRevision(
  current: RevisionedResponseUpdate | undefined,
  incoming: RevisionedResponseUpdate,
): RevisionedResponseUpdate {
  if (!current) return incoming;
  if (current.captureId !== incoming.captureId) return current;
  if (incoming.revision <= current.revision || TERMINAL_STATUSES.has(current.status))
    return current;
  return {
    ...incoming,
    ...(incoming.text === undefined && current.text !== undefined ? { text: current.text } : {}),
    ...(incoming.markdown === undefined && current.markdown !== undefined
      ? { markdown: current.markdown }
      : {}),
  };
}

export function isResponseTerminal(status: RevisionedResponseUpdate["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}
