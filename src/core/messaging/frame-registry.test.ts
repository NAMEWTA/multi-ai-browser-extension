import { describe, expect, it } from "vitest";
import { FrameRegistry } from "./frame-registry";

describe("FrameRegistry", () => {
  it("replaces a panel frame after navigation", () => {
    const registry = new FrameRegistry();
    registry.register({
      panelId: "panel-1",
      providerId: "deepseek",
      tabId: 7,
      frameId: 2,
      url: "https://chat.deepseek.com/",
      lastSeenAt: 1,
    });
    registry.register({
      panelId: "panel-1",
      providerId: "deepseek",
      tabId: 7,
      frameId: 4,
      url: "https://chat.deepseek.com/a/chat/s/1",
      lastSeenAt: 2,
    });
    expect(registry.get("panel-1")?.frameId).toBe(4);
    expect(registry.all()).toHaveLength(1);
  });

  it("removes only frames owned by a closed tab", () => {
    const registry = new FrameRegistry();
    registry.register({
      panelId: "a",
      providerId: "kimi",
      tabId: 1,
      frameId: 1,
      url: "https://www.kimi.com/",
      lastSeenAt: 1,
    });
    registry.register({
      panelId: "b",
      providerId: "chatgpt",
      tabId: 2,
      frameId: 1,
      url: "https://chatgpt.com/",
      lastSeenAt: 1,
    });
    registry.removeTab(1);
    expect(registry.get("a")).toBeUndefined();
    expect(registry.get("b")).toBeDefined();
    registry.removeFrame(2, 1);
    expect(registry.get("b")).toBeUndefined();
  });
});
