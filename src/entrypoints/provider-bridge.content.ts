import { browser } from "wxt/browser";
import {
  providerCommandSchema,
  type CommitPromptMessage,
  type ProviderCommand,
  type ProviderRunResult,
} from "../core/messaging/protocol";
import type {
  ComposerCandidateDiagnostic,
  FrameContext,
  ProviderStrategy,
  ResponseBaseline,
  ResponseCaptureUpdate,
} from "../core/providers/contracts";
import { normalizeProviderError, ProviderError } from "../core/providers/errors";
import { providerRegistry } from "../core/providers/registry";
import { TaskLedger } from "../core/orchestration/task-ledger";
import { builtInProviderMatches } from "../core/providers/built-in-sites";
import {
  startFrameHeartbeat,
  watchProviderStatus,
  watchProviderUrl,
} from "../runtime/provider-status";
import { connectProviderPort } from "../runtime/provider-port";
import { appendProviderDiagnostic, describeProviderElement } from "../runtime/provider-diagnostics";
import { createNativeCopyClient } from "../runtime/native-copy-client";

interface PreparedTurn {
  sessionId: string;
  prompt: string;
  baseline: ResponseBaseline;
  phase: "prechecked" | "staged";
}

interface ActiveCapture {
  turnId: string;
  controller: AbortController;
  completion: Promise<void>;
  finalize: () => Promise<ResponseCaptureUpdate | undefined>;
}

