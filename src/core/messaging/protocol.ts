import { z } from "zod";
import { providerIds } from "../providers/contracts";
import { providerErrorCodes } from "../providers/errors";

export const providerIdSchema = z.enum(providerIds);

export const frameHelloSchema = z.object({
  type: z.literal("FRAME_HELLO"),
  panelId: z.string().min(1).optional(),
  providerId: providerIdSchema,
  url: z.url(),
});

export const providerPageStatusSchema = z.enum(["loading", "needs-login", "ready", "blocked"]);
export const frameStatusSchema = z.object({
  type: z.literal("FRAME_STATUS"),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  status: providerPageStatusSchema,
  message: z.string().optional(),
});

export const syncPromptSchema = z.object({
  type: z.literal("SYNC_PROMPT"),
  panelId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  prompt: z.string().max(100_000),
});

export const submitPromptSchema = z.object({
  type: z.literal("SUBMIT_PROMPT"),
  panelId: z.string().min(1),
  taskId: z.string().min(1),
  prompt: z.string().trim().min(1).max(100_000),
});

export const providerCommandSchema = z.discriminatedUnion("type", [
  syncPromptSchema,
  submitPromptSchema,
]);

const workspaceTargetSchema = z.object({
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  url: z.url(),
});

export const workspaceSyncSchema = z.object({
  type: z.literal("WORKSPACE_SYNC"),
  revision: z.number().int().nonnegative(),
  prompt: z.string().max(100_000),
  targets: z.array(workspaceTargetSchema),
});

export const workspaceSubmitSchema = z.object({
  type: z.literal("WORKSPACE_SUBMIT"),
  taskId: z.string().min(1),
  prompt: z.string().trim().min(1).max(100_000),
  targets: z.array(workspaceTargetSchema).min(1),
});

export const openWorkspaceSchema = z.object({ type: z.literal("OPEN_WORKSPACE") });
export const workspaceReadySchema = z.object({ type: z.literal("WORKSPACE_READY") });
export const openPanelTabSchema = z.object({
  type: z.literal("OPEN_PANEL_TAB"),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  url: z.url(),
});

export const workspaceFrameStatusSchema = frameStatusSchema.extend({
  type: z.literal("WORKSPACE_FRAME_STATUS"),
});

export const runtimeMessageSchema = z.discriminatedUnion("type", [
  frameHelloSchema,
  frameStatusSchema,
  syncPromptSchema,
  submitPromptSchema,
  workspaceSyncSchema,
  workspaceSubmitSchema,
  openWorkspaceSchema,
  workspaceReadySchema,
  openPanelTabSchema,
  workspaceFrameStatusSchema,
]);

export const providerRunResultSchema = z.object({
  requestId: z.string().min(1),
  panelId: z.string().min(1),
  providerId: providerIdSchema.optional(),
  operation: z.enum(["sync", "submit"]),
  status: z.enum(["synced", "submitted", "duplicate", "failed", "unavailable"]),
  errorCode: z.enum(providerErrorCodes).optional(),
  message: z.string().optional(),
});

export type ProviderCommand = z.infer<typeof providerCommandSchema>;
export type SyncPromptMessage = z.infer<typeof syncPromptSchema>;
export type SubmitPromptMessage = z.infer<typeof submitPromptSchema>;
export type WorkspaceSyncMessage = z.infer<typeof workspaceSyncSchema>;
export type WorkspaceSubmitMessage = z.infer<typeof workspaceSubmitSchema>;
export type ProviderRunResult = z.infer<typeof providerRunResultSchema>;
