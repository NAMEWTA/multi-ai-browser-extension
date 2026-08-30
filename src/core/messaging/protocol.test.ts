import { describe, expect, it } from "vitest";
import {
  frameStatusSchema,
  runtimeMessageSchema,
  workspaceSubmitSchema,
  workspaceSyncSchema,
} from "./protocol";

const target = {
  panelId: "panel-1",
  providerId: "deepseek",
  url: "https://chat.deepseek.com/",
};

describe("runtime message validation", () => {
  it("separates prompt synchronization from explicit submission", () => {
    expect(
      workspaceSyncSchema.safeParse({
        type: "WORKSPACE_SYNC",
        revision: 2,
        prompt: "",
        targets: [target],
      }).success,
    ).toBe(true);
    expect(
      workspaceSubmitSchema.safeParse({
        type: "WORKSPACE_SUBMIT",
        taskId: "task-1",
        prompt: "比较这个问题",
        targets: [target],
      }).success,
    ).toBe(true);
  });

  it("rejects empty submissions and unknown message types", () => {
    expect(
      workspaceSubmitSchema.safeParse({
        type: "WORKSPACE_SUBMIT",
        taskId: "task-1",
        prompt: "   ",
        targets: [target],
      }).success,
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
});
