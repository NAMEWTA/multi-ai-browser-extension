import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { providerIds, type ProviderId } from "../../core/providers/contracts";

const { storageGet, storageSet } = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: { get: storageGet, set: storageSet },
      session: { get: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

import { TargetSelector } from "./workspace-app";
import { useWorkspaceStore, type WorkspacePanel } from "./workspace-store";

describe("workspace targets", () => {
  beforeEach(() => {
    storageGet.mockReset();
    storageSet.mockReset();
  });

  it("migrates legacy panel enabled flags into independent target IDs", async () => {
    storageGet.mockResolvedValue({
      "workspace-v3": {
        panels: [
          {
            id: "deepseek-panel",
            providerId: "deepseek",
            enabled: true,
            status: "ready",
            revision: 0,
          },
          { id: "kimi-panel", providerId: "kimi", enabled: false, status: "ready", revision: 0 },
        ],
        sidebarOpen: true,
        layoutMode: "columns",
        tileRatios: {},
      },
    });
    useWorkspaceStore.setState({ hydrated: false, panels: [], selectedTargetIds: [] });

    await act(async () => useWorkspaceStore.getState().hydrate());

    expect(useWorkspaceStore.getState().panels).toHaveLength(2);
    expect(useWorkspaceStore.getState().selectedTargetIds).toEqual(["deepseek-panel"]);
    expect(useWorkspaceStore.getState().layoutMode).toBe("tiles");
  });

  it("preserves an intentionally empty workspace", async () => {
    storageGet.mockResolvedValue({
      "workspace-v3": {
        panels: [],
        selectedTargetIds: [],
        sidebarOpen: false,
        layoutMode: "adaptive",
        tileRatios: {},
      },
    });
    useWorkspaceStore.setState({ hydrated: false });

    await act(async () => useWorkspaceStore.getState().hydrate());

    expect(useWorkspaceStore.getState().panels).toEqual([]);
    expect(useWorkspaceStore.getState().selectedTargetIds).toEqual([]);
    expect(useWorkspaceStore.getState().sidebarOpen).toBe(false);
  });

  it("keeps the composer summary compact with eleven open websites", () => {
    const panels: WorkspacePanel[] = Array.from({ length: 11 }, (_, index) => ({
      id: `panel-${index}`,
      providerId: providerIds[index % providerIds.length] as ProviderId,
      status: "ready",
      revision: 0,
    }));
    useWorkspaceStore.setState({
      hydrated: true,
      panels,
      selectedTargetIds: panels.map((panel) => panel.id),
    });

    render(<TargetSelector panels={panels} />);
    expect(
      screen.getByRole("button", { name: "选择发送目标，已选择 11 个，共 11 个" }),
    ).toHaveTextContent(/发送至 11\s*\/\s*11/);

    fireEvent.click(screen.getByRole("button", { name: /选择发送目标/ }));
    expect(screen.getByRole("dialog", { name: "选择发送目标" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索发送目标" })).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(11);
  });
});
