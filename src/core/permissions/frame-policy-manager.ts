import { browser } from "wxt/browser";
import { builtInProviderMatches } from "../providers/built-in-sites";

const DOMAINS = builtInProviderMatches.map((pattern) => new URL(pattern).hostname);
const RULE_IDS = DOMAINS.map((_, index) => 101 + index);

export async function enableIframeRules(workspaceTabId: number): Promise<void> {
  const rules = DOMAINS.map((domain, index) => ({
    id: RULE_IDS[index] ?? 1000 + index,
    priority: 1,
    action: {
      type: "modifyHeaders" as const,
      responseHeaders: [
        { header: "x-frame-options", operation: "remove" as const },
        { header: "content-security-policy", operation: "remove" as const },
      ],
    },
    condition: {
      urlFilter: `||${domain}/`,
      resourceTypes: ["sub_frame" as const],
      tabIds: [workspaceTabId],
    },
  }));

  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [...RULE_IDS],
    addRules: rules,
  });
}

export async function disableIframeRules(): Promise<void> {
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [...RULE_IDS] });
}
