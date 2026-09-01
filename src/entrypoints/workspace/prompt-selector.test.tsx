import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { PromptTemplate } from "../../core/prompts/contracts";
import { PromptSelector } from "./prompt-selector";
import { usePromptLibraryStore } from "./prompt-library-store";

const templates: PromptTemplate[] = [
  { id: "a", name: "提示词A", content: "使用表格回答", createdAt: 1, updatedAt: 1 },
  { id: "b", name: "提示词B", content: "给出更多例子", createdAt: 2, updatedAt: 2 },
  { id: "c", name: "提示词C", content: "保持简洁", createdAt: 3, updatedAt: 3 },
];

describe("PromptSelector", () => {
  beforeEach(() => {
    usePromptLibraryStore.setState({
      templates,
      selectedTemplateIds: ["a", "c"],
      hydrated: true,
      storageError: null,
    });
  });

  it("multi-selects templates and previews the exact deterministic payload", () => {
    render(<PromptSelector question="解释 Go channel" />);

    fireEvent.click(screen.getByRole("button", { name: /提示词 2/ }));
    expect(screen.getByRole("checkbox", { name: /提示词A/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /提示词B/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /提示词C/ })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("dialog", { name: "预览实际发送内容" })).toHaveTextContent(
      "提示词A 使用表格回答 提示词C 保持简洁 用户 解释 Go channel",
    );
  });

  it("clears selected templates without deleting them", () => {
    render(<PromptSelector question="问题" />);
    fireEvent.click(screen.getByRole("button", { name: /提示词 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "清空" }));

    expect(usePromptLibraryStore.getState().selectedTemplateIds).toEqual([]);
    expect(usePromptLibraryStore.getState().templates).toHaveLength(3);
  });
});
