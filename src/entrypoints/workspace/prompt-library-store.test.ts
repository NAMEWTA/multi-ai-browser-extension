import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROMPT_TEMPLATES,
  PromptValidationError,
  type PromptTemplate,
} from "../../core/prompts/contracts";

const { storageGet, storageSet } = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: { get: storageGet, set: storageSet },
    },
  },
}));

import {
  PROMPT_LIBRARY_STORAGE_KEY,
  usePromptLibraryStore,
  waitForPromptLibraryPersistence,
} from "./prompt-library-store";

describe("prompt library store", () => {
  beforeEach(async () => {
    await waitForPromptLibraryPersistence().catch(() => undefined);
    storageGet.mockReset();
    storageSet.mockReset();
    storageSet.mockResolvedValue(undefined);
    usePromptLibraryStore.setState({
      templates: [],
      selectedTemplateIds: [],
      hydrated: false,
      storageError: null,
    });
  });

  it("hydrates templates, repairs duplicates, and orders selected IDs by library order", async () => {
    storageGet.mockResolvedValue({
      [PROMPT_LIBRARY_STORAGE_KEY]: {
        version: 1,
        templates: [
          { id: "a", name: " A ", content: " first ", createdAt: 1, updatedAt: 2 },
          { id: "b", name: "B", content: "second", createdAt: 3, updatedAt: 4 },
          { id: "duplicate", name: "a", content: "ignored", createdAt: 5, updatedAt: 6 },
          { id: "invalid", name: "", content: "ignored", createdAt: 7, updatedAt: 8 },
        ],
        selectedTemplateIds: ["b", "missing", "a"],
      },
    });

    await usePromptLibraryStore.getState().hydrate();

    expect(usePromptLibraryStore.getState()).toMatchObject({
      hydrated: true,
      storageError: null,
      selectedTemplateIds: ["a", "b"],
    });
    expect(
      usePromptLibraryStore.getState().templates.map(({ id, name, content }) => ({
        id,
        name,
        content,
      })),
    ).toEqual([
      { id: "a", name: "A", content: "first" },
      { id: "b", name: "B", content: "second" },
    ]);
    expect(storageSet).toHaveBeenCalledOnce();
  });

  it("supports CRUD, stable movement, multi-selection, and persisted snapshots", async () => {
    const store = usePromptLibraryStore.getState();
    const first = store.addTemplate({ name: "A", content: "first" });
    const second = store.addTemplate({ name: "B", content: "second" });
    store.setTemplateSelected(second.id, true);
    store.setTemplateSelected(first.id, true);
    store.moveTemplate(second.id, -1);
    store.updateTemplate(first.id, { name: "A updated", content: "new first" });

    expect(usePromptLibraryStore.getState().templates.map((template) => template.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(usePromptLibraryStore.getState().selectedTemplateIds).toEqual([second.id, first.id]);
    expect(usePromptLibraryStore.getState().snapshotSelection()).toEqual([
      { id: second.id, name: "B", content: "second" },
      { id: first.id, name: "A updated", content: "new first" },
    ]);

    store.removeTemplate(second.id);
    await waitForPromptLibraryPersistence();

    expect(usePromptLibraryStore.getState().templates).toHaveLength(1);
    expect(usePromptLibraryStore.getState().selectedTemplateIds).toEqual([first.id]);
    expect(storageSet).toHaveBeenLastCalledWith({
      [PROMPT_LIBRARY_STORAGE_KEY]: expect.objectContaining({
        version: 1,
        selectedTemplateIds: [first.id],
      }),
    });
  });

  it("rejects case-insensitive duplicate names without mutating state", () => {
    const store = usePromptLibraryStore.getState();
    store.addTemplate({ name: "Review", content: "first" });

    expect(() => store.addTemplate({ name: " review ", content: "second" })).toThrowError(
      expect.objectContaining({ code: "duplicate-template-name" }),
    );
    expect(usePromptLibraryStore.getState().templates).toHaveLength(1);
    expect(() => store.addTemplate({ name: "", content: "content" })).toThrowError(
      PromptValidationError,
    );
  });

  it("surfaces storage failures without losing in-memory edits", async () => {
    storageSet.mockRejectedValueOnce(new Error("storage unavailable"));

    usePromptLibraryStore.getState().addTemplate({ name: "A", content: "first" });
    await waitForPromptLibraryPersistence().catch(() => undefined);

    expect(usePromptLibraryStore.getState().templates).toHaveLength(1);
    expect(usePromptLibraryStore.getState().storageError).toBe("storage unavailable");
  });

  it("rejects additions after reaching the template limit", () => {
    const templates: PromptTemplate[] = Array.from(
      { length: MAX_PROMPT_TEMPLATES },
      (_, index) => ({
        id: `template-${index}`,
        name: `Template ${index}`,
        content: "content",
        createdAt: index,
        updatedAt: index,
      }),
    );
    usePromptLibraryStore.setState({ templates });

    expect(() =>
      usePromptLibraryStore.getState().addTemplate({ name: "One more", content: "content" }),
    ).toThrowError(expect.objectContaining({ code: "template-limit-reached" }));
    expect(usePromptLibraryStore.getState().templates).toHaveLength(MAX_PROMPT_TEMPLATES);
  });
});
