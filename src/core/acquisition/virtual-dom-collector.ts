import type { AcquisitionDiagnostic, Message } from "./contracts";

export interface VirtualMessageRevision {
  readonly key: string;
  /** Monotonically increasing for one stable key. */
  readonly revision: number;
  readonly order: number;
  readonly message: Message;
}

export interface VirtualDomCollectorAdapter {
  readonly container: HTMLElement;
  readVisibleMessages(): readonly VirtualMessageRevision[];
  waitForRender?(): Promise<void>;
}

export interface VirtualDomCollectorOptions {
  readonly seed?: readonly VirtualMessageRevision[];
  readonly signal?: AbortSignal;
  readonly maxSteps?: number;
  readonly minimumStepPx?: number;
  readonly stepRatio?: number;
  readonly stableBoundaryPasses?: number;
  readonly boundaryTolerancePx?: number;
}

export interface VirtualDomCollection {
  readonly revisions: readonly VirtualMessageRevision[];
  readonly messages: readonly Message[];
  readonly stableKeys: readonly string[];
  readonly reachedStart: boolean;
  readonly reachedEnd: boolean;
  readonly complete: boolean;
  readonly steps: number;
  readonly originalScrollTop: number;
  readonly restoredScroll: boolean;
  readonly diagnostics: readonly AcquisitionDiagnostic[];
}

export class VirtualDomCollectionError extends Error {
  override readonly name = "VirtualDomCollectionError";

  constructor(
    readonly code: "INVALID_MESSAGE_KEY" | "INVALID_REVISION" | "INVALID_ORDER",
    message: string,
  ) {
    super(message);
  }
}

export async function collectVirtualDomMessages(
  adapter: VirtualDomCollectorAdapter,
  options: VirtualDomCollectorOptions = {},
): Promise<VirtualDomCollection> {
  const container = adapter.container;
  const originalScrollTop = container.scrollTop;
  const revisions = new Map<string, VirtualMessageRevision>();
  const diagnostics: AcquisitionDiagnostic[] = [];
  const maxSteps = positiveInteger(options.maxSteps, 1_200);
  const minimumStepPx = positiveNumber(options.minimumStepPx, 200);
  const stepRatio = bounded(options.stepRatio, 0.72, 0.1, 1);
  const stablePasses = positiveInteger(options.stableBoundaryPasses, 2);
  const tolerance = nonNegativeNumber(options.boundaryTolerancePx, 8);
  let steps = 0;
  let reachedStart: boolean;
  let reachedEnd: boolean;
  let restoredScroll: boolean;

  ingest(options.seed ?? [], revisions);

  try {
    let stableAtStart = 0;
    while (steps < maxSteps && stableAtStart < stablePasses) {
      throwIfAborted(options.signal);
      container.scrollTop = 0;
      await waitForRender(adapter);
      const changed = ingest(adapter.readVisibleMessages(), revisions);
      steps += 1;
      const atStart = container.scrollTop <= tolerance;
      stableAtStart = atStart && !changed ? stableAtStart + 1 : 0;
    }
    reachedStart = stableAtStart >= stablePasses;

    let stableAtEnd = 0;
    while (steps < maxSteps && stableAtEnd < stablePasses) {
      throwIfAborted(options.signal);
      const changed = ingest(adapter.readVisibleMessages(), revisions);
      const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
      const atEnd = container.scrollTop >= maximum - tolerance;
      stableAtEnd = atEnd && !changed ? stableAtEnd + 1 : 0;
      if (stableAtEnd >= stablePasses) break;

      if (atEnd) {
        container.scrollTop = maximum;
      } else {
        const amount = Math.max(minimumStepPx, Math.floor(container.clientHeight * stepRatio));
        container.scrollTop = Math.min(maximum, container.scrollTop + amount);
      }
      await waitForRender(adapter);
      steps += 1;
    }
    reachedEnd = stableAtEnd >= stablePasses;

    if (!reachedStart || !reachedEnd) {
      diagnostics.push({
        code: "VIRTUAL_BOUNDARY_INCOMPLETE",
        severity: "warning",
        message: "The virtual conversation collector did not confirm both boundaries.",
        details: { reachedStart, reachedEnd, steps },
      });
    }
  } finally {
    container.scrollTop = originalScrollTop;
    await waitForRender(adapter).catch(() => undefined);
    restoredScroll = Math.abs(container.scrollTop - originalScrollTop) <= tolerance;
    if (!restoredScroll) {
      diagnostics.push({
        code: "SCROLL_RESTORE_MISMATCH",
        severity: "warning",
        message: "The scroll container did not return to its original position.",
        details: { actual: container.scrollTop, expected: originalScrollTop },
      });
    }
  }

  const ordered = [...revisions.values()].toSorted(
    (left, right) => left.order - right.order || left.key.localeCompare(right.key),
  );
  return {
    revisions: ordered,
    messages: ordered.map((entry) => entry.message),
    stableKeys: ordered.map((entry) => entry.key),
    reachedStart,
    reachedEnd,
    complete: reachedStart && reachedEnd,
    steps,
    originalScrollTop,
    restoredScroll,
    diagnostics,
  };
}

function ingest(
  candidates: readonly VirtualMessageRevision[],
  revisions: Map<string, VirtualMessageRevision>,
): boolean {
  let changed = false;
  for (const candidate of candidates) {
    const key = candidate.key.trim();
    if (!key) {
      throw new VirtualDomCollectionError(
        "INVALID_MESSAGE_KEY",
        "Virtual DOM messages require a non-empty stable key.",
      );
    }
    if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0) {
      throw new VirtualDomCollectionError(
        "INVALID_REVISION",
        `Message ${key} has an invalid revision.`,
      );
    }
    if (!Number.isFinite(candidate.order)) {
      throw new VirtualDomCollectionError("INVALID_ORDER", `Message ${key} has an invalid order.`);
    }
    const current = revisions.get(key);
    if (!current || candidate.revision > current.revision) {
      revisions.set(key, { ...candidate, key });
      changed = true;
    }
  }
  return changed;
}

async function waitForRender(adapter: VirtualDomCollectorAdapter): Promise<void> {
  if (adapter.waitForRender) {
    await adapter.waitForRender();
    return;
  }
  const view = adapter.container.ownerDocument.defaultView;
  await new Promise<void>((resolve) => view?.setTimeout(resolve, 0) ?? resolve());
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Virtual DOM collection was aborted.", "AbortError");
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
