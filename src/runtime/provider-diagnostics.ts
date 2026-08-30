import { browser } from "wxt/browser";
import type { ProviderId } from "../core/providers/contracts";

const DIAGNOSTIC_PREFIX = "provider-diagnostics-v1:";
const MAX_RECORDS_PER_PANEL = 80;

export type DiagnosticStage =
  "frame-ready" | "command-start" | "write-confirmed" | "submit-confirmed" | "command-failed";

interface DiagnosticRecord {
  readonly at: string;
  readonly providerId: ProviderId;
  readonly panelId: string;
  readonly stage: DiagnosticStage;
  readonly operation?: "sync" | "submit";
  readonly promptLength?: number;
  readonly durationMs?: number;
  readonly url: string;
  readonly composer?: string;
  readonly submit?: string;
  readonly errorCode?: string;
}

export async function appendProviderDiagnostic(
  panelId: string,
  providerId: ProviderId,
  record: Omit<DiagnosticRecord, "at" | "panelId" | "providerId" | "url">,
): Promise<void> {
  const key = `${DIAGNOSTIC_PREFIX}${panelId}`;
  const stored = await browser.storage.session.get(key);
  const current = Array.isArray(stored[key]) ? (stored[key] as DiagnosticRecord[]) : [];
  const next: DiagnosticRecord = {
    ...record,
    at: new Date().toISOString(),
    panelId,
    providerId,
    url: location.href,
  };
  await browser.storage.session.set({ [key]: [...current, next].slice(-MAX_RECORDS_PER_PANEL) });
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
