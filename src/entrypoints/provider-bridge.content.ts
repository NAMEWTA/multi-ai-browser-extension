import { browser } from "wxt/browser";
import {
  providerCommandSchema,
  type ProviderCommand,
  type ProviderRunResult,
} from "../core/messaging/protocol";
import { normalizeProviderError } from "../core/providers/errors";
import { providerRegistry } from "../core/providers/registry";
import { TaskLedger } from "../core/orchestration/task-ledger";
import { builtInProviderMatches } from "../core/providers/built-in-sites";
import { startFrameHeartbeat, watchProviderStatus } from "../runtime/provider-status";
import { connectProviderPort } from "../runtime/provider-port";

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
    let latestRequestedRevision = -1;
    let commandQueue = Promise.resolve();

    const hello = (await browser.runtime.sendMessage({
      type: "FRAME_HELLO",
      ...(panelId ? { panelId } : {}),
      providerId: plugin.definition.id,
      url: location.href,
    })) as { ok: boolean; panelId?: string } | undefined;
    panelId = panelId ?? hello?.panelId;
    if (!panelId || !hello?.ok) return;

    const ctx = { document, window, timeoutMs: 15_000 };
    const handleCommand = async (command: ProviderCommand): Promise<ProviderRunResult> => {
      const operation = command.type === "SYNC_PROMPT" ? "sync" : "submit";
      const requestId =
        command.type === "SYNC_PROMPT" ? `sync:${command.revision}` : command.taskId;

      if (command.type === "SYNC_PROMPT" && command.revision < latestRequestedRevision) {
        return {
          requestId,
          panelId: command.panelId,
          providerId: plugin.definition.id,
          operation,
          status: "duplicate",
        };
      }

      if (command.type === "SUBMIT_PROMPT") {
        const existing = tasks.get(command.taskId);
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
        tasks.start(command.taskId);
      }

      try {
        await strategy.waitUntilReady(ctx);
        if (command.type === "SYNC_PROMPT" && command.revision < latestRequestedRevision) {
          return {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "duplicate",
          };
        }
        await strategy.writePrompt(ctx, { text: command.prompt });
        if (command.type === "SYNC_PROMPT") {
          return {
            requestId,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation,
            status: "synced",
          };
        }

        await strategy.submit(ctx);
        const result: ProviderRunResult = {
          requestId,
          panelId: command.panelId,
          providerId: plugin.definition.id,
          operation,
          status: "submitted",
        };
        tasks.succeed(command.taskId, result);
        return result;
      } catch (error) {
        const normalized = normalizeProviderError(error);
        const result: ProviderRunResult = {
          requestId,
          panelId: command.panelId,
          providerId: plugin.definition.id,
          operation,
          status: "failed",
          errorCode: normalized.code,
          message: normalized.message,
        };
        if (command.type === "SUBMIT_PROMPT") tasks.fail(command.taskId, normalized.message);
        return result;
      }
    };

    const enqueueCommand = (command: ProviderCommand): Promise<ProviderRunResult> => {
      if (command.type === "SYNC_PROMPT") {
        if (command.revision <= latestRequestedRevision) {
          return Promise.resolve({
            requestId: `sync:${command.revision}`,
            panelId: command.panelId,
            providerId: plugin.definition.id,
            operation: "sync",
            status: "duplicate",
          });
        }
        latestRequestedRevision = command.revision;
      }
      const run = commandQueue.catch(() => undefined).then(() => handleCommand(command));
      commandQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };

    connectProviderPort(panelId, plugin.definition.id, enqueueCommand);
    watchProviderStatus(strategy, ctx, panelId, plugin.definition.id);
    startFrameHeartbeat({ panelId, providerId: plugin.definition.id, strategy, ctx });

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
