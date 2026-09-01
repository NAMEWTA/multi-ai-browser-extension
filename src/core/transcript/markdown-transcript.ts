import type { ProviderId } from "../providers/contracts";
import type { ProviderExchangeRecord } from "../../db/database";
import type { SessionDetail } from "../../db/session-service";

export const MARKDOWN_TRANSCRIPT_MIME_TYPE = "text/markdown;charset=utf-8" as const;

export interface TranscriptProviderTarget {
  providerId: ProviderId;
  panelId?: string;
}

export interface LatestTurnTranscriptOptions {
  /** Omit this field to include every provider recorded for the latest turn. */
  targets?: readonly TranscriptProviderTarget[];
}

export interface MarkdownTranscriptArtifact {
  /** Ready for Clipboard.writeText() or a text Blob. */
  text: string;
  filename: string;
  mimeType: typeof MARKDOWN_TRANSCRIPT_MIME_TYPE;
}

interface TranscriptTurn {
  sequence: number;
  createdAt: string;
  id: string;
  prompt: string;
  userQuestion?: string;
  exchanges: readonly ProviderExchangeRecord[];
}

const EMPTY_SCOPE_NOTICE = "> 当前导出范围内没有可用的会话内容。";

export function createSessionTranscript(detail: SessionDetail): MarkdownTranscriptArtifact {
  return createArtifact(
    renderSessionMarkdown(detail),
    createSafeMarkdownFilename(detail.session.title),
  );
}

export function createLatestTurnTranscript(
  detail: SessionDetail,
  options: LatestTurnTranscriptOptions = {},
): MarkdownTranscriptArtifact {
  return createArtifact(
    renderLatestTurnMarkdown(detail, options),
    createSafeMarkdownFilename(detail.session.title, "最新一轮"),
  );
}

export function createOpenProvidersConversationTranscript(
  detail: SessionDetail,
  targets: readonly TranscriptProviderTarget[],
): MarkdownTranscriptArtifact {
  return createArtifact(
    renderOpenProvidersConversationMarkdown(detail, targets),
    createSafeMarkdownFilename(detail.session.title, "当前站点完整对话"),
  );
}

export function createProviderConversationTranscript(
  detail: SessionDetail,
  target: TranscriptProviderTarget,
): MarkdownTranscriptArtifact {
  const providerName = findProviderName(detail, target) ?? target.providerId;
  return createArtifact(
    renderProviderConversationMarkdown(detail, target),
    createSafeMarkdownFilename(detail.session.title, `${providerName}-完整对话`),
  );
}

export function createProviderLatestExchangeTranscript(
  detail: SessionDetail,
  target: TranscriptProviderTarget,
): MarkdownTranscriptArtifact {
  const providerName = findProviderName(detail, target) ?? target.providerId;
  return createArtifact(
    renderProviderLatestExchangeMarkdown(detail, target),
    createSafeMarkdownFilename(detail.session.title, `${providerName}-最新回复`),
  );
}

export function renderSessionMarkdown(detail: SessionDetail): string {
  return renderDocument(detail.session.title, sortedTurns(detail));
}

export function renderLatestTurnMarkdown(
  detail: SessionDetail,
  options: LatestTurnTranscriptOptions = {},
): string {
  const latest = sortedTurns(detail).at(-1);
  if (!latest) return renderDocument(detail.session.title, []);
  const targets = options.targets;
  const exchanges = targets
    ? latest.exchanges.filter((exchange) =>
        targets.some((target) => matchesTarget(exchange, target)),
      )
    : latest.exchanges;
  return renderDocument(detail.session.title, [{ ...latest, exchanges }]);
}

export function renderOpenProvidersConversationMarkdown(
  detail: SessionDetail,
  targets: readonly TranscriptProviderTarget[],
): string {
  const turns = sortedTurns(detail).flatMap((turn) => {
    const exchanges = turn.exchanges.filter((exchange) =>
      targets.some((target) => matchesTarget(exchange, target)),
    );
    return exchanges.length ? [{ ...turn, exchanges }] : [];
  });
  return renderDocument(detail.session.title, turns);
}

export function renderProviderConversationMarkdown(
  detail: SessionDetail,
  target: TranscriptProviderTarget,
): string {
  const turns = sortedTurns(detail).flatMap((turn) => {
    const exchanges = turn.exchanges.filter((exchange) => matchesTarget(exchange, target));
    return exchanges.length ? [{ ...turn, exchanges }] : [];
  });
  return renderDocument(detail.session.title, turns);
}

export function renderProviderLatestExchangeMarkdown(
  detail: SessionDetail,
  target: TranscriptProviderTarget,
): string {
  const latest = sortedTurns(detail)
    .flatMap((turn) =>
      turn.exchanges
        .filter((exchange) => matchesTarget(exchange, target))
        .map((exchange) => ({ ...turn, exchanges: [exchange] })),
    )
    .at(-1);
  return renderDocument(detail.session.title, latest ? [latest] : []);
}

