import { z } from "zod";
import { acquisitionSources } from "../acquisition/contracts";
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

export const responseCaptureSourceSchema = z.enum([
  "dom",
  "native-copy",
  "provider-api",
  "network",
  "virtual-dom",
]);
export const nativeCopyMimeTypeSchema = z.enum(["text/markdown", "text/plain", "text/html"]);

const acquisitionMetadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const acquisitionContentBlockSchema = z.object({
  kind: z.enum([
    "paragraph",
    "heading",
    "code",
    "list",
    "table",
    "quote",
    "math",
    "image",
    "attachment",
    "unknown",
  ]),
  text: z.string().max(2_000_000),
  markdown: z.string().max(2_000_000).optional(),
  language: z.string().max(100).optional(),
  url: z.string().max(4_000).optional(),
  attributes: z.record(z.string(), acquisitionMetadataValueSchema).optional(),
});
const acquisitionMessageSchema = z.object({
  id: z.string().min(1).max(500),
  role: z.enum(["user", "assistant", "system", "tool", "unknown"]),
  content: z.array(acquisitionContentBlockSchema).max(200),
  parentId: z.string().max(500).optional(),
  branchId: z.string().max(500).optional(),
  createdAt: z.number().finite().optional(),
});
const acquisitionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  providerId: providerIdSchema,
  conversationId: z.string().min(1).max(1_000).optional(),
  title: z.string().max(2_000).optional(),
  url: z.string().max(4_000).optional(),
  capturedAt: z.number().finite(),
  messages: z.array(acquisitionMessageSchema).max(20_000),
  source: z.enum(acquisitionSources),
  completeness: z.object({
    state: z.enum(["complete", "partial", "unknown"]),
    capturedMessageCount: z.number().int().nonnegative(),
    expectedMessageCount: z.number().int().nonnegative().optional(),
    capturedContentChars: z.number().int().nonnegative(),
    expectedContentChars: z.number().int().nonnegative().optional(),
    hasBeginning: z.boolean().optional(),
    hasEnd: z.boolean().optional(),
  }),
  evidence: z.object({
    stableMessageKeys: z.array(z.string().max(500)).max(20_000),
    signals: z.array(z.string().max(500)).max(200),
    cursor: z
      .object({
        value: z.string().max(1_000).optional(),
        hasMore: z.boolean(),
        reachedStart: z.boolean().optional(),
        reachedEnd: z.boolean().optional(),
      })
      .optional(),
    branch: z
      .object({
        branchId: z.string().max(500).optional(),
        currentNodeId: z.string().max(500).optional(),
        capturedNodeIds: z.array(z.string().max(500)).max(20_000),
        linearized: z.boolean(),
        complete: z.boolean(),
      })
      .optional(),
  }),
  diagnostics: z.object({
    strategyId: z.string().min(1).max(200),
    durationMs: z.number().finite().nonnegative().optional(),
    entries: z
      .array(
        z.object({
          code: z.string().min(1).max(200),
          severity: z.enum(["info", "warning", "error"]),
          message: z.string().max(2_000),
          messageId: z.string().max(500).optional(),
          details: z.record(z.string(), acquisitionMetadataValueSchema).optional(),
        }),
      )
      .max(500),
  }),
});

const responseAcquisitionSchema = z.object({
  snapshot: acquisitionSnapshotSchema,
  providerMessageId: z.string().min(1).max(500),
  adapterVersion: z.string().min(1).max(100),
  verification: z.enum(["verified", "bounded", "partial", "unknown"]),
});

const responseUpdateBodySchema = z.object({
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
  acquisition: responseAcquisitionSchema.optional(),
});

function responseUpdateSchemaFor<
  const Type extends "PROVIDER_RESPONSE_UPDATE" | "WORKSPACE_RESPONSE_UPDATE",
>(type: Type) {
  return responseUpdateBodySchema
    .extend({ type: z.literal(type) })
    .superRefine((update, context) => {
      const hasBody = update.text !== undefined || update.markdown !== undefined;
      if (!hasBody) return;
      if (update.status !== "completed" && update.status !== "partial") {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "Response body is allowed only on a terminal capture update",
        });
      }
      if (!update.captureSource) {
        context.addIssue({
          code: "custom",
          path: ["captureSource"],
          message: "Response body must declare its acquisition source",
        });
      }
      if (update.captureSource === "native-copy" && !update.nativeMimeType) {
        context.addIssue({
          code: "custom",
          path: ["nativeMimeType"],
          message: "Native response body must declare its clipboard MIME type",
        });
      }
      if (update.captureSource !== "native-copy" && !update.acquisition) {
        context.addIssue({
          code: "custom",
          path: ["acquisition"],
          message: "Non-clipboard response body must include acquisition evidence",
        });
      }
    });
}

export const providerResponseUpdateSchema = responseUpdateSchemaFor("PROVIDER_RESPONSE_UPDATE");
export const workspaceResponseUpdateSchema = responseUpdateSchemaFor("WORKSPACE_RESPONSE_UPDATE");

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
