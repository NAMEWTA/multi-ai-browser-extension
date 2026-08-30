import { describe, expect, it } from "vitest";
import {
  frameStatusSchema,
  preparePromptSchema,
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
  it("uses explicit prepare and workspace submission messages", () => {
    expect(
      preparePromptSchema.safeParse({
        type: "PREPARE_PROMPT",
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
        operation: "submit",
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
