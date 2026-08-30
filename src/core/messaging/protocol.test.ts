import { describe, expect, it } from "vitest";
import {
  frameStatusSchema,
  precheckPromptSchema,
  providerCommandSchema,
  providerUrlUpdateSchema,
  providerDiagnosticSchema,
  runtimeMessageSchema,
  workspaceSubmitSchema,
} from "./protocol";

const target = {
  panelId: "panel-1",
  providerId: "deepseek",
  url: "https://chat.deepseek.com/",
};

describe("runtime message validation", () => {
  it("uses explicit transaction phases and workspace submission messages", () => {
    expect(
      precheckPromptSchema.safeParse({
        type: "PRECHECK_PROMPT",
        panelId: "panel-1",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "比较这个问题",
      }).success,
    ).toBe(true);
    expect(
      workspaceSubmitSchema.safeParse({
        type: "WORKSPACE_SUBMIT",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "比较这个问题",
        targets: [target],
      }).success,
    ).toBe(true);
    for (const type of ["STAGE_PROMPT", "COMMIT_PROMPT", "ROLLBACK_PROMPT"] as const) {
      expect(
        providerCommandSchema.safeParse({
          type,
          panelId: "panel-1",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "比较这个问题",
        }).success,
      ).toBe(true);
    }
  });

  it("accepts a provider's complete current URL without interpreting its path", () => {
    expect(
      providerUrlUpdateSchema.safeParse({
        type: "PROVIDER_URL_UPDATE",
        panelId: "panel-1",
        providerId: "kimi",
        url: "https://www.kimi.com/chat/1a053281-d112-8361-8000-0917232aa2ed?chat_enter_method=home",
      }).success,
    ).toBe(true);
  });

  it("rejects empty submissions and unknown message types", () => {
    expect(
      workspaceSubmitSchema.safeParse({
        type: "WORKSPACE_SUBMIT",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "   ",
        targets: [target],
      }).success,
    ).toBe(false);
    expect(
      runtimeMessageSchema.safeParse({ type: "WORKSPACE_SYNC", prompt: "draft" }).success,
    ).toBe(false);
    expect(runtimeMessageSchema.safeParse({ type: "STEAL_COOKIE" }).success).toBe(false);
  });

  it("validates provider DOM status reports", () => {
    expect(
      frameStatusSchema.safeParse({
        type: "FRAME_STATUS",
        panelId: "panel-1",
        providerId: "deepseek",
        status: "needs-login",
      }).success,
    ).toBe(true);
    expect(
      frameStatusSchema.safeParse({
        type: "FRAME_STATUS",
        panelId: "panel-1",
        providerId: "deepseek",
        status: "authenticated",
      }).success,
    ).toBe(false);
  });

  it("allows only bounded diagnostic metadata", () => {
    expect(
      providerDiagnosticSchema.safeParse({
        type: "PROVIDER_DIAGNOSTIC",
        panelId: "panel-1",
        providerId: "deepseek",
        stage: "command-failed",
        operation: "commit",
        promptLength: 20,
        errorCode: "SUBMIT_MISSING",
      }).success,
    ).toBe(true);
    expect(
      providerDiagnosticSchema.safeParse({
        type: "PROVIDER_DIAGNOSTIC",
        panelId: "panel-1",
        providerId: "deepseek",
        stage: "command-failed",
        prompt: "正文不得进入诊断协议",
      }).success,
    ).toBe(false);
  });
});
