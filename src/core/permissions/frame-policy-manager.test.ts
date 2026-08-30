import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSessionRules = vi.hoisted(() => vi.fn());
vi.mock("wxt/browser", () => ({
  browser: { declarativeNetRequest: { updateSessionRules } },
}));

import { builtInProviderMatches } from "../providers/built-in-sites";
import { disableIframeRules, enableIframeRules } from "./frame-policy-manager";

describe("frame policy manager", () => {
  beforeEach(() => updateSessionRules.mockReset().mockResolvedValue(undefined));

  it("installs exact sub-frame rules for built-in providers", async () => {
    await enableIframeRules(42);
    const request = updateSessionRules.mock.calls[0]?.[0];
    expect(request.addRules).toHaveLength(builtInProviderMatches.length);
    expect(request.addRules[0]).toMatchObject({
      condition: { resourceTypes: ["sub_frame"], tabIds: [42] },
      action: { type: "modifyHeaders" },
    });
  });

  it("removes every built-in session rule", async () => {
    await disableIframeRules();
    expect(updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: builtInProviderMatches.map((_, index) => 101 + index),
    });
  });
});
