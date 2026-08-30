import { browser } from "wxt/browser";
import { FrameRegistry } from "../core/messaging/frame-registry";
import {
  frameHelloSchema,
  frameStatusSchema,
  openPanelTabSchema,
  openWorkspaceSchema,
  providerDiagnosticSchema,
  providerIdSchema,
  providerRunResultSchema,
  runtimeMessageSchema,
  workspaceReadySchema,
  workspaceSubmitSchema,
  workspaceSyncSchema,
  type ProviderCommand,
  type ProviderRunResult,
} from "../core/messaging/protocol";
import { enableIframeRules } from "../core/permissions/frame-policy-manager";
import { runtimeSnapshotSchema } from "../core/messaging/runtime-snapshot";

const RUNTIME_SNAPSHOT_KEY = "runtime-snapshot-v1";
const DIAGNOSTIC_PREFIX = "provider-diagnostics-v1:";
const MAX_DIAGNOSTICS_PER_PANEL = 80;

interface Target {
  panelId: string;
  providerId: string;
  url: string;
}

export default defineBackground(() => {
  const frames = new FrameRegistry();
  const fallbackTabs = new Map<number, { panelId: string; providerId: string }>();
  const providerPorts = new Map<string, ReturnType<typeof browser.runtime.connect>>();
  const pendingRuns = new Map<
    string,
    {
      panelId: string;
      resolve(result: ProviderRunResult): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const runtimeReady = restoreRuntimeSnapshot(frames, fallbackTabs);
  let persistQueue = Promise.resolve();
  let diagnosticQueue = Promise.resolve();

  function persistDiagnostic(
    message: ReturnType<typeof providerDiagnosticSchema.parse>,
    url: string,
  ): Promise<void> {
    const key = `${DIAGNOSTIC_PREFIX}${message.panelId}`;
    diagnosticQueue = diagnosticQueue
      .catch(() => undefined)
      .then(async () => {
        const stored = await browser.storage.session.get(key);
        const current = Array.isArray(stored[key]) ? stored[key] : [];
        const record = { ...message, at: new Date().toISOString(), url };
        await browser.storage.session.set({
          [key]: [...current, record].slice(-MAX_DIAGNOSTICS_PER_PANEL),
        });
      });
    return diagnosticQueue;
  }

  function persistRuntimeSnapshot(): Promise<void> {
    const snapshot = {
      frames: frames.all(),
      fallbackTabs: [...fallbackTabs].map(([tabId, binding]) => ({ tabId, ...binding })),
    };
    persistQueue = persistQueue
      .catch(() => undefined)
      .then(() => browser.storage.session.set({ [RUNTIME_SNAPSHOT_KEY]: snapshot }));
    return persistQueue;
  }

  async function dispatchMany(
    workspaceTabId: number | undefined,
    targets: readonly Target[],
    createCommand: (target: Target) => ProviderCommand,
  ): Promise<ProviderRunResult[]> {
    const settled = await Promise.allSettled(
      targets.map((target) => dispatchToPanel(workspaceTabId, target, createCommand(target))),
    );
    return settled.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const target = targets[index];
      const command = target ? createCommand(target) : undefined;
      return unavailableResult(
        target?.panelId ?? "unknown",
        command,
        result.reason instanceof Error ? result.reason.message : "网页面板通信失败",
      );
    });
  }

  async function dispatchToPanel(
    workspaceTabId: number | undefined,
    target: Target,
    command: ProviderCommand,
  ): Promise<ProviderRunResult> {
    const port = await waitForProviderPort(target.panelId);
    if (port) {
      try {
        return await sendThroughPort(port, command);
      } catch {
        if (providerPorts.get(target.panelId) === port) providerPorts.delete(target.panelId);
      }
    }

    const registered = frames.get(target.panelId);
    if (registered) {
      const result = await sendToFrame(registered.tabId, registered.frameId, command);
      if (result) return result;
      frames.removeFrame(registered.tabId, registered.frameId);
      await persistRuntimeSnapshot();
    }

    if (workspaceTabId !== undefined) {
      const expectedOrigin = new URL(target.url).origin;
      const discovered = (
        await browser.webNavigation.getAllFrames({ tabId: workspaceTabId })
      )?.find((candidate) => sameOrigin(candidate.url, expectedOrigin));
      if (discovered) {
        const result = await sendToFrame(workspaceTabId, discovered.frameId, command);
        if (result) return result;
      }
    }

    return unavailableResult(target.panelId, command, "网页面板尚未就绪");
  }

  async function sendToFrame(
    tabId: number,
    frameId: number,
    command: ProviderCommand,
  ): Promise<ProviderRunResult | undefined> {
    try {
      const response = await browser.tabs.sendMessage(tabId, command, { frameId });
      const parsed = providerRunResultSchema.safeParse(response);
      if (!parsed.success || parsed.data.panelId !== command.panelId) return undefined;
      return parsed.data;
    } catch {
      return undefined;
    }
  }

  function waitForProviderPort(
    panelId: string,
    timeoutMs = 1_500,
  ): Promise<ReturnType<typeof browser.runtime.connect> | undefined> {
    const existing = providerPorts.get(panelId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const port = providerPorts.get(panelId);
        if (port || Date.now() - startedAt >= timeoutMs) {
          resolve(port);
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  function sendThroughPort(
    port: ReturnType<typeof browser.runtime.connect>,
    command: ProviderCommand,
  ): Promise<ProviderRunResult> {
    return new Promise((resolve, reject) => {
      const key = runKey(command.panelId, requestId(command));
      const timeout = setTimeout(
        () => {
          pendingRuns.delete(key);
          reject(new Error("网页面板响应超时"));
        },
        command.type === "SYNC_PROMPT" ? 5_000 : 20_000,
      );
      pendingRuns.set(key, { panelId: command.panelId, resolve, reject, timeout });
      try {
        port.postMessage(command);
      } catch (error) {
        clearTimeout(timeout);
        pendingRuns.delete(key);
        reject(error instanceof Error ? error : new Error("网页面板已断开"));
      }
    });
  }

  browser.runtime.onConnect.addListener((port) => {
    const binding = parseProviderPortName(port.name);
    if (!binding) return;
    providerPorts.set(binding.panelId, port);
    port.onMessage.addListener((raw) => {
      const parsed = providerRunResultSchema.safeParse(raw);
      if (!parsed.success) return;
      const key = runKey(parsed.data.panelId, parsed.data.requestId);
      const pending = pendingRuns.get(key);
      if (!pending || pending.panelId !== binding.panelId) return;
      clearTimeout(pending.timeout);
      pendingRuns.delete(key);
      pending.resolve(parsed.data);
    });
    port.onDisconnect.addListener(() => {
      if (providerPorts.get(binding.panelId) === port) providerPorts.delete(binding.panelId);
      for (const [key, pending] of pendingRuns) {
        if (pending.panelId !== binding.panelId) continue;
        clearTimeout(pending.timeout);
        pendingRuns.delete(key);
        pending.reject(new Error("网页面板已断开"));
      }
    });
  });

  browser.action.onClicked.addListener(() => openWorkspace());
  browser.tabs.onRemoved.addListener((tabId) => {
    void runtimeReady.then(async () => {
      const fallback = fallbackTabs.get(tabId);
      frames.removeTab(tabId);
      fallbackTabs.delete(tabId);
      await persistRuntimeSnapshot();
      if (fallback) {
        await browser.runtime
          .sendMessage({
            type: "WORKSPACE_FRAME_STATUS",
            panelId: fallback.panelId,
            providerId: fallback.providerId,
            status: "loading",
            message: "正在恢复工作台内的官网面板",
          })
          .catch(() => undefined);
      }
    });
  });

  browser.runtime.onMessage.addListener(async (raw, sender) => {
    await runtimeReady;
    const parsed = runtimeMessageSchema.safeParse(raw);
    if (!parsed.success) return undefined;

    if (frameHelloSchema.safeParse(parsed.data).success) {
      const message = frameHelloSchema.parse(parsed.data);
      if (sender.tab?.id === undefined || sender.frameId === undefined) return { ok: false };
      const fallback = fallbackTabs.get(sender.tab.id);
      const panelId = message.panelId ?? fallback?.panelId;
      if (!panelId || (fallback && fallback.providerId !== message.providerId)) {
        return { ok: false };
      }
      const activeFallback = [...fallbackTabs].find(([, item]) => item.panelId === panelId);
      if (activeFallback && activeFallback[0] !== sender.tab.id) {
        return { ok: true, panelId, reconnected: false };
      }
      const current = frames.get(panelId);
      if (
        current?.tabId === sender.tab.id &&
        current.frameId === sender.frameId &&
        current.providerId === message.providerId
      ) {
        return { ok: true, panelId, reconnected: false };
      }
      frames.register({
        panelId,
        providerId: message.providerId,
        tabId: sender.tab.id,
        frameId: sender.frameId,
        url: sender.url ?? message.url,
        lastSeenAt: Date.now(),
      });
      await persistRuntimeSnapshot();
      await browser.runtime
        .sendMessage({
          type: "WORKSPACE_FRAME_STATUS",
          panelId,
          providerId: message.providerId,
          status: "loading",
        })
        .catch(() => undefined);
      return { ok: true, panelId, reconnected: true };
    }

    if (frameStatusSchema.safeParse(parsed.data).success) {
      const message = frameStatusSchema.parse(parsed.data);
      const frame = frames.get(message.panelId);
      if (
        !frame ||
        sender.tab?.id !== frame.tabId ||
        sender.frameId !== frame.frameId ||
        message.providerId !== frame.providerId
      ) {
        return { ok: false };
      }
      await browser.runtime
        .sendMessage({ ...message, type: "WORKSPACE_FRAME_STATUS" })
        .catch(() => undefined);
      return { ok: true };
    }

    if (providerDiagnosticSchema.safeParse(parsed.data).success) {
      const message = providerDiagnosticSchema.parse(parsed.data);
      const frame = frames.get(message.panelId);
      if (
        !frame ||
        sender.tab?.id !== frame.tabId ||
        sender.frameId !== frame.frameId ||
        message.providerId !== frame.providerId
      ) {
        return { ok: false };
      }
      await persistDiagnostic(message, sender.url ?? frame.url);
      return { ok: true };
    }

    if (workspaceSyncSchema.safeParse(parsed.data).success) {
      const command = workspaceSyncSchema.parse(parsed.data);
      return await dispatchMany(sender.tab?.id, command.targets, (target) => ({
        type: "SYNC_PROMPT",
        panelId: target.panelId,
        revision: command.revision,
        prompt: command.prompt,
      }));
    }

    if (workspaceSubmitSchema.safeParse(parsed.data).success) {
      const command = workspaceSubmitSchema.parse(parsed.data);
      return await dispatchMany(sender.tab?.id, command.targets, (target) => ({
        type: "SUBMIT_PROMPT",
        panelId: target.panelId,
        taskId: command.taskId,
        prompt: command.prompt,
      }));
    }

    if (workspaceReadySchema.safeParse(parsed.data).success) {
      if (sender.tab?.id === undefined) return { ok: false };
      await enableIframeRules(sender.tab.id);
      return { ok: true };
    }

    if (openWorkspaceSchema.safeParse(parsed.data).success) {
      await openWorkspace();
      return { ok: true };
    }

    if (openPanelTabSchema.safeParse(parsed.data).success) {
      const message = openPanelTabSchema.parse(parsed.data);
      const existing = [...fallbackTabs].find(([, item]) => item.panelId === message.panelId);
      if (existing) {
        const [tabId] = existing;
        await browser.tabs.update(tabId, { active: true, url: message.url });
        const tab = await browser.tabs.get(tabId);
        if (tab.windowId !== undefined)
          await browser.windows.update(tab.windowId, { focused: true });
        return { ok: true, tabId };
      }
      const tab = await browser.tabs.create({ url: "about:blank", active: true });
      if (tab.id === undefined) return { ok: false };
      fallbackTabs.set(tab.id, { panelId: message.panelId, providerId: message.providerId });
      await persistRuntimeSnapshot();
      await browser.tabs.update(tab.id, { url: message.url });
      return { ok: true, tabId: tab.id };
    }

    return undefined;
  });
});

async function restoreRuntimeSnapshot(
  frames: FrameRegistry,
  fallbackTabs: Map<number, { panelId: string; providerId: string }>,
): Promise<void> {
  const result = await browser.storage.session.get(RUNTIME_SNAPSHOT_KEY);
  const parsed = runtimeSnapshotSchema.safeParse(result[RUNTIME_SNAPSHOT_KEY]);
  if (!parsed.success) return;
  for (const frame of parsed.data.frames) frames.register(frame);
  for (const binding of parsed.data.fallbackTabs) {
    fallbackTabs.set(binding.tabId, {
      panelId: binding.panelId,
      providerId: binding.providerId,
    });
  }
}

async function openWorkspace(): Promise<void> {
  const url = browser.runtime.getURL("/workspace.html");
  const existing = await browser.tabs.query({ url: `${url}*` });
  const tab = existing[0];
  if (tab?.id !== undefined) {
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    await enableIframeRules(tab.id);
    return;
  }
  const created = await browser.tabs.create({ url, active: true });
  if (created.id !== undefined) await enableIframeRules(created.id);
}

function requestId(command: ProviderCommand): string {
  return command.type === "SYNC_PROMPT" ? `sync:${command.revision}` : command.taskId;
}

function unavailableResult(
  panelId: string,
  command: ProviderCommand | undefined,
  message: string,
): ProviderRunResult {
  return {
    requestId: command ? requestId(command) : crypto.randomUUID(),
    panelId,
    operation: command?.type === "SYNC_PROMPT" ? "sync" : "submit",
    status: "unavailable",
    message,
  };
}

function sameOrigin(url: string, expectedOrigin: string): boolean {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function runKey(panelId: string, request: string): string {
  return `${panelId}:${request}`;
}

function parseProviderPortName(name: string): { panelId: string; providerId: string } | undefined {
  const match = /^MAW_PROVIDER:([^:]+):([^:]+)$/.exec(name);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    const panelId = decodeURIComponent(match[1]);
    const providerId = decodeURIComponent(match[2]);
    if (!providerIdSchema.safeParse(providerId).success) return undefined;
    return { panelId, providerId };
  } catch {
    return undefined;
  }
}
