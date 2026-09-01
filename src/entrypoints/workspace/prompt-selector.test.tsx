import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(
      screen.getByRole("dialog", { name: "预览实际发送内容" }).querySelector("pre")?.textContent,
    ).toBe(
      "```提示词A\n使用表格回答\n```\n\n```提示词C\n保持简洁\n```\n\n```用户\n解释 Go channel\n```",
    );
  });

  it("clears selected templates without deleting them", () => {
    render(<PromptSelector question="问题" />);
    fireEvent.click(screen.getByRole("button", { name: /提示词 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "清空" }));

    expect(usePromptLibraryStore.getState().selectedTemplateIds).toEqual([]);
    expect(usePromptLibraryStore.getState().templates).toHaveLength(3);
  });

  it("shows only the management entry when the prompt library is empty", () => {
    usePromptLibraryStore.setState({ templates: [], selectedTemplateIds: [] });
    render(<PromptSelector question="问题" />);

    fireEvent.click(screen.getByRole("button", { name: /提示词 0/ }));
    const selector = screen.getByRole("dialog", { name: "选择提示词" });
    expect(within(selector).getByText("还没有维护提示词")).toBeVisible();
    expect(within(selector).queryByRole("button", { name: "全选" })).not.toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: "清空" })).not.toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: "预览" })).not.toBeInTheDocument();

    fireEvent.click(within(selector).getByRole("button", { name: "管理提示词" }));
    expect(screen.getByRole("dialog", { name: "管理提示词" })).toBeVisible();
  });
});
