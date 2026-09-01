import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_TEMPLATE_CONTENT_LENGTH,
  MAX_USER_QUESTION_LENGTH,
  PromptValidationError,
  type PromptTemplate,
} from "./contracts";
import { composePrompt, snapshotSelectedPromptTemplates } from "./compose-prompt";

const templates: PromptTemplate[] = [
  {
    id: "a",
    name: "提示词 A",
    content: "先给出结论。",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "b",
    name: "提示词 B",
    content: "列出证据。",
    createdAt: 2,
    updatedAt: 2,
  },
  {
    id: "c",
    name: "提示词 C",
    content: "保持简洁。",
    createdAt: 3,
    updatedAt: 3,
  },
];

describe("prompt composition", () => {
  it("keeps the original payload when no template is selected", () => {
    expect(composePrompt({ templates: [], question: "  原始问题  " })).toBe("原始问题");
  });

  it("snapshots selected templates in library order", () => {
    expect(snapshotSelectedPromptTemplates(templates, ["c", "unknown", "a", "c"])).toEqual([
      { id: "a", name: "提示词 A", content: "先给出结论。" },
      { id: "c", name: "提示词 C", content: "保持简洁。" },
    ]);
  });

  it("composes deterministic sections followed by the user question", () => {
    const selected = snapshotSelectedPromptTemplates(templates, ["a", "c"]);

    expect(composePrompt({ templates: selected, question: "解释这段代码。" })).toBe(
      "提示词 A\n先给出结论。\n\n提示词 C\n保持简洁。\n\n用户\n解释这段代码。",
    );
  });

  it("normalizes outer whitespace and line endings", () => {
    expect(
      composePrompt({
        templates: [{ id: "a", name: "  模板  ", content: " 第一行\r\n第二行 \n" }],
        question: "  问题\r\n第二行  ",
      }),
    ).toBe("模板\n第一行\n第二行\n\n用户\n问题\n第二行");
  });

  it("rejects empty and overlong user questions", () => {
    expect(() => composePrompt({ templates: [], question: "   " })).toThrowError(
      expect.objectContaining({ code: "invalid-user-question" }),
    );
    expect(() =>
      composePrompt({ templates: [], question: "x".repeat(MAX_USER_QUESTION_LENGTH + 1) }),
    ).toThrowError(PromptValidationError);
  });

  it("rejects a composed prompt that exceeds the aggregate limit", () => {
    const oversizedSelection = Array.from({ length: 6 }, (_, index) => ({
      id: `template-${index}`,
      name: `Template ${index}`,
      content: "x".repeat(MAX_PROMPT_TEMPLATE_CONTENT_LENGTH),
    }));

    expect(() =>
      composePrompt({ templates: oversizedSelection, question: "question" }),
    ).toThrowError(expect.objectContaining({ code: "composed-prompt-too-long" }));
  });
});