/** Creates a cross-platform filename without changing the Markdown body. */
export function createSafeMarkdownFilename(title: string, suffix?: string): string {
  const pieces = [title, suffix]
    .filter((piece): piece is string => Boolean(piece?.trim()))
    .map(sanitizeFilenamePart)
    .filter(Boolean);
  let basename = pieces.join("-") || "multi-ai-transcript";
  basename = basename.slice(0, 120).replace(/[ .]+$/u, "");
  if (!basename) basename = "multi-ai-transcript";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(basename)) {
    basename = `_${basename}`;
  }
  return `${basename}.md`;
}

function createArtifact(text: string, filename: string): MarkdownTranscriptArtifact {
  return { text, filename, mimeType: MARKDOWN_TRANSCRIPT_MIME_TYPE };
}

function renderDocument(title: string, turns: readonly TranscriptTurn[]): string {
  const heading = `# ${inlineHeading(title) || "Untitled session"}`;
  const body = turns.map(renderTurn).join("\n\n");
  return `${heading}\n\n${body || EMPTY_SCOPE_NOTICE}\n`;
}

function renderTurn(turn: TranscriptTurn): string {
  const exchanges = sortedExchanges(turn.exchanges);
  const answers = exchanges.length
    ? exchanges.map(renderExchange).join("\n\n")
    : "> 该问题没有对应的 AI 回复记录。";
  const question = turn.userQuestion ?? turn.prompt;
  return `## 用户：${inlineHeading(question) || "（空内容）"}\n\n${turn.prompt}\n\n${answers}`;
}

function renderExchange(exchange: ProviderExchangeRecord): string {
  const providerName = inlineHeading(exchange.providerName) || exchange.providerId;
  const heading = `### ${providerName}`;
  const response = exchange.responseMarkdown || exchange.responseText;
  if (response !== undefined && response.length > 0) {
    const metadata =
      exchange.responseStatus === "completed"
        ? ""
        : `\n\n${renderStatusQuote(exchange, responseStatusSummary(exchange))}`;
    return `${heading}\n\n${response}${metadata}`;
  }
  return `${heading}\n\n${renderStatusQuote(exchange, "未采集到回复内容。")}`;
}

function renderStatusQuote(exchange: ProviderExchangeRecord, summary: string): string {
  const lines = [
    summary,
    `发送状态：${exchange.submitStatus}`,
    `回复状态：${exchange.responseStatus}`,
  ];
  if (exchange.terminalReason)
    lines.push(`终止原因：${terminalReasonLabel(exchange.terminalReason)}`);
  if (exchange.message !== undefined && exchange.message.length > 0) {
    lines.push("详情：", ...exchange.message.split(/\r?\n/u));
  }
  return lines.map((line) => `> ${line}`).join("\n");
}

function responseStatusSummary(exchange: ProviderExchangeRecord): string {
  if (exchange.terminalReason === "interrupted") return "回复已停止，已保留停止前的内容。";
  if (exchange.terminalReason === "uncertain-final") return "回复正文已保留，但终态未确认。";
  return "回复采集尚未完成。";
}

function terminalReasonLabel(
  reason: NonNullable<ProviderExchangeRecord["terminalReason"]>,
): string {
  return {
    completed: "已完成",
    interrupted: "用户停止",
    aborted: "采集取消",
    timeout: "采集超时",
    navigation: "页面导航",
    verification: "人工验证",
    "uncertain-final": "终态未确认",
    failed: "采集失败",
    unsupported: "不支持采集",
  }[reason];
}

function sortedTurns(detail: SessionDetail): TranscriptTurn[] {
  return detail.turns
    .map(({ turn, exchanges }) => ({
      sequence: turn.sequence,
      createdAt: turn.createdAt,
      id: turn.id,
      prompt: turn.prompt,
      ...(turn.userQuestion !== undefined ? { userQuestion: turn.userQuestion } : {}),
      exchanges: sortedExchanges(exchanges),
    }))
    .toSorted(compareTurns);
}

function sortedExchanges(exchanges: readonly ProviderExchangeRecord[]): ProviderExchangeRecord[] {
  return exchanges.toSorted(
    (left, right) =>
      left.targetIndex - right.targetIndex ||
      left.providerId.localeCompare(right.providerId) ||
      left.panelId.localeCompare(right.panelId) ||
      left.id.localeCompare(right.id),
  );
}

function compareTurns(left: TranscriptTurn, right: TranscriptTurn): number {
  return (
    left.sequence - right.sequence ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function matchesTarget(
  exchange: ProviderExchangeRecord,
  target: TranscriptProviderTarget,
): boolean {
  return (
    exchange.providerId === target.providerId &&
    (target.panelId === undefined || exchange.panelId === target.panelId)
  );
}

function findProviderName(
  detail: SessionDetail,
  target: TranscriptProviderTarget,
): string | undefined {
  return sortedTurns(detail)
    .flatMap((turn) => turn.exchanges)
    .find((exchange) => matchesTarget(exchange, target))?.providerName;
}

function inlineHeading(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sanitizeFilenamePart(value: string): string {
  const normalized = Array.from(value.normalize("NFKC"), (character) => {
    if (/\s/u.test(character)) return " ";
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? "-" : character;
  }).join("");
  return normalized
    .replace(/\s+/gu, " ")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/\s*-\s*/gu, "-")
    .replace(/-+/gu, "-")
    .trim()
    .replace(/^[ .-]+|[ .-]+$/gu, "");
}
