import { browser } from "wxt/browser";
import {
  providerCommandSchema,
  type ProviderCommand,
  type ProviderRunResult,
} from "../core/messaging/protocol";
import type { ProviderId } from "../core/providers/contracts";

export function connectProviderPort(
  panelId: string,
  providerId: ProviderId,
  handleCommand: (command: ProviderCommand) => Promise<ProviderRunResult>,
): void {
  let stopped = false;
  let reconnectTimer: number | undefined;

  const connect = () => {
    if (stopped) return;
    const port = browser.runtime.connect({
      name: `MAW_PROVIDER:${encodeURIComponent(panelId)}:${encodeURIComponent(providerId)}`,
    });
    port.onMessage.addListener((raw) => {
      const command = providerCommandSchema.safeParse(raw);
      if (!command.success || command.data.panelId !== panelId) return;
      void handleCommand(command.data).then((result) => {
        try {
          port.postMessage(result);
        } catch {
          // The disconnect handler reconnects. The workspace reports this run as unavailable.
        }
      });
    });
    port.onDisconnect.addListener(() => {
      if (!stopped) reconnectTimer = window.setTimeout(connect, 250);
    });
  };

  connect();
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    },
    { once: true },
  );
}
