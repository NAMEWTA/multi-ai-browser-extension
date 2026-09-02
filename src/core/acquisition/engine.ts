import type {
  AcquisitionAttempt,
  AcquisitionContext,
  AcquisitionDiagnostic,
  AcquisitionSelection,
  AcquisitionStrategy,
  ConversationSnapshot,
  ProviderAcquisitionAdapter,
} from "./contracts";
import { evaluateAcquisitionQuality } from "./quality-gate";

export class AcquisitionSelectionError extends Error {
  override readonly name = "AcquisitionSelectionError";

  constructor(readonly attempts: readonly AcquisitionAttempt[]) {
    super("No acquisition strategy produced an acceptable conversation snapshot.");
  }
}

export async function acquireConversation(
  adapter: ProviderAcquisitionAdapter,
  context: AcquisitionContext,
): Promise<AcquisitionSelection> {
  validateAdapter(adapter, context);
  const attempts: AcquisitionAttempt[] = [];

  for (const strategy of adapter.strategiesByPriority) {
    throwIfAborted(context.signal);
    let snapshot: ConversationSnapshot | undefined;
    try {
      snapshot = await strategy.acquire(context);
    } catch (caught) {
      throwIfAborted(context.signal);
      attempts.push({
        strategyId: strategy.id,
        source: strategy.source,
        status: "error",
        diagnostics: [strategyError(caught)],
      });
      continue;
    }

    if (!snapshot) {
      attempts.push({
        strategyId: strategy.id,
        source: strategy.source,
        status: "unavailable",
        diagnostics: [],
      });
      continue;
    }

    const contractDiagnostics = validateCandidateContract(adapter, strategy, snapshot);
    const quality = evaluateAcquisitionQuality(snapshot, adapter.qualityPolicy);
    const diagnostics = [...contractDiagnostics, ...quality.diagnostics];
    if (diagnostics.some((entry) => entry.severity === "error")) {
      attempts.push({
        strategyId: strategy.id,
        source: strategy.source,
        status: "rejected",
        diagnostics,
      });
      continue;
    }

    attempts.push({
      strategyId: strategy.id,
      source: strategy.source,
      status: "selected",
      diagnostics,
    });
    return { snapshot, selectedStrategyId: strategy.id, attempts };
  }

  throw new AcquisitionSelectionError(attempts);
}

function validateAdapter(adapter: ProviderAcquisitionAdapter, context: AcquisitionContext): void {
  if (adapter.providerId !== context.providerId) {
    throw new TypeError(
      `Acquisition adapter ${adapter.providerId} cannot run in ${context.providerId} context.`,
    );
  }
  const ids = new Set<string>();
  for (const strategy of adapter.strategiesByPriority) {
    if (!strategy.id.trim()) throw new TypeError("Acquisition strategy IDs must not be empty.");
    if (ids.has(strategy.id)) {
      throw new TypeError(`Duplicate acquisition strategy ID: ${strategy.id}`);
    }
    ids.add(strategy.id);
  }
}

function validateCandidateContract(
  adapter: ProviderAcquisitionAdapter,
  strategy: AcquisitionStrategy,
  snapshot: ConversationSnapshot,
): AcquisitionDiagnostic[] {
  const diagnostics: AcquisitionDiagnostic[] = [];
  if (snapshot.providerId !== adapter.providerId) {
    diagnostics.push({
      code: "PROVIDER_MISMATCH",
      severity: "error",
      message: `Strategy ${strategy.id} returned ${snapshot.providerId} for ${adapter.providerId}.`,
    });
  }
  if (snapshot.source !== strategy.source) {
    diagnostics.push({
      code: "SOURCE_MISMATCH",
      severity: "error",
      message: `Strategy ${strategy.id} declared ${strategy.source} but returned ${snapshot.source}.`,
    });
  }
  if (snapshot.diagnostics.strategyId !== strategy.id) {
    diagnostics.push({
      code: "STRATEGY_MISMATCH",
      severity: "error",
      message: `Snapshot diagnostics belong to ${snapshot.diagnostics.strategyId}, not ${strategy.id}.`,
    });
  }
  return diagnostics;
}

function strategyError(caught: unknown): AcquisitionDiagnostic {
  return {
    code: "STRATEGY_ERROR",
    severity: "error",
    message: caught instanceof Error ? caught.message : String(caught),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Acquisition was aborted.", "AbortError");
}
