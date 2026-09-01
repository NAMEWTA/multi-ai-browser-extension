import { create } from "zustand";
import { browser } from "wxt/browser";
import {
  MAX_PROMPT_TEMPLATES,
  PROMPT_LIBRARY_VERSION,
  assertPromptLibraryCapacity,
  assertUniquePromptTemplateName,
  canonicalPromptTemplateName,
  normalizePromptTemplateInput,
  type PromptLibrarySnapshot,
  type PromptTemplate,
  type PromptTemplateInput,
  type PromptTemplateSnapshot,
} from "../../core/prompts/contracts";
import { snapshotSelectedPromptTemplates } from "../../core/prompts/compose-prompt";

export const PROMPT_LIBRARY_STORAGE_KEY = "prompt-library-v1";

export interface PromptLibraryState {
  templates: PromptTemplate[];
  selectedTemplateIds: string[];
  hydrated: boolean;
  storageError: string | null;
  hydrate(): Promise<void>;
  addTemplate(input: PromptTemplateInput): PromptTemplate;
  updateTemplate(templateId: string, input: PromptTemplateInput): void;
  removeTemplate(templateId: string): void;
  moveTemplate(templateId: string, direction: -1 | 1): void;
  setTemplateSelected(templateId: string, selected: boolean): void;
  toggleTemplate(templateId: string): void;
  setAllTemplatesSelected(selected: boolean): void;
  snapshotSelection(): PromptTemplateSnapshot[];
}

export const usePromptLibraryStore = create<PromptLibraryState>((set, get) => ({
  templates: [],
  selectedTemplateIds: [],
  hydrated: false,
  storageError: null,

  async hydrate() {
    try {
      const result = await browser.storage.local.get(PROMPT_LIBRARY_STORAGE_KEY);
      const raw = result[PROMPT_LIBRARY_STORAGE_KEY];
      const snapshot = sanitizePersistedSnapshot(raw);
      set({
        templates: snapshot.templates.map((template) => ({ ...template })),
        selectedTemplateIds: [...snapshot.selectedTemplateIds],
        hydrated: true,
        storageError: null,
      });

      if (!isCurrentSnapshot(raw, snapshot)) {
        await queuePersist(snapshot);
      }
    } catch (error) {
      set({ hydrated: true, storageError: errorMessage(error) });
    }
  },

  addTemplate(input) {
    const normalized = normalizePromptTemplateInput(input);
    const state = get();
    assertPromptLibraryCapacity(state.templates.length);
    assertUniquePromptTemplateName(state.templates, normalized.name);
    const now = Date.now();
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };
    set({ templates: [...state.templates, template] });
    schedulePersist(set, get);
    return template;
  },

  updateTemplate(templateId, input) {
    const state = get();
    const existing = state.templates.find((template) => template.id === templateId);
    if (!existing) return;
    const normalized = normalizePromptTemplateInput(input);
    assertUniquePromptTemplateName(state.templates, normalized.name, templateId);
    set({
      templates: state.templates.map((template) =>
        template.id === templateId
          ? { ...template, ...normalized, updatedAt: Date.now() }
          : template,
      ),
    });
    schedulePersist(set, get);
  },

  removeTemplate(templateId) {
    const state = get();
    if (!state.templates.some((template) => template.id === templateId)) return;
    set({
      templates: state.templates.filter((template) => template.id !== templateId),
      selectedTemplateIds: state.selectedTemplateIds.filter((id) => id !== templateId),
    });
    schedulePersist(set, get);
  },

  moveTemplate(templateId, direction) {
    const state = get();
    const templates = [...state.templates];
    const index = templates.findIndex((template) => template.id === templateId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= templates.length) return;
    const [template] = templates.splice(index, 1);
    if (!template) return;
    templates.splice(destination, 0, template);
    set({
      templates,
      selectedTemplateIds: orderSelectedIds(templates, state.selectedTemplateIds),
    });
    schedulePersist(set, get);
  },

  setTemplateSelected(templateId, selected) {
    const state = get();
    if (!state.templates.some((template) => template.id === templateId)) return;
    const selectedIds = new Set(state.selectedTemplateIds);
    if (selected) selectedIds.add(templateId);
    else selectedIds.delete(templateId);
    set({ selectedTemplateIds: orderSelectedIds(state.templates, selectedIds) });
    schedulePersist(set, get);
  },

  toggleTemplate(templateId) {
    const state = get();
    state.setTemplateSelected(templateId, !state.selectedTemplateIds.includes(templateId));
  },

  setAllTemplatesSelected(selected) {
    const state = get();
    set({ selectedTemplateIds: selected ? state.templates.map((template) => template.id) : [] });
    schedulePersist(set, get);
  },

  snapshotSelection() {
    const state = get();
    return snapshotSelectedPromptTemplates(state.templates, state.selectedTemplateIds);
  },
}));

