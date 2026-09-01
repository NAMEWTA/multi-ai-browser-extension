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

const promptCommandFields = {
  panelId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  prompt: z.string().trim().min(1).max(100_000),
};

export const precheckPromptSchema = z.object({
  type: z.literal("PRECHECK_PROMPT"),
  ...promptCommandFields,
});
export const stagePromptSchema = z.object({
  type: z.literal("STAGE_PROMPT"),
  ...promptCommandFields,
});
export const commitPromptSchema = z.object({
  type: z.literal("COMMIT_PROMPT"),
  ...promptCommandFields,
});
export const rollbackPromptSchema = z.object({
  type: z.literal("ROLLBACK_PROMPT"),
  ...promptCommandFields,
});
export const startNewConversationSchema = z.object({
  type: z.literal("START_NEW_CONVERSATION"),
  panelId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const providerCommandSchema = z.discriminatedUnion("type", [
  precheckPromptSchema,
  stagePromptSchema,
  commitPromptSchema,
  rollbackPromptSchema,
  startNewConversationSchema,
]);

const workspaceTargetSchema = z.object({
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  url: z.url(),
});

export const workspaceSubmitSchema = z.object({
  type: z.literal("WORKSPACE_SUBMIT"),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  prompt: z.string().trim().min(1).max(100_000),
  targets: z.array(workspaceTargetSchema).min(1),
});

export const workspaceNewSessionSchema = z.object({
  type: z.literal("WORKSPACE_NEW_SESSION"),
  sessionId: z.string().min(1),
  targets: z.array(workspaceTargetSchema).min(1),
});

export const responseCaptureStatusSchema = z.enum([
  "waiting",
  "streaming",
  "completed",
  "partial",
  "timeout",
  "failed",
  "unsupported",
]);

export const responseTerminalReasonSchema = z.enum([
  "completed",
  "interrupted",
  "aborted",
  "timeout",
  "navigation",
  "verification",
  "uncertain-final",
  "failed",
  "unsupported",
]);

export const responseCaptureSourceSchema = z.enum(["dom", "native-copy", "provider-api"]);
export const nativeCopyMimeTypeSchema = z.enum(["text/markdown", "text/plain", "text/html"]);

export const providerResponseUpdateSchema = z.object({
  type: z.literal("PROVIDER_RESPONSE_UPDATE"),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  captureId: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  observedAt: z.iso.datetime(),
  status: responseCaptureStatusSchema,
  text: z.string().max(2_000_000).optional(),
  markdown: z.string().max(2_000_000).optional(),
  message: z.string().max(1_000).optional(),
  terminalReason: responseTerminalReasonSchema.optional(),
  captureSource: responseCaptureSourceSchema.optional(),
  nativeMimeType: nativeCopyMimeTypeSchema.optional(),
});

export const workspaceResponseUpdateSchema = providerResponseUpdateSchema.extend({
  type: z.literal("WORKSPACE_RESPONSE_UPDATE"),
});

export const providerUrlUpdateSchema = z.object({
  type: z.literal("PROVIDER_URL_UPDATE"),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  url: z.url(),
});

export const workspacePanelUrlUpdateSchema = providerUrlUpdateSchema.extend({
  type: z.literal("WORKSPACE_PANEL_URL_UPDATE"),
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

const composerCandidateDiagnosticSchema = z
  .object({
    descriptor: z.string().min(1).max(160),
    score: z.number().int().min(-2_000).max(2_000),
    normalizedLength: z.number().int().min(0).max(100_000),
    selected: z.boolean(),
    eligible: z.boolean(),
    reason: z.enum(["hidden", "disabled", "readonly", "search", "not-editable"]).optional(),
  })
  .strict();

export const providerDiagnosticSchema = z
  .object({
    type: z.literal("PROVIDER_DIAGNOSTIC"),
    panelId: z.string().min(1),
    providerId: providerIdSchema,
    stage: z.enum([
      "frame-ready",
      "command-start",
      "precheck-confirmed",
      "stage-confirmed",
      "commit-confirmed",
      "rollback-confirmed",
      "response-update",
      "new-session-confirmed",
      "command-failed",
    ]),
    operation: z
      .enum(["precheck", "stage", "commit", "rollback", "new-session", "response"])
      .optional(),
    promptLength: z.number().int().min(0).max(100_000).optional(),
    durationMs: z.number().int().min(0).max(180_000).optional(),
    composer: z.string().max(300).optional(),
    composerCandidates: z.array(composerCandidateDiagnosticSchema).max(12).optional(),
    submit: z.string().max(300).optional(),
    errorCode: z.enum(providerErrorCodes).optional(),
    responseRevision: z.number().int().positive().optional(),
    responseStatus: responseCaptureStatusSchema.optional(),
    responseLength: z.number().int().nonnegative().max(2_000_000).optional(),
    terminalReason: responseTerminalReasonSchema.optional(),
  })
  .strict();

export const runtimeMessageSchema = z.discriminatedUnion("type", [
  frameHelloSchema,
  frameStatusSchema,
  precheckPromptSchema,
  stagePromptSchema,
  commitPromptSchema,
  rollbackPromptSchema,
  startNewConversationSchema,
  workspaceSubmitSchema,
  workspaceNewSessionSchema,
  providerResponseUpdateSchema,
  workspaceResponseUpdateSchema,
  providerUrlUpdateSchema,
  workspacePanelUrlUpdateSchema,
  openWorkspaceSchema,
  workspaceReadySchema,
  openPanelTabSchema,
  workspaceFrameStatusSchema,
  providerDiagnosticSchema,
]);

export const providerRunResultSchema = z.object({
  requestId: z.string().min(1),
  panelId: z.string().min(1),
  providerId: providerIdSchema.optional(),
  operation: z.enum(["precheck", "stage", "commit", "rollback", "new-session"]),
  status: z.enum([
    "prechecked",
    "staged",
    "submitted",
    "rolled-back",
    "duplicate",
    "failed",
    "unavailable",
    "aborted",
  ]),
  errorCode: z.enum(providerErrorCodes).optional(),
  message: z.string().optional(),
});

export type ProviderCommand = z.infer<typeof providerCommandSchema>;
export type PrecheckPromptMessage = z.infer<typeof precheckPromptSchema>;
export type StagePromptMessage = z.infer<typeof stagePromptSchema>;
export type CommitPromptMessage = z.infer<typeof commitPromptSchema>;
export type RollbackPromptMessage = z.infer<typeof rollbackPromptSchema>;
export type StartNewConversationMessage = z.infer<typeof startNewConversationSchema>;
export type WorkspaceSubmitMessage = z.infer<typeof workspaceSubmitSchema>;
export type WorkspaceNewSessionMessage = z.infer<typeof workspaceNewSessionSchema>;
export type ProviderResponseUpdate = z.infer<typeof providerResponseUpdateSchema>;
export type ProviderRunResult = z.infer<typeof providerRunResultSchema>;
export type ProviderDiagnosticMessage = z.infer<typeof providerDiagnosticSchema>;
