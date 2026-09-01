import { describe, expect, it } from "vitest";
import {
  isResponseTerminal,
  mergeResponseRevision,
  type RevisionedResponseUpdate,
} from "./response-revision";

const base: RevisionedResponseUpdate = {
  panelId: "panel-1",
  providerId: "deepseek",
  sessionId: "session-1",
  turnId: "turn-1",
  captureId: "capture-1",
  revision: 8,
  observedAt: "2026-09-01T08:00:08.000Z",
  status: "completed",
  terminalReason: "completed",
  text: "完整回答",
  markdown: "## 完整回答",
};

describe("response revision reducer", () => {
  it("does not let a late streaming revision overwrite a terminal snapshot", () => {
    const stale = { ...base, revision: 7, status: "streaming" as const, text: "# 你好" };
    expect(mergeResponseRevision(base, stale)).toBe(base);
  });

  it("does not accept another capture for the same turn and panel", () => {
    expect(
      mergeResponseRevision(base, {
        ...base,
        captureId: "stale-capture",
        revision: 99,
        text: "旧采集",
      }),
    ).toBe(base);
  });

  it("preserves the latest payload when a newer terminal envelope omits it", () => {
    const streaming = { ...base, revision: 2, status: "streaming" as const };
    const terminal = {
      ...base,
      revision: 3,
      text: undefined,
      markdown: undefined,
    };
    expect(mergeResponseRevision(streaming, terminal)).toMatchObject({
      revision: 3,
      status: "completed",
      text: "完整回答",
      markdown: "## 完整回答",
    });
    expect(isResponseTerminal("completed")).toBe(true);
    expect(isResponseTerminal("streaming")).toBe(false);
  });
});
