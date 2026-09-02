import type {
  AcquisitionDiagnostic,
  AcquisitionQualityPolicy,
  AcquisitionQualityReport,
  ConversationSnapshot,
  Message,
} from "./contracts";

const DEFAULT_STATUS_TERMS = [
  "complete",
  "completed",
  "done",
  "generating",
  "loading",
  "ready",
  "stop",
  "stopped",
  "thinking",
  "已停止",
  "已完成",
  "停止",
  "停止生成",
  "生成中",
  "思考中",
  "正在生成",
  "正在思考",
  "就绪",
] as const;

export function evaluateAcquisitionQuality(
  snapshot: ConversationSnapshot,
  policy: AcquisitionQualityPolicy = {},
): AcquisitionQualityReport {
  const diagnostics: AcquisitionDiagnostic[] = [];
  const conversational = snapshot.messages.filter(
    (message) => message.role === "assistant" || message.role === "user",
  );
  const assistant = conversational.filter((message) => message.role === "assistant");
  const targetMessages = assistant.length ? assistant : conversational;
  const bodies = targetMessages.map((message) => ({ message, body: messageBody(message) }));

  if (!snapshot.messages.length) {
    diagnostics.push(error("EMPTY_MESSAGES", "The snapshot contains no messages."));
  } else if (!targetMessages.length) {
    diagnostics.push(
      error("EMPTY_BODY", "The snapshot contains no user or assistant message body."),
    );
  }

  for (const { message, body } of bodies) {
    if (!body) {
      diagnostics.push(
        error("EMPTY_BODY", `Message ${message.id || "<unknown>"} has an empty body.`, message.id),
      );
    }
  }

  const nonEmptyBodies = bodies.map(({ body }) => body).filter(Boolean);
  const normalizedTitle = normalizeComparable(snapshot.title ?? "");
  if (
    normalizedTitle &&
    nonEmptyBodies.length > 0 &&
    nonEmptyBodies.every((body) => normalizeComparable(body) === normalizedTitle)
  ) {
    diagnostics.push(
      error("TITLE_ONLY", "The captured body contains only the conversation title."),
    );
  }

  const statusTerms = new Set(
    [...DEFAULT_STATUS_TERMS, ...(policy.statusTerms ?? [])]
      .map(normalizeComparable)
      .filter(Boolean),
  );
  if (
    nonEmptyBodies.length > 0 &&
    nonEmptyBodies.every((body) => statusTerms.has(normalizeComparable(body)))
  ) {
    diagnostics.push(error("STATUS_ONLY", "The captured body contains only provider status text."));
  }

  const actualMessages = snapshot.messages.length;
  const expectedMessages = snapshot.completeness.expectedMessageCount;
  if (
    expectedMessages !== undefined &&
    expectedMessages > 0 &&
    actualMessages / expectedMessages < boundedRatio(policy.minimumMessageRatio)
  ) {
    diagnostics.push(
      error(
        "MESSAGE_SHORTFALL",
        "The snapshot contains fewer messages than the provider reported.",
        undefined,
        {
          actual: actualMessages,
          expected: expectedMessages,
        },
      ),
    );
  }

  const actualChars = snapshot.messages.reduce(
    (total, message) => total + messageBody(message).length,
    0,
  );
  const expectedChars = snapshot.completeness.expectedContentChars;
  if (
    expectedChars !== undefined &&
    expectedChars > 0 &&
    actualChars / expectedChars < boundedRatio(policy.minimumContentRatio)
  ) {
    diagnostics.push(
      error(
        "CONTENT_SHORTFALL",
        "The snapshot body is shorter than the provider-reported content.",
        undefined,
        {
          actual: actualChars,
          expected: expectedChars,
        },
      ),
    );
  }

  if (policy.requireComplete && snapshot.completeness.state !== "complete") {
    diagnostics.push(error("INCOMPLETE_SNAPSHOT", "The provider requires a complete snapshot."));
  }
  if (
    snapshot.completeness.state === "complete" &&
    (snapshot.completeness.hasBeginning === false || snapshot.completeness.hasEnd === false)
  ) {
    diagnostics.push(
      error(
        "BOUNDARY_INCOMPLETE",
        "A complete snapshot must include both conversation boundaries.",
      ),
    );
  }

  validateCursor(snapshot, policy, diagnostics);
  validateBranch(snapshot, policy, diagnostics);

  return {
    accepted: diagnostics.every((entry) => entry.severity !== "error"),
    diagnostics,
  };
}

export function messageBody(message: Message): string {
  return message.content
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function validateCursor(
  snapshot: ConversationSnapshot,
  policy: AcquisitionQualityPolicy,
  diagnostics: AcquisitionDiagnostic[],
): void {
  const cursor = snapshot.evidence.cursor;
  if (policy.requireTerminalCursor && !cursor) {
    diagnostics.push(error("CURSOR_EVIDENCE_MISSING", "Terminal cursor evidence is required."));
    return;
  }
  if (!cursor) return;
  if (
    (snapshot.completeness.state === "complete" || policy.requireTerminalCursor) &&
    (cursor.hasMore || cursor.reachedEnd === false)
  ) {
    diagnostics.push(error("CURSOR_INCOMPLETE", "Cursor evidence indicates more content exists."));
  }
  if (
    policy.requireTerminalCursor &&
    (cursor.reachedStart !== true || cursor.reachedEnd !== true)
  ) {
    diagnostics.push(
      error("CURSOR_BOUNDARY_MISSING", "Cursor evidence did not confirm both boundaries."),
    );
  }
}

function validateBranch(
  snapshot: ConversationSnapshot,
  policy: AcquisitionQualityPolicy,
  diagnostics: AcquisitionDiagnostic[],
): void {
  const branch = snapshot.evidence.branch;
  if (policy.requireBranchEvidence && !branch) {
    diagnostics.push(error("BRANCH_EVIDENCE_MISSING", "Branch evidence is required."));
    return;
  }
  if (!branch) return;
  if (snapshot.completeness.state === "complete" && !branch.complete) {
    diagnostics.push(error("BRANCH_INCOMPLETE", "Branch evidence is not complete."));
  }
  if (snapshot.completeness.state === "complete" && !branch.linearized) {
    diagnostics.push(error("BRANCH_NOT_LINEARIZED", "The active branch was not linearized."));
  }
  if (branch.currentNodeId) {
    const capturedIds = new Set([
      ...branch.capturedNodeIds,
      ...snapshot.messages.map((message) => message.id),
    ]);
    if (!capturedIds.has(branch.currentNodeId)) {
      diagnostics.push(
        error(
          "BRANCH_CURRENT_NODE_MISSING",
          "The active branch cursor is absent from the snapshot.",
        ),
      );
    }
  }
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^[>*_`~\-\s]+|[>*_`~\-\s]+$/g, "")
    .replace(/[\s:：。.!！?？]+/g, " ")
    .trim();
}

function boundedRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function error(
  code: string,
  message: string,
  messageId?: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): AcquisitionDiagnostic {
  return {
    code,
    severity: "error",
    message,
    ...(messageId ? { messageId } : {}),
    ...(details ? { details } : {}),
  };
}