export default defineContentScript({
  matches: [...builtInProviderMatches],
  allFrames: true,
  runAt: "document_idle",
  async main() {
    const plugin = providerRegistry.match(location.href);
    if (!plugin) return;
    let panelId = readPanelId(window.name);
    const strategy = plugin.createStrategy();
    const tasks = new TaskLedger<ProviderRunResult>();
    const preparedTurns = new Map<string, PreparedTurn>();
    let commandQueue = Promise.resolve();
    let activeCapture: ActiveCapture | undefined;

    const hello = (await browser.runtime.sendMessage({
      type: "FRAME_HELLO",
      ...(panelId ? { panelId } : {}),
      providerId: plugin.definition.id,
      url: location.href,
    })) as { ok: boolean; panelId?: string } | undefined;
    panelId = panelId ?? hello?.panelId;
    if (!panelId || !hello?.ok) return;

    void appendProviderDiagnostic(panelId, plugin.definition.id, { stage: "frame-ready" }).catch(
      () => undefined,
    );

    const ctx = {
      document,
      window,
      nativeCopy: createNativeCopyClient(window),
      timeoutMs: 15_000,
      responseTimeoutMs: 180_000,
    };

    const reportResponse = async (
      command: CommitPromptMessage,
      update: ResponseCaptureUpdate,
      captureId: string,
      revision: number,
    ): Promise<void> => {
      await browser.runtime
        .sendMessage({
          type: "PROVIDER_RESPONSE_UPDATE",
          panelId,
          providerId: plugin.definition.id,
          sessionId: command.sessionId,
          turnId: command.turnId,
          captureId,
          revision,
          observedAt: new Date().toISOString(),
          status: update.status,
          ...(update.text !== undefined ? { text: update.text } : {}),
          ...(update.markdown !== undefined ? { markdown: update.markdown } : {}),
          ...(update.message ? { message: update.message } : {}),
          ...(update.terminalReason ? { terminalReason: update.terminalReason } : {}),
          ...(update.captureSource ? { captureSource: update.captureSource } : {}),
          ...(update.nativeMimeType ? { nativeMimeType: update.nativeMimeType } : {}),
        })
        .catch(() => undefined);
      void appendProviderDiagnostic(panelId, plugin.definition.id, {
        stage: "response-update",
        operation: "response",
        responseRevision: revision,
        responseStatus: update.status,
        responseLength: update.text?.length ?? update.markdown?.length ?? 0,
        ...(update.terminalReason ? { terminalReason: update.terminalReason } : {}),
      }).catch(() => undefined);
    };

    const captureResponse = async (
      command: CommitPromptMessage,
      baseline: ResponseBaseline,
      signal: AbortSignal,
    ): Promise<void> => {
      const captureId = crypto.randomUUID();
      let revision = 0;
      const report = (update: ResponseCaptureUpdate) =>
        reportResponse(command, update, captureId, ++revision);
      try {
        await report({ status: "waiting" });
        const final = await strategy.captureResponse(
          { ...ctx, signal },
          baseline,
          (update) => report(update),
          { text: command.prompt },
        );
        await report(final);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        await report({
          status: "failed",
          terminalReason: "failed",
          message: normalized.message,
        });
      }
    };

    const stopActiveCapture = async (): Promise<void> => {
      const current = activeCapture;
      if (!current) return;
      const rescued = await current.finalize().catch(() => undefined);
      current.controller.abort(rescued);
      await current.completion.catch(() => undefined);
      if (activeCapture === current) activeCapture = undefined;
    };

    const startCapture = (command: CommitPromptMessage, baseline: ResponseBaseline): void => {
      const controller = new AbortController();
      const capture: ActiveCapture = {
        turnId: command.turnId,
        controller,
        completion: Promise.resolve(),
        finalize: () =>
          strategy.finalizeResponse?.(ctx, baseline, { text: command.prompt }) ??
          Promise.resolve(undefined),
      };
      capture.completion = captureResponse(command, baseline, controller.signal).finally(() => {
        if (activeCapture === capture) activeCapture = undefined;
      });
      activeCapture = capture;
      void capture.completion;
    };

    const handleCommand = async (command: ProviderCommand): Promise<ProviderRunResult> => {
      const operation = commandOperation(command);
      const requestId =
        command.type === "START_NEW_CONVERSATION" ? command.sessionId : command.turnId;
      const promptLength =
        command.type === "START_NEW_CONVERSATION" ? undefined : command.prompt.length;
      const startedAt = performance.now();
      const composerCandidates = safeComposerCandidateDiagnostics(strategy, ctx);
      const composerDescription =
        composerCandidates?.find((candidate) => candidate.selected)?.descriptor ??
        describeProviderElement(
          document.querySelector(
            "[data-lexical-editor='true'], textarea, [contenteditable='true']",
          ),
        );
      void appendProviderDiagnostic(panelId, plugin.definition.id, {
        stage: "command-start",
        operation,
        ...(promptLength !== undefined ? { promptLength } : {}),
        ...(composerDescription ? { composer: composerDescription } : {}),
        ...(composerCandidates?.length ? { composerCandidates } : {}),
      }).catch(() => undefined);

      try {
        if (command.type === "PRECHECK_PROMPT") {
          const existing = preparedTurns.get(command.turnId);
          if (existing) {
            if (existing.sessionId !== command.sessionId || existing.prompt !== command.prompt) {
              throw new ProviderError("PROMPT_MISMATCH", "同一发送任务的内容发生变化");
            }
            return {
              requestId,
              panelId: command.panelId,
              providerId: plugin.definition.id,
              operation,
              status: "duplicate",
            };
          }
          const baseline = await strategy.prepareSubmit(ctx);
          await stopActiveCapture();
          preparedTurns.set(command.turnId, {
            sessionId: command.sessionId,
            prompt: command.prompt,
            baseline,
            phase: "prechecked",
          });
          void appendProviderDiagnostic(panelId, plugin.definition.id, {
            stage: "precheck-confirmed",
            operation: "precheck",
            promptLength: command.prompt.length,
            durationMs: Math.round(performance.now() - startedAt),
          }).catch(() => undefined);
          return {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "prechecked",
          };
        }

        if (command.type === "STAGE_PROMPT") {
          const prepared = preparedTurns.get(command.turnId);
          if (
            !prepared ||
            prepared.sessionId !== command.sessionId ||
            prepared.prompt !== command.prompt
          ) {
            throw new ProviderError("COMPOSER_NOT_READY", "发送任务尚未通过只读预检，请重新发送");
          }
          if (prepared.phase === "staged") {
            return {
              requestId,
              panelId: command.panelId,
              providerId: plugin.definition.id,
              operation,
              status: "duplicate",
            };
          }
          try {
            await strategy.stagePrompt(ctx, { text: command.prompt });
          } catch (error) {
            await strategy.rollbackPrompt(ctx, { text: command.prompt }).catch(() => undefined);
            preparedTurns.delete(command.turnId);
            throw error;
          }
          prepared.phase = "staged";
          const submitDescription = describeProviderElement(
            document.querySelector(
              "div[role='button'].ds-button--primary.ds-button--circle:not(.ds-button--disabled), .send-button-container:not(.disabled), button[type='submit']:not(:disabled), button[aria-label*='Send']:not(:disabled), button[aria-label*='发送']:not(:disabled)",
            ),
          );
          void appendProviderDiagnostic(panelId, plugin.definition.id, {
            stage: "stage-confirmed",
            operation: "stage",
            promptLength: command.prompt.length,
            durationMs: Math.round(performance.now() - startedAt),
            ...(submitDescription ? { submit: submitDescription } : {}),
          }).catch(() => undefined);
          return {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "staged",
          };
        }

        if (command.type === "ROLLBACK_PROMPT") {
          const prepared = preparedTurns.get(command.turnId);
          if (!prepared) {
            return {
              requestId,
              panelId: command.panelId,
              providerId: plugin.definition.id,
              operation,
              status: "duplicate",
            };
          }
          if (prepared.sessionId !== command.sessionId || prepared.prompt !== command.prompt) {
            throw new ProviderError("PROMPT_MISMATCH", "回滚任务与已暂存内容不一致");
          }
          try {
            if (prepared.phase === "staged") {
              await strategy.rollbackPrompt(ctx, { text: command.prompt });
            }
          } finally {
            preparedTurns.delete(command.turnId);
          }
          void appendProviderDiagnostic(panelId, plugin.definition.id, {
            stage: "rollback-confirmed",
            operation: "rollback",
            promptLength: command.prompt.length,
            durationMs: Math.round(performance.now() - startedAt),
          }).catch(() => undefined);
          return {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "rolled-back",
          };
        }

        if (command.type === "START_NEW_CONVERSATION") {
          const taskKey = `new-session:${command.sessionId}`;
          const existing = tasks.get(taskKey);
          if (existing) {
            return (
              existing.value ?? {
                requestId,
                panelId: command.panelId,
                providerId: plugin.definition.id,
                operation,
                status: "duplicate",
              }
            );
          }
          tasks.start(taskKey);
          await stopActiveCapture();
          await strategy.startNewConversation(ctx);
          preparedTurns.clear();
          const result: ProviderRunResult = {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "submitted",
          };
          tasks.succeed(taskKey, result);
          void appendProviderDiagnostic(panelId, plugin.definition.id, {
            stage: "new-session-confirmed",
            operation,
            durationMs: Math.round(performance.now() - startedAt),
          }).catch(() => undefined);
          return result;
        }

        const existingTask = tasks.get(command.turnId);
        if (existingTask) {
          return (
            existingTask.value ?? {
              requestId,
              panelId: command.panelId,
              providerId: plugin.definition.id,
              operation,
              status: "duplicate",
            }
          );
        }
        const prepared = preparedTurns.get(command.turnId);
        if (
          !prepared ||
          prepared.sessionId !== command.sessionId ||
          prepared.prompt !== command.prompt ||
          prepared.phase !== "staged"
        ) {
          throw new ProviderError("COMPOSER_NOT_READY", "发送任务尚未完成全站暂存，请重新发送");
        }
        tasks.start(command.turnId);
        await strategy.submit(ctx);
        await browser.runtime
          .sendMessage({
            type: "PROVIDER_URL_UPDATE",
            panelId: command.panelId,
            providerId: plugin.definition.id,
            url: ctx.window.location.href,
          })
          .catch(() => undefined);
        preparedTurns.delete(command.turnId);
        void appendProviderDiagnostic(panelId, plugin.definition.id, {
          stage: "commit-confirmed",
          operation: "commit",
          promptLength: command.prompt.length,
          durationMs: Math.round(performance.now() - startedAt),
        }).catch(() => undefined);
        const result: ProviderRunResult = {
          requestId,
          panelId: command.panelId,
          providerId: plugin.definition.id,
          operation,
          status: "submitted",
        };
        tasks.succeed(command.turnId, result);
        startCapture(command, prepared.baseline);
        return result;
      } catch (error) {
        const normalized = normalizeProviderError(error);
        const failedComposerCandidates = safeComposerCandidateDiagnostics(strategy, ctx);
        void appendProviderDiagnostic(panelId, plugin.definition.id, {
          stage: "command-failed",
          operation,
          ...(promptLength !== undefined ? { promptLength } : {}),
          durationMs: Math.round(performance.now() - startedAt),
          errorCode: normalized.code,
          ...(failedComposerCandidates?.length
            ? { composerCandidates: failedComposerCandidates }
            : {}),
        }).catch(() => undefined);
        if (command.type === "COMMIT_PROMPT") {
          preparedTurns.delete(command.turnId);
          tasks.fail(command.turnId, normalized.message);
        }
        if (command.type === "START_NEW_CONVERSATION") {
          tasks.fail(`new-session:${command.sessionId}`, normalized.message);
        }
        return {
          requestId,
          panelId: command.panelId,
          providerId: plugin.definition.id,
          operation,
          status: "failed",
          errorCode: normalized.code,
          message: normalized.message,
        };
      }
    };

    const enqueueCommand = (command: ProviderCommand): Promise<ProviderRunResult> => {
      const run = commandQueue.catch(() => undefined).then(() => handleCommand(command));
      commandQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };

    connectProviderPort(panelId, plugin.definition.id, enqueueCommand);
    watchProviderStatus(strategy, ctx, panelId, plugin.definition.id);
    watchProviderUrl(panelId, plugin.definition.id, ctx);
    startFrameHeartbeat({ panelId, providerId: plugin.definition.id, strategy, ctx });
    window.addEventListener("pagehide", () => activeCapture?.controller.abort(), { once: true });

    browser.runtime.onMessage.addListener(async (raw) => {
      const parsed = providerCommandSchema.safeParse(raw);
      if (!parsed.success || parsed.data.panelId !== panelId) return undefined;
      return await enqueueCommand(parsed.data);
    });
  },
});

function readPanelId(name: string): string | undefined {
  if (!name.startsWith("maw:")) return undefined;
  const panelId = name.slice(4).trim();
  return panelId || undefined;
}

function commandOperation(command: ProviderCommand): ProviderRunResult["operation"] {
  return command.type === "PRECHECK_PROMPT"
    ? "precheck"
    : command.type === "STAGE_PROMPT"
      ? "stage"
      : command.type === "COMMIT_PROMPT"
        ? "commit"
        : command.type === "ROLLBACK_PROMPT"
          ? "rollback"
          : "new-session";
}

function safeComposerCandidateDiagnostics(
  strategy: ProviderStrategy,
  ctx: FrameContext,
): readonly ComposerCandidateDiagnostic[] | undefined {
  try {
    return strategy.diagnoseComposerCandidates?.(ctx).slice(0, 12);
  } catch {
    return undefined;
  }
}
