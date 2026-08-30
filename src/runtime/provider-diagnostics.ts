import { browser } from "wxt/browser";
import type { ProviderId } from "../core/providers/contracts";

export type DiagnosticStage =
  | "frame-ready"
  | "command-start"
  | "precheck-confirmed"
  | "stage-confirmed"
  | "commit-confirmed"
  | "rollback-confirmed"
  | "response-update"
  | "new-session-confirmed"
  | "command-failed";

interface DiagnosticRecord {
  readonly providerId: ProviderId;
  readonly panelId: string;
  readonly stage: DiagnosticStage;
  readonly operation?: "precheck" | "stage" | "commit" | "rollback" | "new-session" | "response";
  readonly promptLength?: number;
  readonly durationMs?: number;
  readonly composer?: string;
  readonly submit?: string;
  readonly errorCode?: string;
}

export async function appendProviderDiagnostic(
  panelId: string,
  providerId: ProviderId,
  record: Omit<DiagnosticRecord, "panelId" | "providerId">,
): Promise<void> {
  await browser.runtime.sendMessage({
    type: "PROVIDER_DIAGNOSTIC",
    ...record,
    panelId,
    providerId,
  });
}

export function describeProviderElement(element: Element | null): string | undefined {
  if (!element) return undefined;
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList]
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join("");
  const role = element.getAttribute("role");
  return `${element.tagName.toLowerCase()}${id}${classes}${role ? `[role=${role}]` : ""}`;
}
