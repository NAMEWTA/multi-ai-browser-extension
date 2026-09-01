import { describe, expect, it } from "vitest";
import type { ProviderExchangeRecord, SessionRecord, TurnRecord } from "../../db/database";
import type { SessionDetail } from "../../db/session-service";
import {
  MARKDOWN_TRANSCRIPT_MIME_TYPE,
  createLatestTurnTranscript,
  createOpenProvidersConversationTranscript,
  createProviderConversationTranscript,
  createProviderLatestExchangeTranscript,
  createSafeMarkdownFilename,
  createSessionTranscript,
  renderLatestTurnMarkdown,
  renderOpenProvidersConversationMarkdown,
  renderProviderConversationMarkdown,
  renderProviderLatestExchangeMarkdown,
  renderSessionMarkdown,
} from "./markdown-transcript";

describe("Markdown transcripts", () => {
  it("exports a full session in turn and targetIndex order without truncating content", () => {
    const detail = createDetail();
    const markdown = renderSessionMarkdown(detail);

    expect(markdown).toBe(
      `# Research session\n\n` +
        `## 用户：First question with every line.\n\n` +
        `First question\nwith every line.\n\n` +
        `### DeepSeek\n\n` +
        `DeepSeek first response.\n\n` +
        `### Kimi\n\n` +
        `Kimi first response.\n\n` +
        `## 用户：Second question\n\n` +
        `Second question\n\n` +
        `### Kimi\n\n` +
        `Kimi second response.\n\n` +
        `### DeepSeek\n\n` +
        `DeepSeek second response.\n`,
    );
  });

  it("exports the latest turn only across requested provider panels", () => {
    const markdown = renderLatestTurnMarkdown(createDetail(), {
      targets: [{ providerId: "deepseek", panelId: "panel-deepseek" }],
    });

    expect(markdown).toContain("Second question");
    expect(markdown).toContain("DeepSeek second response.");
    expect(markdown).not.toContain("First question");
    expect(markdown).not.toContain("Kimi second response.");
  });

  it("exports one provider's full conversation while retaining each matching question", () => {
    const markdown = renderProviderConversationMarkdown(createDetail(), {
      providerId: "kimi",
      panelId: "panel-kimi",
    });

    expect(markdown).toContain("First question\nwith every line.");
    expect(markdown).toContain("Kimi first response.");
    expect(markdown).toContain("Second question");
    expect(markdown).toContain("Kimi second response.");
    expect(markdown).not.toContain("DeepSeek first response.");
  });

  it("exports all turns filtered to the currently open provider panels", () => {
    const markdown = renderOpenProvidersConversationMarkdown(createDetail(), [
      { providerId: "kimi", panelId: "panel-kimi" },
    ]);

    expect(markdown).toContain("First question\nwith every line.");
    expect(markdown).toContain("Kimi first response.");
    expect(markdown).toContain("Second question");
    expect(markdown).toContain("Kimi second response.");
    expect(markdown).not.toContain("DeepSeek first response.");
    expect(markdown).not.toContain("DeepSeek second response.");
  });

  it("exports only the latest exchange for one provider", () => {
    const markdown = renderProviderLatestExchangeMarkdown(createDetail(), {
      providerId: "deepseek",
    });

    expect(markdown).toContain("Second question");
    expect(markdown).toContain("DeepSeek second response.");
    expect(markdown).not.toContain("First question");
    expect(markdown).not.toContain("Kimi second response.");
  });

  it("states submit and response status explicitly when no response was captured", () => {
    const detail = createDetail();
    const latest = detail.turns.find(({ turn }) => turn.id === "turn-2")!;
    latest.exchanges[1] = exchange({
      id: "exchange-missing",
      turnId: "turn-2",
      panelId: "panel-kimi",
      providerId: "kimi",
      providerName: "Kimi",
      targetIndex: 0,
      submitStatus: "submitted",
      responseStatus: "timeout",
      message: "Timed out\nafter three minutes.",
    });

    const markdown = renderProviderLatestExchangeMarkdown(detail, { providerId: "kimi" });
    expect(markdown).toContain(
      "> 未采集到回复内容。\n" +
        "> 发送状态：submitted\n" +
        "> 回复状态：timeout\n" +
        "> 详情：\n" +
        "> Timed out\n" +
        "> after three minutes.",
    );
  });

  it("retains partial response text and appends its non-terminal capture status", () => {
    const detail = createDetail();
    const latest = detail.turns.find(({ turn }) => turn.id === "turn-2")!;
    latest.exchanges[1] = exchange({
      id: "exchange-partial",
      turnId: "turn-2",
      panelId: "panel-kimi",
      providerId: "kimi",
      providerName: "Kimi",
      targetIndex: 0,
      submitStatus: "submitted",
      responseStatus: "partial",
      responseText: "Partial but complete text preservation.\nSecond line.",
    });

    const markdown = renderProviderLatestExchangeMarkdown(detail, { providerId: "kimi" });
    expect(markdown).toContain("Partial but complete text preservation.\nSecond line.");
    expect(markdown).toContain("> 回复采集尚未完成。");
    expect(markdown).toContain("> 回复状态：partial");
  });

  it("keeps the terminal revision Markdown intact and records an interrupted reason", () => {
    const detail = createDetail();
    const latest = detail.turns.find(({ turn }) => turn.id === "turn-2")!;
    latest.exchanges[1] = exchange({
      id: "exchange-interrupted",
      turnId: "turn-2",
      panelId: "panel-kimi",
      providerId: "kimi",
      providerName: "Kimi",
      targetIndex: 0,
      submitStatus: "submitted",
      responseStatus: "partial",
      terminalReason: "interrupted",
      captureId: "capture-1",
      responseRevision: 8,
      responseText: "LINE-001\nMID-SENTINEL\nEND-SENTINEL",
      responseMarkdown: "# 完整回答\n\nLINE-001\n\nMID-SENTINEL\n\nEND-SENTINEL",
    });

    const artifact = createProviderLatestExchangeTranscript(detail, { providerId: "kimi" });
    expect(artifact.text).toContain("# 完整回答\n\nLINE-001\n\nMID-SENTINEL\n\nEND-SENTINEL");
    expect(artifact.text).toContain("> 回复已停止，已保留停止前的内容。");
    expect(artifact.text).toContain("> 终止原因：用户停止");
  });

  it("uses the original question for navigation text and prefers captured Markdown", () => {
    const detail = createDetail();
    const latest = detail.turns.find(({ turn }) => turn.id === "turn-2")!;
    latest.turn.userQuestion = "Original short question";
    latest.turn.prompt = "Template\nInstructions\n\n用户\nOriginal short question";
    latest.exchanges[0]!.responseText = "plain fallback";
    latest.exchanges[0]!.responseMarkdown = "## Structured answer";

    const markdown = renderProviderLatestExchangeMarkdown(detail, { providerId: "deepseek" });
    expect(markdown).toContain("## 用户：Original short question");
    expect(markdown).toContain("Template\nInstructions");
    expect(markdown).toContain("## Structured answer");
    expect(markdown).not.toContain("plain fallback");
  });

  it("returns clipboard and download-ready artifacts for every scope", () => {
    const detail = createDetail();
    const artifacts = [
      createSessionTranscript(detail),
      createLatestTurnTranscript(detail),
      createOpenProvidersConversationTranscript(detail, [{ providerId: "kimi" }]),
      createProviderConversationTranscript(detail, { providerId: "kimi" }),
      createProviderLatestExchangeTranscript(detail, { providerId: "deepseek" }),
    ];

    expect(artifacts.map((artifact) => artifact.filename)).toEqual([
      "Research session.md",
      "Research session-最新一轮.md",
      "Research session-当前站点完整对话.md",
      "Research session-Kimi-完整对话.md",
      "Research session-DeepSeek-最新回复.md",
    ]);
    expect(artifacts.every((artifact) => artifact.text.startsWith("# Research session\n"))).toBe(
      true,
    );
    expect(artifacts.every((artifact) => artifact.mimeType === MARKDOWN_TRANSCRIPT_MIME_TYPE)).toBe(
      true,
    );
  });

  it("creates safe bounded Markdown filenames on Windows and other desktop platforms", () => {
    expect(createSafeMarkdownFilename('  A: report / "draft"?  ', "Kimi*latest")).toBe(
      "A-report-draft-Kimi-latest.md",
    );
    expect(createSafeMarkdownFilename("CON")).toBe("_CON.md");
    expect(createSafeMarkdownFilename('<>:"/\\|?*')).toBe("multi-ai-transcript.md");
    expect(createSafeMarkdownFilename("x".repeat(200))).toBe(`${"x".repeat(120)}.md`);
  });

  it("returns a deterministic notice when a scope contains no matching conversation", () => {
    const detail = createDetail();
    detail.turns = [];
    expect(renderSessionMarkdown(detail)).toBe(
      "# Research session\n\n> 当前导出范围内没有可用的会话内容。\n",
    );
    expect(renderLatestTurnMarkdown(detail)).toBe(renderSessionMarkdown(detail));
    expect(renderProviderConversationMarkdown(detail, { providerId: "qwen" })).toBe(
      renderSessionMarkdown(detail),
    );
    expect(renderOpenProvidersConversationMarkdown(detail, [{ providerId: "qwen" }])).toBe(
      renderSessionMarkdown(detail),
    );
    expect(renderProviderLatestExchangeMarkdown(detail, { providerId: "qwen" })).toBe(
      renderSessionMarkdown(detail),
    );
  });
});

