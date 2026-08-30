import { create } from "zustand";
import { browser } from "wxt/browser";
import { providerIds, type ProviderId } from "../../core/providers/contracts";
import { providerRegistry } from "../../core/providers/registry";
import type { SessionWorkspaceSnapshot } from "../../db/database";

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
  url: string;
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
  restoreSnapshot(snapshot: SessionWorkspaceSnapshot): void;
  movePanel(panelId: string, direction: -1 | 1): void;
  toggleTarget(panelId: string): void;
  setAllTargets(selected: boolean): void;
  refreshPanel(panelId: string): void;
  setPanelUrl(panelId: string, url: string): void;
  setPanelStatus(panelId: string, status: PanelStatus, message?: string): void;
  setSidebarOpen(open: boolean): void;
  setLayoutMode(mode: LayoutMode): void;
  setTileRatios(ratios: Record<string, number>): void;
}

const STORAGE_KEY = "workspace-v3";
const initialPanels: WorkspacePanel[] = (["deepseek", "kimi"] as const).map((providerId) =>
  createPanel(providerId),
);

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
        url: validProviderUrl(panel.providerId, panel.url)
          ? panel.url
          : providerRegistry.get(panel.providerId).definition.defaultUrl,
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
    await queuePersist(get());
  },

  addPanel(providerId) {
    if (get().panels.some((panel) => panel.providerId === providerId)) return;
    const panel = createPanel(providerId);
    set((state) => ({
      panels: [...state.panels, panel],
      selectedTargetIds: [...state.selectedTargetIds, panel.id],
    }));
    void queuePersist(get());
  },

  removePanel(panelId) {
    set((state) => ({
      panels: state.panels.filter((panel) => panel.id !== panelId),
      selectedTargetIds: state.selectedTargetIds.filter((id) => id !== panelId),
      tileRatios: Object.fromEntries(
        Object.entries(state.tileRatios).filter(([id]) => id !== panelId),
      ),
    }));
    void queuePersist(get());
  },

  setProviderOpen(providerId, open) {
    const existing = get().panels.find((panel) => panel.providerId === providerId);
    if (open && !existing) get().addPanel(providerId);
    if (!open && existing) get().removePanel(existing.id);
  },

  restoreSnapshot(snapshot) {
    const orderedPanels = snapshot.panels
      .toSorted((left, right) => left.order - right.order)
      .filter((panel) => validProviderUrl(panel.providerId, panel.url));
    const panels = orderedPanels.map((panel) =>
      createPanel(panel.providerId, panel.url, panel.panelId),
    );
    set({
      panels,
      selectedTargetIds: orderedPanels
        .filter((panel) => panel.selected)
        .map((panel) => panel.panelId),
      layoutMode: snapshot.layoutMode,
      tileRatios: Object.fromEntries(
        orderedPanels
          .filter((panel) => Number.isFinite(panel.widthRatio) && panel.widthRatio > 0)
          .map((panel) => [panel.panelId, panel.widthRatio]),
      ),
    });
    void queuePersist(get());
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
    void queuePersist(get());
  },

  toggleTarget(panelId) {
    set((state) => ({
      selectedTargetIds: state.selectedTargetIds.includes(panelId)
        ? state.selectedTargetIds.filter((id) => id !== panelId)
        : state.panels.some((panel) => panel.id === panelId)
          ? [...state.selectedTargetIds, panelId]
          : state.selectedTargetIds,
    }));
    void queuePersist(get());
  },

  setAllTargets(selected) {
    set((state) => ({
      selectedTargetIds: selected ? state.panels.map((panel) => panel.id) : [],
    }));
    void queuePersist(get());
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

  setPanelUrl(panelId, url) {
    const panel = get().panels.find((item) => item.id === panelId);
    if (!panel || panel.url === url || !validProviderUrl(panel.providerId, url)) return;
    set((state) => ({
      panels: state.panels.map((item) => (item.id === panelId ? { ...item, url } : item)),
    }));
    void queuePersist(get());
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
    void queuePersist(get());
  },

  setLayoutMode(layoutMode) {
    set({ layoutMode });
    void queuePersist(get());
  },

  setTileRatios(tileRatios) {
    set({ tileRatios });
    void queuePersist(get());
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

let persistQueue = Promise.resolve();

function queuePersist(state: PersistedWorkspace): Promise<void> {
  const snapshot: PersistedWorkspace = {
    panels: state.panels.map((panel) => ({ ...panel })),
    selectedTargetIds: [...(state.selectedTargetIds ?? [])],
    sidebarOpen: state.sidebarOpen,
    layoutMode: state.layoutMode,
    tileRatios: { ...state.tileRatios },
  };
  persistQueue = persistQueue.catch(() => undefined).then(() => persist(snapshot));
  return persistQueue;
}

function createPanel(
  providerId: ProviderId,
  url = providerRegistry.get(providerId).definition.defaultUrl,
  id: string = crypto.randomUUID(),
): WorkspacePanel {
  return {
    id,
    providerId,
    url,
    status: "loading",
    revision: 0,
  };
}

function validProviderUrl(providerId: ProviderId, url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return providerRegistry.match(url)?.definition.id === providerId;
  } catch {
    return false;
  }
}
