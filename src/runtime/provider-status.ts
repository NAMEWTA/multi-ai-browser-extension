import { browser } from "wxt/browser";
import type { FrameContext, ProviderId, ProviderStrategy } from "../core/providers/contracts";

interface FrameHeartbeatOptions {
  readonly panelId: string;
  readonly providerId: ProviderId;
  readonly strategy?: ProviderStrategy;
  readonly ctx?: FrameContext;
  readonly displayOnly?: boolean;
  readonly intervalMs?: number;
}

export function watchProviderStatus(
  strategy: ProviderStrategy,
  ctx: FrameContext,
  panelId: string,
  providerId: ProviderId,
): void {
  let checking = false;
  let checkPending = false;
  let lastStatus = "";
  let stopped = false;
  let debounceTimer: number | undefined;

  const scheduleCheck = (delayMs = 200) => {
    if (stopped) return;
    checkPending = true;
    if (debounceTimer !== undefined) return;
    debounceTimer = ctx.window.setTimeout(() => {
      debounceTimer = undefined;
      void check();
    }, delayMs);
  };

  const check = async () => {
    if (stopped) return;
    if (checking) {
      checkPending = true;
      return;
    }
    checking = true;
    checkPending = false;
    try {
      const probe = await strategy.probe(ctx);
      if (probe.status !== lastStatus) {
        lastStatus = probe.status;
        await browser.runtime
          .sendMessage({
            type: "FRAME_STATUS",
            panelId,
            providerId,
            status: probe.status,
            ...(probe.detail ? { message: probe.detail } : {}),
          })
          .catch(() => undefined);
      }
    } finally {
      checking = false;
      if (checkPending) scheduleCheck();
    }
  };

  void check();
  const observer = new MutationObserver(() => {
    scheduleCheck();
  });
  observer.observe(ctx.document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "disabled", "aria-disabled", "style"],
  });
  const interval = ctx.window.setInterval(() => scheduleCheck(0), 2_000);
  ctx.window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      observer.disconnect();
      ctx.window.clearInterval(interval);
      if (debounceTimer !== undefined) ctx.window.clearTimeout(debounceTimer);
    },
    { once: true },
  );
}

export async function reportProviderReady(panelId: string, providerId: ProviderId): Promise<void> {
  await browser.runtime
    .sendMessage({
      type: "FRAME_STATUS",
      panelId,
      providerId,
      status: "ready",
    })
    .catch(() => undefined);
}

export function startFrameHeartbeat(options: FrameHeartbeatOptions): void {
  const send = async () => {
    const response = (await browser.runtime
      .sendMessage({
        type: "FRAME_HELLO",
        panelId: options.panelId,
        providerId: options.providerId,
        url: location.href,
      })
      .catch(() => undefined)) as { ok?: boolean; reconnected?: boolean } | undefined;
    if (!response?.ok || !response.reconnected) return;
    if (options.displayOnly) {
      await reportProviderReady(options.panelId, options.providerId);
      return;
    }
    if (!options.strategy || !options.ctx) return;
    const probe = await options.strategy.probe(options.ctx);
    await browser.runtime
      .sendMessage({
        type: "FRAME_STATUS",
        panelId: options.panelId,
        providerId: options.providerId,
        status: probe.status,
        ...(probe.detail ? { message: probe.detail } : {}),
      })
      .catch(() => undefined);
  };

  const interval = window.setInterval(() => void send(), options.intervalMs ?? 5_000);
  window.addEventListener("pagehide", () => window.clearInterval(interval), { once: true });
}

export function watchProviderUrl(panelId: string, providerId: ProviderId, ctx: FrameContext): void {
  let lastUrl = "";
  let stopped = false;

  const report = () => {
    if (stopped) return;
    const url = ctx.window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    void browser.runtime
      .sendMessage({ type: "PROVIDER_URL_UPDATE", panelId, providerId, url })
      .catch(() => undefined);
  };

  report();
  ctx.window.addEventListener("popstate", report);
  ctx.window.addEventListener("hashchange", report);
  const interval = ctx.window.setInterval(report, 500);
  ctx.window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      ctx.window.clearInterval(interval);
      ctx.window.removeEventListener("popstate", report);
      ctx.window.removeEventListener("hashchange", report);
    },
    { once: true },
  );
}
