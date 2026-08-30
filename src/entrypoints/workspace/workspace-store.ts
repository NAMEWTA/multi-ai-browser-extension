import { create } from "zustand";
import { browser } from "wxt/browser";
import { providerIds, type ProviderId } from "../../core/providers/contracts";

export type PanelStatus =
  | "loading"
  | "needs-login"
  | "blocked"
  | "ready"
  | "syncing"
  | "submitting"
  | "submitted"
  | "error"
  | "unavailable";
export type LayoutMode = "tiles" | "adaptive";

export interface WorkspacePanel {
  id: string;
  providerId: ProviderId;
  enabled: boolean;
  status: PanelStatus;
  revision: number;
  message?: string | undefined;
}

interface PersistedWorkspace {
  panels: WorkspacePanel[];
  sidebarOpen: boolean;
  layoutMode: LayoutMode | "columns" | "grid";
  tileRatios: Record<string, number>;
}

interface WorkspaceState extends Omit<PersistedWorkspace, "layoutMode"> {
  layoutMode: LayoutMode;
  hydrated: boolean;
  hydrate(): Promise<void>;
  addPanel(providerId: ProviderId): void;
  removePanel(panelId: string): void;
  movePanel(panelId: string, direction: -1 | 1): void;
  togglePanel(panelId: string): void;
  refreshPanel(panelId: string): void;
  setPanelStatus(panelId: string, status: PanelStatus, message?: string): void;
  setSidebarOpen(open: boolean): void;
  setLayoutMode(mode: LayoutMode): void;
  setTileRatios(ratios: Record<string, number>): void;
}

const STORAGE_KEY = "workspace-v3";
const initialPanels: WorkspacePanel[] = (["deepseek", "kimi"] as const).map((providerId) => ({
  id: crypto.randomUUID(),
  providerId,
  enabled: true,
  status: "loading",
  revision: 0,
}));

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  panels: initialPanels,
  sidebarOpen: true,
  layoutMode: "tiles",
  tileRatios: {},
  hydrated: false,

  async hydrate() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const persisted = result[STORAGE_KEY] as PersistedWorkspace | undefined;
    const panels = persisted?.panels?.filter((panel) => providerIds.includes(panel.providerId));
    if (panels?.length) {
      set({
        panels,
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
    set((state) => ({
      panels: [
        ...state.panels,
        {
          id: crypto.randomUUID(),
          providerId,
          enabled: true,
          status: "loading",
          revision: 0,
        },
      ],
    }));
    void persist(get());
  },

  removePanel(panelId) {
    set((state) => ({ panels: state.panels.filter((panel) => panel.id !== panelId) }));
    void persist(get());
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

  togglePanel(panelId) {
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId ? { ...panel, enabled: !panel.enabled } : panel,
      ),
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
      sidebarOpen: state.sidebarOpen,
      layoutMode: state.layoutMode,
      tileRatios: state.tileRatios,
    },
  });
}