function createDetail(): SessionDetail {
  const session: SessionRecord = {
    id: "session-1",
    title: "Research\n session",
    createdAt: "2026-08-30T10:00:00.000Z",
    contentUpdatedAt: "2026-08-30T10:02:00.000Z",
    lastOpenedAt: "2026-08-30T10:02:00.000Z",
    source: "local",
    workspace: {
      layoutMode: "tiles",
      panels: [],
      updatedAt: "2026-08-30T10:02:00.000Z",
    },
  };
  const first = turn({
    id: "turn-1",
    sequence: 1,
    prompt: "First question\nwith every line.",
    createdAt: "2026-08-30T10:00:00.000Z",
  });
  const second = turn({
    id: "turn-2",
    sequence: 2,
    prompt: "Second question",
    createdAt: "2026-08-30T10:01:00.000Z",
  });
  return {
    session,
    // Deliberately unsorted to prove deterministic turn ordering.
    turns: [
      {
        turn: second,
        exchanges: [
          exchange({
            id: "exchange-deepseek-2",
            turnId: second.id,
            panelId: "panel-deepseek",
            providerId: "deepseek",
            providerName: "DeepSeek",
            targetIndex: 1,
            responseText: "DeepSeek second response.",
          }),
          exchange({
            id: "exchange-kimi-2",
            turnId: second.id,
            panelId: "panel-kimi",
            providerId: "kimi",
            providerName: "Kimi",
            targetIndex: 0,
            responseText: "Kimi second response.",
          }),
        ],
      },
      {
        turn: first,
        exchanges: [
          exchange({
            id: "exchange-kimi-1",
            turnId: first.id,
            panelId: "panel-kimi",
            providerId: "kimi",
            providerName: "Kimi",
            targetIndex: 1,
            responseText: "Kimi first response.",
          }),
          exchange({
            id: "exchange-deepseek-1",
            turnId: first.id,
            panelId: "panel-deepseek",
            providerId: "deepseek",
            providerName: "DeepSeek",
            targetIndex: 0,
            responseText: "DeepSeek first response.",
          }),
        ],
      },
    ],
  };
}

function turn(input: Pick<TurnRecord, "id" | "sequence" | "prompt" | "createdAt">): TurnRecord {
  return {
    ...input,
    sessionId: "session-1",
    status: "completed",
  };
}

function exchange(
  input: Pick<
    ProviderExchangeRecord,
    "id" | "turnId" | "panelId" | "providerId" | "providerName" | "targetIndex"
  > &
    Partial<ProviderExchangeRecord>,
): ProviderExchangeRecord {
  return {
    sessionId: "session-1",
    submitStatus: "submitted",
    responseStatus: "completed",
    ...input,
  };
}