export function waitForPromptLibraryPersistence(): Promise<void> {
  return persistQueue;
}

function schedulePersist(
  set: (partial: Partial<PromptLibraryState>) => void,
  get: () => PromptLibraryState,
): void {
  const pending = queuePersist(createSnapshot(get()));
  void pending.then(
    () => set({ storageError: null }),
    (error: unknown) => set({ storageError: errorMessage(error) }),
  );
}

function createSnapshot(state: Pick<PromptLibraryState, "templates" | "selectedTemplateIds">) {
  return {
    version: PROMPT_LIBRARY_VERSION,
    templates: state.templates.map((template) => ({ ...template })),
    selectedTemplateIds: [...state.selectedTemplateIds],
  } satisfies PromptLibrarySnapshot;
}

async function persist(snapshot: PromptLibrarySnapshot): Promise<void> {
  await browser.storage.local.set({ [PROMPT_LIBRARY_STORAGE_KEY]: snapshot });
}

let persistQueue = Promise.resolve();

function queuePersist(snapshot: PromptLibrarySnapshot): Promise<void> {
  persistQueue = persistQueue.catch(() => undefined).then(() => persist(snapshot));
  return persistQueue;
}

function sanitizePersistedSnapshot(raw: unknown): PromptLibrarySnapshot {
  if (!isRecord(raw) || !Array.isArray(raw.templates)) {
    return { version: PROMPT_LIBRARY_VERSION, templates: [], selectedTemplateIds: [] };
  }

  const templates: PromptTemplate[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of raw.templates.slice(0, MAX_PROMPT_TEMPLATES)) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
    const id = candidate.id.trim();
    if (!id || ids.has(id)) continue;
    if (typeof candidate.name !== "string" || typeof candidate.content !== "string") continue;
    try {
      const normalized = normalizePromptTemplateInput({
        name: candidate.name,
        content: candidate.content,
      });
      const canonicalName = canonicalPromptTemplateName(normalized.name);
      if (names.has(canonicalName)) continue;
      const createdAt = validTimestamp(candidate.createdAt) ? candidate.createdAt : 0;
      const updatedAt = validTimestamp(candidate.updatedAt) ? candidate.updatedAt : createdAt;
      templates.push({ id, ...normalized, createdAt, updatedAt });
      ids.add(id);
      names.add(canonicalName);
    } catch {
      // Ignore invalid or overlong persisted templates instead of breaking the workspace.
    }
  }

  const rawSelectedIds = Array.isArray(raw.selectedTemplateIds)
    ? raw.selectedTemplateIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    version: PROMPT_LIBRARY_VERSION,
    templates,
    selectedTemplateIds: orderSelectedIds(templates, rawSelectedIds),
  };
}

function orderSelectedIds(
  templates: readonly PromptTemplate[],
  selectedTemplateIds: Iterable<string>,
): string[] {
  const selectedIds = new Set(selectedTemplateIds);
  return templates
    .filter((template) => selectedIds.has(template.id))
    .map((template) => template.id);
}

function isCurrentSnapshot(raw: unknown, snapshot: PromptLibrarySnapshot): boolean {
  if (!isRecord(raw) || raw.version !== PROMPT_LIBRARY_VERSION) return false;
  try {
    return JSON.stringify(raw) === JSON.stringify(snapshot);
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
