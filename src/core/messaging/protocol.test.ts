import { describe, expect, it } from "vitest";
import {
  frameStatusSchema,
  precheckPromptSchema,
  providerCommandSchema,
  providerUrlUpdateSchema,
  providerDiagnosticSchema,
  providerResponseUpdateSchema,
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

  it("requires monotonic capture metadata on response updates", () => {
    const update = {
      type: "PROVIDER_RESPONSE_UPDATE",
      panelId: "panel-1",
      providerId: "deepseek",
      sessionId: "session-1",
      turnId: "turn-1",
      captureId: "capture-1",
      revision: 8,
      observedAt: "2026-09-01T08:00:08.000Z",
      status: "completed",
      terminalReason: "completed",
      captureSource: "native-copy",
      nativeMimeType: "text/markdown",
      text: "完整回答",
      markdown: "## 完整回答",
    };
    expect(providerResponseUpdateSchema.safeParse(update).success).toBe(true);
    expect(providerResponseUpdateSchema.safeParse({ ...update, revision: 0 }).success).toBe(false);
    expect(
      providerResponseUpdateSchema.safeParse({ ...update, captureId: undefined }).success,
    ).toBe(false);
  });

  it("rejects streaming or DOM-sourced response bodies", () => {
    const terminal = {
      type: "PROVIDER_RESPONSE_UPDATE",
      panelId: "panel-1",
      providerId: "deepseek",
      sessionId: "session-1",
      turnId: "turn-1",
      captureId: "capture-1",
      revision: 1,
      observedAt: "2026-09-01T08:00:00.000Z",
      status: "completed",
      terminalReason: "completed",
      captureSource: "native-copy",
      nativeMimeType: "text/plain",
      text: "complete response",
    };

    expect(providerResponseUpdateSchema.safeParse(terminal).success).toBe(true);
    expect(
      providerResponseUpdateSchema.safeParse({ ...terminal, status: "streaming" }).success,
    ).toBe(false);
    expect(
      providerResponseUpdateSchema.safeParse({ ...terminal, captureSource: "dom" }).success,
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
        providerId: "qwen",
        stage: "command-start",
        composerCandidates: [
          {
            descriptor: "textarea#chat-input",
            score: 400,
            normalizedLength: 4,
            selected: true,
            eligible: true,
            value: "不得记录正文",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      providerDiagnosticSchema.safeParse({
        type: "PROVIDER_DIAGNOSTIC",
        panelId: "panel-1",
        providerId: "qwen",
        stage: "command-start",
        operation: "precheck",
        composerCandidates: [
          {
            descriptor: "textarea#chat-input",
            score: 400,
            normalizedLength: 0,
            selected: true,
            eligible: true,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      providerDiagnosticSchema.safeParse({
        type: "PROVIDER_DIAGNOSTIC",
        panelId: "panel-1",
        providerId: "deepseek",
        stage: "response-update",
        operation: "response",
        responseRevision: 8,
        responseStatus: "completed",
        responseLength: 1_024,
        terminalReason: "completed",
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
