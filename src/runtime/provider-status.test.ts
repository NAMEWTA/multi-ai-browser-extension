import { describe, expect, it, vi } from "vitest";
import type { ProviderStrategy } from "../core/providers/contracts";
import { watchProviderStatus } from "./provider-status";

const runtime = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("wxt/browser", () => ({
  browser: { runtime: { sendMessage: runtime.sendMessage } },
}));

describe("watchProviderStatus", () => {
  it("rechecks after a composer appears while the previous status report is in flight", async () => {
    document.body.replaceChildren();
    runtime.sendMessage.mockReset();
    runtime.sendMessage.mockImplementation(async (message: { status?: string }) => {
      if (message.status === "loading" && !document.querySelector("textarea")) {
        document.body.append(document.createElement("textarea"));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      return { ok: true };
    });
    const strategy = {
      probe: vi.fn(async () => ({
        status: document.querySelector("textarea") ? "ready" : "loading",
      })),
    } as unknown as ProviderStrategy;

    watchProviderStatus(strategy, { document, window }, "panel-qwen", "qwen");

    await vi.waitFor(() => {
      expect(runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FRAME_STATUS", status: "ready" }),
      );
    });
    window.dispatchEvent(new Event("pagehide"));
  });

  it("debounces a burst of page mutations into one additional probe", async () => {
    document.body.replaceChildren();
    runtime.sendMessage.mockReset();
    runtime.sendMessage.mockResolvedValue({ ok: true });
    const strategy = {
      probe: vi.fn(async () => ({ status: "loading" })),
    } as unknown as ProviderStrategy;

    watchProviderStatus(strategy, { document, window }, "panel-qwen", "qwen");
    await vi.waitFor(() => expect(strategy.probe).toHaveBeenCalledOnce());

    for (let index = 0; index < 20; index += 1) {
      const item = document.createElement("div");
      item.className = `item-${index}`;
      document.body.append(item);
    }

    await vi.waitFor(() => expect(strategy.probe).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    expect(strategy.probe).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("pagehide"));
  });
});
