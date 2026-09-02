import { describe, expect, it } from "vitest";
import type { Message } from "./contracts";
import {
  collectVirtualDomMessages,
  type VirtualDomCollectorAdapter,
  type VirtualMessageRevision,
} from "./virtual-dom-collector";

describe("collectVirtualDomMessages", () => {
  it("collects a virtualized thread, replaces newer revisions, and restores scroll", async () => {
    const container = scrollContainer({ initial: 150, height: 100, contentHeight: 300 });
    const adapter: VirtualDomCollectorAdapter = {
      container,
      readVisibleMessages: () => visibleWindow(container.scrollTop),
      waitForRender: async () => undefined,
    };

    const result = await collectVirtualDomMessages(adapter, {
      minimumStepPx: 100,
      stepRatio: 1,
      stableBoundaryPasses: 2,
    });

    expect(result.complete).toBe(true);
    expect(result.reachedStart).toBe(true);
    expect(result.reachedEnd).toBe(true);
    expect(result.stableKeys).toEqual(["m1", "m2", "m3"]);
    expect(result.messages.map((item) => item.content[0]?.text)).toEqual([
      "first",
      "second",
      "third final",
    ]);
    expect(result.revisions.find((entry) => entry.key === "m3")?.revision).toBe(2);
    expect(result.originalScrollTop).toBe(150);
    expect(result.restoredScroll).toBe(true);
    expect(container.scrollTop).toBe(150);
  });

  it("uses a seed incrementally and does not replace it with an older revision", async () => {
    const container = scrollContainer({ initial: 25, height: 100, contentHeight: 200 });
    const adapter: VirtualDomCollectorAdapter = {
      container,
      readVisibleMessages: () => [revision("m1", 1, 0, "stale")],
      waitForRender: async () => undefined,
    };

    const result = await collectVirtualDomMessages(adapter, {
      seed: [revision("m1", 2, 0, "newer seed")],
      stableBoundaryPasses: 1,
    });

    expect(result.messages[0]?.content[0]?.text).toBe("newer seed");
    expect(result.revisions[0]?.revision).toBe(2);
    expect(container.scrollTop).toBe(25);
  });

  it("restores scroll even when a viewport entry has no stable key", async () => {
    const container = scrollContainer({ initial: 40, height: 100, contentHeight: 200 });
    const adapter: VirtualDomCollectorAdapter = {
      container,
      readVisibleMessages: () => [revision(" ", 1, 0, "invalid")],
      waitForRender: async () => undefined,
    };

    await expect(collectVirtualDomMessages(adapter)).rejects.toMatchObject({
      code: "INVALID_MESSAGE_KEY",
    });
    expect(container.scrollTop).toBe(40);
  });
});

function visibleWindow(scrollTop: number): readonly VirtualMessageRevision[] {
  if (scrollTop <= 0) {
    return [revision("m1", 1, 0, "first"), revision("m2", 1, 1, "second")];
  }
  if (scrollTop < 200) {
    return [revision("m2", 1, 1, "second"), revision("m3", 1, 2, "third draft")];
  }
  return [revision("m3", 2, 2, "third final")];
}

function revision(key: string, value: number, order: number, text: string): VirtualMessageRevision {
  return { key, revision: value, order, message: message(key.trim() || "invalid", text) };
}

function message(id: string, text: string): Message {
  return { id, role: "assistant", content: [{ kind: "paragraph", text }] };
}

function scrollContainer(options: {
  initial: number;
  height: number;
  contentHeight: number;
}): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = options.initial;
  Object.defineProperties(container, {
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(options.contentHeight - options.height, value));
      },
    },
    clientHeight: { configurable: true, get: () => options.height },
    scrollHeight: { configurable: true, get: () => options.contentHeight },
  });
  return container;
}
