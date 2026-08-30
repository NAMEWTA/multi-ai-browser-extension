import { create } from "zustand";
import { browser } from "wxt/browser";
import { providerIds, type ProviderId } from "../../core/providers/contracts";

export type PanelStatus =
  | "loading"
  | "needs-login"
  | "blocked"
  | "ready"
  | "submitting"
  | "submitted"
  | "error"
  | "unavailable";
export type LayoutMode = "tiles" | "adaptive";

export interface WorkspacePanel {
  id: string;
  providerId: ProviderId;
  status: PanelStatus;
  revision: number;
  message?: string | undefined;
}

interface PersistedWorkspace {
  panels: Array<WorkspacePanel & { enabled?: boolean }>;
  selectedTargetIds?: string[];
  sidebarOpen: boolean;
  layoutMode: LayoutMode | "columns" | "grid";
  tileRatios: Record<string, number>;
}

interface WorkspaceState extends Omit<
  PersistedWorkspace,
  "layoutMode" | "panels" | "selectedTargetIds"
> {
  panels: WorkspacePanel[];
  selectedTargetIds: string[];
  layoutMode: LayoutMode;
  hydrated: boolean;
  hydrate(): Promise<void>;
  addPanel(providerId: ProviderId): void;
  removePanel(panelId: string): void;
  setProviderOpen(providerId: ProviderId, open: boolean): void;
  movePanel(panelId: string, direction: -1 | 1): void;
  toggleTarget(panelId: string): void;
  setAllTargets(selected: boolean): void;
  refreshPanel(panelId: string): void;
  setPanelStatus(panelId: string, status: PanelStatus, message?: string): void;
  setSidebarOpen(open: boolean): void;
  setLayoutMode(mode: LayoutMode): void;
  setTileRatios(ratios: Record<string, number>): void;
}

const STORAGE_KEY = "workspace-v3";
const initialPanels: WorkspacePanel[] = (["deepseek", "kimi"] as const).map(createPanel);

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  panels: initialPanels,
  selectedTargetIds: initialPanels.map((panel) => panel.id),
  sidebarOpen: true,
  layoutMode: "tiles",
  tileRatios: {},
  hydrated: false,

  async hydrate() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const persisted = result[STORAGE_KEY] as PersistedWorkspace | undefined;
    const persistedPanels = persisted?.panels ?? [];
    const panels = persistedPanels
      .filter((panel) => providerIds.includes(panel.providerId))
      .map((panel) => ({
        id: panel.id,
        providerId: panel.providerId,
        status: panel.status,
        revision: panel.revision,
        ...(panel.message ? { message: panel.message } : {}),
      }));
    if (persisted) {
      const panelIds = new Set(panels.map((panel) => panel.id));
      const selectedTargetIds = Array.isArray(persisted?.selectedTargetIds)
        ? persisted.selectedTargetIds.filter((panelId) => panelIds.has(panelId))
        : persistedPanels
            .filter((panel) => panel.enabled !== false && panelIds.has(panel.id))
            .map((panel) => panel.id);
      set({
        panels,
        selectedTargetIds,
        sidebarOpen: persisted?.sidebarOpen ?? true,
        layoutMode:
          persisted?.layoutMode === "adaptive" || persisted?.layoutMode === "grid"
            ? "adaptive"
            : "tiles",
        tileRatios: persisted?.tileRatios ?? {},
        hydrated: true,
      });
      return;
    }
    set({ hydrated: true });
    await persist(get());
  },

  addPanel(providerId) {
    if (get().panels.some((panel) => panel.providerId === providerId)) return;
    const panel = createPanel(providerId);
    set((state) => ({
      panels: [...state.panels, panel],
      selectedTargetIds: [...state.selectedTargetIds, panel.id],
    }));
    void persist(get());
  },

  removePanel(panelId) {
    set((state) => ({
      panels: state.panels.filter((panel) => panel.id !== panelId),
      selectedTargetIds: state.selectedTargetIds.filter((id) => id !== panelId),
      tileRatios: Object.fromEntries(
        Object.entries(state.tileRatios).filter(([id]) => id !== panelId),
      ),
    }));
    void persist(get());
  },

  setProviderOpen(providerId, open) {
    const existing = get().panels.find((panel) => panel.providerId === providerId);
    if (open && !existing) get().addPanel(providerId);
    if (!open && existing) get().removePanel(existing.id);
  },

  movePanel(panelId, direction) {
    set((state) => {
      const panels = [...state.panels];
      const index = panels.findIndex((panel) => panel.id === panelId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= panels.length) return state;
      const [panel] = panels.splice(index, 1);
      if (panel) panels.splice(target, 0, panel);
      return { panels };
    });
    void persist(get());
  },

  toggleTarget(panelId) {
    set((state) => ({
      selectedTargetIds: state.selectedTargetIds.includes(panelId)
        ? state.selectedTargetIds.filter((id) => id !== panelId)
        : state.panels.some((panel) => panel.id === panelId)
          ? [...state.selectedTargetIds, panelId]
          : state.selectedTargetIds,
    }));
    void persist(get());
  },

  setAllTargets(selected) {
    set((state) => ({
      selectedTargetIds: selected ? state.panels.map((panel) => panel.id) : [],
    }));
    void persist(get());
  },

  refreshPanel(panelId) {
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId
          ? {
              ...panel,
              revision: panel.revision + 1,
              status: "loading",
              message: undefined as string | undefined,
            }
          : panel,
      ),
    }));
  },

  setPanelStatus(panelId, status, message) {
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId
          ? {
              ...panel,
              status,
              ...(message ? { message } : { message: undefined as string | undefined }),
            }
          : panel,
      ),
    }));
  },

  setSidebarOpen(sidebarOpen) {
    set({ sidebarOpen });
    void persist(get());
  },

  setLayoutMode(layoutMode) {
    set({ layoutMode });
    void persist(get());
  },

  setTileRatios(tileRatios) {
    set({ tileRatios });
    void persist(get());
  },
}));

async function persist(state: PersistedWorkspace): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: {
      panels: state.panels,
      selectedTargetIds: state.selectedTargetIds,
      sidebarOpen: state.sidebarOpen,
      layoutMode: state.layoutMode,
      tileRatios: state.tileRatios,
    },
  });
}

function createPanel(providerId: ProviderId): WorkspacePanel {
  return {
    id: crypto.randomUUID(),
    providerId,
    status: "loading",
    revision: 0,
  };
}
