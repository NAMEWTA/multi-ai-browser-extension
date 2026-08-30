import { describe, expect, it } from "vitest";
import { runtimeSnapshotSchema } from "./runtime-snapshot";

describe("runtimeSnapshotSchema", () => {
  it("accepts persisted frame and fallback bindings", () => {
    expect(
      runtimeSnapshotSchema.safeParse({
        frames: [
          {
            panelId: "panel-1",
            providerId: "deepseek",
            tabId: 4,
            frameId: 2,
            url: "https://chat.deepseek.com/",
            lastSeenAt: 100,
          },
        ],
        fallbackTabs: [{ tabId: 8, panelId: "panel-1", providerId: "deepseek" }],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed or unknown provider bindings", () => {
    expect(
      runtimeSnapshotSchema.safeParse({
        frames: [],
        fallbackTabs: [{ tabId: -1, panelId: "", providerId: "unknown" }],
      }).success,
    ).toBe(false);
  });
});
