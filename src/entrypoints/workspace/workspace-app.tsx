import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Columns3,
  Download,
  ExternalLink,
  Grid2X2,
  History,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Scaling,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import type { ProviderRunResult } from "../../core/messaging/protocol";
import {
  workspaceFrameStatusSchema,
  workspaceResponseUpdateSchema,
} from "../../core/messaging/protocol";
import { providerRegistry } from "../../core/providers/registry";
import type { ProviderDefinition } from "../../core/providers/contracts";
import type { ProviderExchangeRecord, SessionRecord } from "../../db/database";
import {
  applyResponseUpdate,
  applySubmitResults,
  createSession,
  createTurn,
  deleteSession,
  ensureActiveSession,
  getSessionDetail,
  listSessions,
  migrateLegacyHistory,
  type SessionDetail,
} from "../../db/session-service";
import {
  exportHistoryJsonl,
  HISTORY_FILE_EXTENSION,
  importHistoryJsonl,
  MAX_HISTORY_IMPORT_BYTES,
} from "../../db/history-transfer";
import { useWorkspaceStore, type WorkspacePanel } from "./workspace-store";

export function WorkspaceApp() {
  const panels = useWorkspaceStore((state) => state.panels);
  const selectedTargetIds = useWorkspaceStore((state) => state.selectedTargetIds);
  const sidebarOpen = useWorkspaceStore((state) => state.sidebarOpen);
  const layoutMode = useWorkspaceStore((state) => state.layoutMode);
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const setSidebarOpen = useWorkspaceStore((state) => state.setSidebarOpen);
  const setLayoutMode = useWorkspaceStore((state) => state.setLayoutMode);
  const setPanelStatus = useWorkspaceStore((state) => state.setPanelStatus);
  const [prompt, setPrompt] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [maximized, setMaximized] = useState<string>();
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [details, setDetails] = useState<SessionDetail>();
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(async () => {
    setHistory(await listSessions());
  }, []);

  useEffect(() => {
    let mounted = true;
    void hydrate();
    void migrateLegacyHistory()
      .then(() => listSessions())
      .then((records) => {
        if (mounted) setHistory(records);
      });
    void browser.runtime.sendMessage({ type: "WORKSPACE_READY" }).then((response) => {
      if (mounted && (response as { ok?: boolean } | undefined)?.ok) setRuntimeReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [hydrate, refreshHistory]);

  useEffect(() => {
    const listener = (raw: unknown) => {
      const frameStatus = workspaceFrameStatusSchema.safeParse(raw);
      if (frameStatus.success) {
        const current = useWorkspaceStore
          .getState()
          .panels.find((panel) => panel.id === frameStatus.data.panelId);
        if (
          frameStatus.data.status === "ready" &&
          current &&
          current.status !== "loading" &&
          current.status !== "needs-login" &&
          current.status !== "blocked"
        ) {
          return { ok: true };
        }
        setPanelStatus(frameStatus.data.panelId, frameStatus.data.status, frameStatus.data.message);
        return { ok: true };
      }

      const response = workspaceResponseUpdateSchema.safeParse(raw);
      if (!response.success) return undefined;
      const data = response.data;
      setPanelStatus(
        data.panelId,
        data.status === "waiting" || data.status === "streaming"
          ? "submitted"
          : data.status === "failed"
            ? "error"
            : "ready",
        data.message,
      );
      void applyResponseUpdate(
        data.turnId,
        data.panelId,
        data.status,
        data.text,
        data.message,
      ).then(async () => {
        await refreshHistory();
        if (details?.session.id === data.sessionId)
          setDetails(await getSessionDetail(data.sessionId));
      });
      return { ok: true };
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [details?.session.id, refreshHistory, setPanelStatus]);

  const activeMaximized = panels.some((panel) => panel.id === maximized) ? maximized : undefined;
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    if (!query) return history;
    return history.filter(
      (record) =>
        record.title.toLocaleLowerCase().includes(query) ||
        record.status.toLocaleLowerCase().includes(query),
    );
  }, [history, historyQuery]);

  function currentTargets() {
    const state = useWorkspaceStore.getState();
    return state.panels
      .filter((panel) => state.selectedTargetIds.includes(panel.id))
      .map((panel) => {
        const definition = providerRegistry.get(panel.providerId).definition;
        return {
          panelId: panel.id,
          providerId: panel.providerId,
          url: definition.defaultUrl,
        };
      });
  }

  async function submitPrompt() {
    const text = prompt.trim();
    const targets = currentTargets();
    if (!text || !targets.length || sending) return;
    const session = await ensureActiveSession(text);
    const turn = await createTurn(
      session.id,
      text,
      targets.map((target) => ({
        panelId: target.panelId,
        providerId: target.providerId,
        providerName: providerRegistry.get(target.providerId).definition.name,
      })),
    );
    setSending(true);
    for (const target of targets) setPanelStatus(target.panelId, "submitting");
    try {
      const results = (await browser.runtime.sendMessage({
        type: "WORKSPACE_SUBMIT",
        sessionId: session.id,
        turnId: turn.id,
        prompt: text,
        targets,
      })) as ProviderRunResult[];
      for (const result of results) {
        setPanelStatus(
          result.panelId,
          result.status === "submitted" || result.status === "duplicate"
            ? "submitted"
            : result.status === "aborted"
              ? "ready"
              : result.errorCode === "LOGIN_REQUIRED"
                ? "needs-login"
                : result.status === "unavailable"
                  ? "unavailable"
                  : "error",
          result.message,
        );
      }
      await applySubmitResults(turn.id, results);
      await refreshHistory();
      if (
        results.some((result) => result.status === "submitted" || result.status === "duplicate")
      ) {
        setPrompt("");
      }
      inputRef.current?.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送事务失败";
      await applySubmitResults(
        turn.id,
        targets.map((target) => ({ panelId: target.panelId, status: "unavailable", message })),
      );
      await refreshHistory();
    } finally {
      setSending(false);
    }
  }

  async function startNewTask() {
    if (sending || startingSession) return;
    setStartingSession(true);
    const sessionId = crypto.randomUUID();
    const targets = useWorkspaceStore.getState().panels.map((panel) => ({
      panelId: panel.id,
      providerId: panel.providerId,
      url: providerRegistry.get(panel.providerId).definition.defaultUrl,
    }));
    try {
      const results = targets.length
        ? ((await browser.runtime.sendMessage({
            type: "WORKSPACE_NEW_SESSION",
            sessionId,
            targets,
          })) as ProviderRunResult[])
        : [];
      for (const result of results) {
        const succeeded = result.status === "submitted" || result.status === "duplicate";
        setPanelStatus(result.panelId, succeeded ? "ready" : "error", result.message);
        if (!succeeded && useWorkspaceStore.getState().selectedTargetIds.includes(result.panelId)) {
          useWorkspaceStore.getState().toggleTarget(result.panelId);
        }
      }
      await createSession("", sessionId);
      setPrompt("");
      setDetails(undefined);
      await refreshHistory();
      inputRef.current?.focus();
    } finally {
      setStartingSession(false);
    }
  }

  async function openHistory(record: SessionRecord) {
    setDetails(await getSessionDetail(record.id));
  }

  async function removeHistory(record: SessionRecord) {
    if (!window.confirm("删除这个会话及其全部问答记录？")) return;
    await deleteSession(record.id);
    if (details?.session.id === record.id) setDetails(undefined);
    await refreshHistory();
  }

  async function exportHistory() {
    const blob = new Blob([await exportHistoryJsonl()], {
      type: "application/x-ndjson;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `multi-ai-history-${new Date().toISOString().slice(0, 10)}${HISTORY_FILE_EXTENSION}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importHistory(file: File) {
    if (file.size > MAX_HISTORY_IMPORT_BYTES) {
      window.alert("历史文件不能超过 50 MB");
      return;
    }
    try {
      const summary = await importHistoryJsonl(await file.text());
      await refreshHistory();
      window.alert(`已导入 ${summary.sessions} 个会话、${summary.turns} 轮问答`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "历史文件导入失败");
    }
  }

  async function exportDiagnostics() {
    const stored = await browser.storage.session.get(null);
    const diagnostics = Object.fromEntries(
      Object.entries(stored).filter(([key]) => key.startsWith("provider-diagnostics-v1:")),
    );
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `multi-ai-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className={`workspace-shell ${sidebarOpen ? "with-sidebar" : ""}`}>
      {sidebarOpen && (
        <aside className="history-sidebar" aria-label="发送历史">
          <div className="sidebar-brand">
            <img src="/icon/32.png" alt="" />
            <div>
              <strong>Multi AI</strong>
              <span>网页对比工作台</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="收起历史"
              aria-label="收起历史"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
          <button
            className="new-task-button"
            type="button"
            disabled={sending || startingSession}
            onClick={() => void startNewTask()}
          >
            {startingSession ? <RefreshCw className="spin" size={17} /> : <Plus size={17} />}
            新任务
          </button>
          <label className="history-search">
            <Search size={15} />
            <input
              type="search"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
            />
          </label>
          <div className="sidebar-section-title">
            <History size={14} />
            最近会话
          </div>
          <div className="history-list">
            {filteredHistory.length ? (
              filteredHistory.map((record) => (
                <div
                  className={`history-row ${details?.session.id === record.id ? "active" : ""}`}
                  key={record.id}
                >
                  <button
                    className="history-item"
                    type="button"
                    onClick={() => void openHistory(record)}
                  >
                    <span>{record.title}</span>
                    <small>
                      {sessionStatusLabel(record.status)} · {formatTime(record.updatedAt)}
                    </small>
                  </button>
                  <button
                    className="history-delete"
                    type="button"
                    title="删除记录"
                    aria-label="删除记录"
                    onClick={() => void removeHistory(record)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <p className="empty-copy">统一发送后，会话和回复会保存在这里。</p>
            )}
          </div>
          <div className="history-transfer-actions">
            <button type="button" onClick={() => void exportHistory()} title="导出全部会话">
              <Download size={14} /> 导出
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="导入会话文件"
            >
              <Upload size={14} /> 导入
            </button>
            <input
              ref={importInputRef}
              type="file"
              hidden
              accept={`${HISTORY_FILE_EXTENSION},application/x-ndjson,application/jsonl,text/plain`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importHistory(file);
              }}
            />
          </div>
        </aside>
      )}

      <section className="workspace-area">
        <header className="app-toolbar">
          <div className="toolbar-title">
            {!sidebarOpen && (
              <button
                className="icon-button"
                type="button"
                title="展开历史"
                aria-label="展开历史"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            <div>
              <strong>对比工作台</strong>
              <span>{panels.length} 个真实网页</span>
            </div>
          </div>
          <div className="layout-switch" role="group" aria-label="面板布局">
            <button
              type="button"
              className={layoutMode === "tiles" ? "active" : ""}
              title="平铺布局"
              aria-label="平铺布局"
              aria-pressed={layoutMode === "tiles"}
              onClick={() => setLayoutMode("tiles")}
            >
              <Columns3 size={16} />
            </button>
            <button
              type="button"
              className={layoutMode === "adaptive" ? "active" : ""}
              title="自适应布局"
              aria-label="自适应布局"
              aria-pressed={layoutMode === "adaptive"}
              onClick={() => setLayoutMode("adaptive")}
            >
              <Grid2X2 size={16} />
            </button>
          </div>
          <div className="toolbar-actions">
            <button
              className="icon-button"
              type="button"
              title="等分容器"
              aria-label="等分容器"
              disabled={layoutMode !== "tiles" || panels.length < 2}
              onClick={() => {
                useWorkspaceStore.getState().setTileRatios({});
                setLayoutResetKey((current) => current + 1);
              }}
            >
              <Scaling size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="导出诊断信息"
              aria-label="导出诊断信息"
              onClick={() => void exportDiagnostics()}
            >
              <Download size={16} />
            </button>
            <button className="add-provider" type="button" onClick={() => setPickerOpen(true)}>
              <Plus size={17} />
              管理站点
            </button>
          </div>
        </header>

        <section className="composer-band" aria-label="全局输入">
          <div className="global-composer">
            <TargetSelector panels={panels} />
            <textarea
              ref={inputRef}
              value={prompt}
              rows={1}
              placeholder="输入完成后点击发送，将一次性提交到已选择的 AI 网页"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
            />
            <button
              className="send-button"
              type="button"
              title="发送到已选择的网页"
              aria-label="发送"
              disabled={!prompt.trim() || sending || selectedTargetIds.length === 0}
              onClick={() => void submitPrompt()}
            >
              {sending ? <RefreshCw className="spin" size={19} /> : <Send size={19} />}
            </button>
          </div>
          <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
        </section>

        <main className="panel-stage">
          {!runtimeReady || !hydrated ? (
            <div className="empty-workspace" aria-live="polite">
              <RefreshCw className="spin" size={24} />
              <strong>正在准备真实网页</strong>
            </div>
          ) : panels.length === 0 ? (
            <div className="empty-workspace">
              <Grid2X2 size={25} />
              <strong>添加要并排打开的 AI 网页</strong>
              <button type="button" onClick={() => setPickerOpen(true)}>
                <Plus size={16} /> 管理站点
              </button>
            </div>
          ) : (
            <PanelLayout
              key={`${panels.map((panel) => panel.id).join("|")}:${layoutResetKey}`}
              panels={panels}
              layoutMode={layoutMode}
              maximized={activeMaximized}
              onMaximize={(panelId) =>
                setMaximized(activeMaximized === panelId ? undefined : panelId)
              }
            />
          )}
        </main>
      </section>

      {pickerOpen && <ProviderPicker onClose={() => setPickerOpen(false)} />}
      {details && <SessionHistoryDetail detail={details} onClose={() => setDetails(undefined)} />}
    </div>
  );
}

function PanelLayout({
  panels,
  layoutMode,
  maximized,
  onMaximize,
}: {
  panels: WorkspacePanel[];
  layoutMode: "tiles" | "adaptive";
  maximized: string | undefined;
  onMaximize(panelId: string): void;
}) {
  const persistedRatios = useWorkspaceStore((state) => state.tileRatios);
  const setTileRatios = useWorkspaceStore((state) => state.setTileRatios);
  const panelSignature = panels.map((panel) => panel.id).join("|");
  const panelIds = useMemo(() => panelSignature.split("|").filter(Boolean), [panelSignature]);
  const hostRef = useRef<HTMLElement>(null);
  const initialRatios = normalizedRatios(panelIds, persistedRatios);
  const ratiosRef = useRef(initialRatios);
  const [ratios, setRatios] = useState(initialRatios);
  const [hostWidth, setHostWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () =>
      setHostWidth((current) => (current === host.clientWidth ? current : host.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  function applyRatios(next: number[]) {
    ratiosRef.current = next;
    setRatios(next);
  }

  function resizeBoundary(index: number, initial: number[], deltaRatio: number) {
    const next = [...initial];
    const pairTotal = (initial[index] ?? 0) + (initial[index + 1] ?? 0);
    const minimum = Math.min(0.18, 0.7 / Math.max(panels.length, 1));
    const left = Math.min(
      Math.max((initial[index] ?? 0) + deltaRatio, minimum),
      pairTotal - minimum,
    );
    next[index] = left;
    next[index + 1] = pairTotal - left;
    applyRatios(next);
  }

  function commitRatios() {
    setTileRatios(
      Object.fromEntries(panels.map((panel, index) => [panel.id, ratiosRef.current[index] ?? 0])),
    );
  }

  const adaptiveColumns = adaptiveColumnCount(panels.length, hostWidth);
  const style = maximized
    ? undefined
    : layoutMode === "tiles"
      ? {
          gridTemplateColumns: ratios
            .flatMap((ratio, index) =>
              index < ratios.length - 1
                ? [`minmax(0, ${ratio}fr)`, "8px"]
                : [`minmax(0, ${ratio}fr)`],
            )
            .join(" "),
        }
      : ({ "--adaptive-columns": adaptiveColumns } as React.CSSProperties);

  return (
    <section
      ref={hostRef}
      className={`panel-grid layout-${layoutMode} ${hostWidth < 700 ? "adaptive-single" : ""} ${resizing ? "is-resizing" : ""} ${maximized ? "has-maximized" : ""}`}
      style={style}
    >
      {panels.map((panel, index) => (
        <Fragment key={`${panel.id}:${panel.revision}`}>
          <ProviderPanel
            panel={panel}
            index={index}
            count={panels.length}
            maximized={panel.id === maximized}
            hidden={Boolean(maximized && panel.id !== maximized)}
            onMaximize={() => onMaximize(panel.id)}
          />
          {layoutMode === "tiles" && !maximized && index < panels.length - 1 && (
            <div
              className="panel-divider"
              role="separator"
              aria-label={`调整 ${index + 1} 和 ${index + 2} 号面板宽度`}
              aria-orientation="vertical"
              tabIndex={0}
              onDoubleClick={() => {
                const equal = panels.map(() => 1 / panels.length);
                applyRatios(equal);
                setTileRatios({});
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                resizeBoundary(index, ratiosRef.current, event.key === "ArrowLeft" ? -0.02 : 0.02);
                commitRatios();
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                const divider = event.currentTarget;
                const initial = [...ratiosRef.current];
                const startX = event.clientX;
                const availableWidth = Math.max(
                  (hostRef.current?.clientWidth ?? 1) - (panels.length - 1) * 8,
                  1,
                );
                divider.setPointerCapture(event.pointerId);
                setResizing(true);
                const move = (moveEvent: PointerEvent) => {
                  resizeBoundary(index, initial, (moveEvent.clientX - startX) / availableWidth);
                };
                const finish = () => {
                  divider.removeEventListener("pointermove", move);
                  divider.removeEventListener("pointerup", finish);
                  divider.removeEventListener("pointercancel", finish);
                  setResizing(false);
                  commitRatios();
                };
                divider.addEventListener("pointermove", move);
                divider.addEventListener("pointerup", finish);
                divider.addEventListener("pointercancel", finish);
              }}
            />
          )}
        </Fragment>
      ))}
    </section>
  );
}

function normalizedRatios(panelIds: string[], persisted: Record<string, number>): number[] {
  const values = panelIds.map((panelId) => persisted[panelId] ?? 1);
  const total = values.reduce((sum, value) => sum + Math.max(value, 0.01), 0);
  return values.map((value) => Math.max(value, 0.01) / total);
}

function adaptiveColumnCount(count: number, width: number): number {
  if (count <= 1 || width < 700) return 1;
  if (count === 2) return 2;
  if (count === 3) return width >= 1_200 ? 3 : 2;
  if (count === 4) return 2;
  if (count <= 6) return width >= 1_100 ? 3 : 2;
  return width >= 1_600 ? 4 : width >= 1_000 ? 3 : 2;
}

export function TargetSelector({ panels }: { panels: WorkspacePanel[] }) {
  const selectedTargetIds = useWorkspaceStore((state) => state.selectedTargetIds);
  const toggleTarget = useWorkspaceStore((state) => state.toggleTarget);
  const setAllTargets = useWorkspaceStore((state) => state.setAllTargets);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const selectedPanels = panels.filter((panel) => selectedTargetIds.includes(panel.id));
  const visiblePanels = panels.filter((panel) =>
    providerRegistry
      .get(panel.providerId)
      .definition.name.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="target-selector" ref={hostRef}>
      <button
        type="button"
        className="target-summary"
        aria-label={`选择发送目标，已选择 ${selectedPanels.length} 个，共 ${panels.length} 个`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="target-stack" aria-hidden="true">
          {selectedPanels.slice(0, 3).map((panel) => (
            <ProviderMark
              key={panel.id}
              definition={providerRegistry.get(panel.providerId).definition}
            />
          ))}
        </span>
        <strong>发送至 {selectedPanels.length}</strong>
        <span>/ {panels.length}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <section className="target-popover" role="dialog" aria-label="选择发送目标">
          <header>
            <div>
              <strong>发送目标</strong>
              <span>只在点击发送后提交到勾选的网页</span>
            </div>
            <div className="target-bulk-actions">
              <button type="button" onClick={() => setAllTargets(true)}>
                全选
              </button>
              <button type="button" onClick={() => setAllTargets(false)}>
                清空
              </button>
            </div>
          </header>
          {panels.length > 7 && (
            <label className="target-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                placeholder="搜索已打开站点"
                aria-label="搜索发送目标"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          <div className="target-options">
            {visiblePanels.map((panel) => {
              const definition = providerRegistry.get(panel.providerId).definition;
              return (
                <label className="target-option" data-provider={panel.providerId} key={panel.id}>
                  <input
                    type="checkbox"
                    checked={selectedTargetIds.includes(panel.id)}
                    onChange={() => toggleTarget(panel.id)}
                  />
                  <ProviderMark definition={definition} />
                  <span>
                    <strong>{definition.name}</strong>
                    <small>{statusLabel(panel.status)}</small>
                  </span>
                </label>
              );
            })}
            {visiblePanels.length === 0 && <p>没有匹配的已打开站点</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function ProviderPanel({
  panel,
  index,
  count,
  maximized,
  hidden,
  onMaximize,
}: {
  panel: WorkspacePanel;
  index: number;
  count: number;
  maximized: boolean;
  hidden: boolean;
  onMaximize(): void;
}) {
  const definition = providerRegistry.get(panel.providerId).definition;
  const movePanel = useWorkspaceStore((state) => state.movePanel);
  const refreshPanel = useWorkspaceStore((state) => state.refreshPanel);
  const removePanel = useWorkspaceStore((state) => state.removePanel);
  const setPanelStatus = useWorkspaceStore((state) => state.setPanelStatus);

  return (
    <article
      className={`provider-panel ${hidden ? "panel-hidden" : ""} ${maximized ? "panel-maximized" : ""}`}
      data-provider={panel.providerId}
    >
      <header className="panel-toolbar">
        <div className="panel-identity">
          <ProviderMark definition={definition} />
          <strong>{definition.name}</strong>
        </div>
        <span className={`panel-status status-${panel.status}`} title={panel.message}>
          <i />
          <span>
            {statusLabel(panel.status)}
            {panel.status === "error" && panel.message ? ` · ${panel.message}` : ""}
          </span>
        </span>
        <div className="panel-actions">
          <button
            type="button"
            title="左移"
            aria-label="左移"
            disabled={index === 0}
            onClick={() => movePanel(panel.id, -1)}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            title="右移"
            aria-label="右移"
            disabled={index === count - 1}
            onClick={() => movePanel(panel.id, 1)}
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            title="刷新网页"
            aria-label="刷新网页"
            onClick={() => refreshPanel(panel.id)}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            title={maximized ? "恢复" : "最大化"}
            aria-label={maximized ? "恢复" : "最大化"}
            onClick={onMaximize}
          >
            {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            title="在普通标签页打开"
            aria-label="在普通标签页打开"
            onClick={() =>
              void browser.runtime.sendMessage({
                type: "OPEN_PANEL_TAB",
                panelId: panel.id,
                providerId: panel.providerId,
                url: definition.defaultUrl,
              })
            }
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            title="关闭面板"
            aria-label="关闭面板"
            onClick={() => removePanel(panel.id)}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <ProviderViewport
        panelId={panel.id}
        providerName={definition.name}
        url={definition.defaultUrl}
        maximized={maximized}
        onConnectionTimeout={() => {
          const current = useWorkspaceStore.getState().panels.find((item) => item.id === panel.id);
          if (current?.status === "loading") {
            setPanelStatus(panel.id, "unavailable", "官网未建立连接，请刷新或在普通标签页打开");
          }
        }}
      />
    </article>
  );
}

function ProviderViewport({
  panelId,
  providerName,
  url,
  onConnectionTimeout,
}: {
  panelId: string;
  providerName: string;
  url: string;
  maximized: boolean;
  onConnectionTimeout(): void;
}) {
  return (
    <div className="provider-viewport">
      <iframe
        id={`provider-frame-${panelId}`}
        name={`maw:${panelId}`}
        src={url}
        title={`${providerName} 网页`}
        allow="clipboard-read; clipboard-write"
        onLoad={() => window.setTimeout(onConnectionTimeout, 10_000)}
      />
    </div>
  );
}

function ProviderPicker({ onClose }: { onClose(): void }) {
  const panels = useWorkspaceStore((state) => state.panels);
  const setProviderOpen = useWorkspaceStore((state) => state.setProviderOpen);
  const [query, setQuery] = useState("");
  const providers = providerRegistry.all().filter(({ definition }) => {
    const normalized = query.trim().toLocaleLowerCase();
    return (
      !normalized ||
      definition.name.toLocaleLowerCase().includes(normalized) ||
      new URL(definition.defaultUrl).hostname.toLocaleLowerCase().includes(normalized)
    );
  });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="provider-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="provider-picker-title">管理 AI 网页</h2>
            <p>打开或关闭工作台中的官网面板，新增站点默认参与统一发送。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label className="provider-search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder="搜索站点或域名"
            aria-label="搜索站点"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="provider-list">
          {providers.map(({ definition }) => {
            const added = panels.some((panel) => panel.providerId === definition.id);
            return (
              <label className="provider-option" data-provider={definition.id} key={definition.id}>
                <input
                  type="checkbox"
                  checked={added}
                  aria-label={`${added ? "关闭" : "打开"} ${definition.name}`}
                  onChange={(event) => setProviderOpen(definition.id, event.target.checked)}
                />
                <ProviderMark definition={definition} />
                <span>
                  <strong>{definition.name}</strong>
                  <small>{new URL(definition.defaultUrl).hostname}</small>
                </span>
                {definition.embedMode !== "preferred" && <em>实验性</em>}
                <span className={`provider-toggle ${added ? "active" : ""}`} aria-hidden="true">
                  <i />
                </span>
              </label>
            );
          })}
          {providers.length === 0 && <p className="provider-empty">没有匹配的站点</p>}
        </div>
        <footer>
          <span>实验性站点无法嵌入时，可切换到普通标签页继续统一发送。</span>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}

function SessionHistoryDetail({ detail, onClose }: { detail: SessionDetail; onClose(): void }) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="history-detail"
        role="dialog"
        aria-modal="true"
        aria-label="会话历史详情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{detail.session.title}</strong>
            <span>
              {detail.turns.length} 轮问答 · {formatFullTime(detail.session.createdAt)}
            </span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="detail-content session-timeline">
          {detail.turns.map(({ turn, exchanges }) => (
            <article className="turn-record" key={turn.id}>
              <header>
                <strong>第 {turn.sequence} 轮</strong>
                <span>
                  {formatFullTime(turn.createdAt)} · {turnStatusLabel(turn.status)}
                </span>
              </header>
              <section className="turn-prompt">
                <span>我的提问</span>
                <p>{turn.prompt}</p>
              </section>
              <div className="exchange-list">
                {exchanges.map((exchange) => (
                  <section className="exchange-record" key={exchange.id}>
                    <header>
                      <ProviderMark
                        definition={providerRegistry.get(exchange.providerId).definition}
                      />
                      <strong>{exchange.providerName}</strong>
                      <span className={`delivery-status status-${exchange.responseStatus}`}>
                        {exchangeStatusLabel(exchange)}
                      </span>
                    </header>
                    {exchange.responseText ? (
                      <p>{exchange.responseText}</p>
                    ) : (
                      <p className="response-placeholder">
                        {exchange.message ?? responsePlaceholder(exchange.responseStatus)}
                      </p>
                    )}
                    {exchange.message && exchange.responseText && <small>{exchange.message}</small>}
                  </section>
                ))}
              </div>
            </article>
          ))}
          {detail.turns.length === 0 && <p className="history-notice">这个会话还没有发送内容。</p>}
        </div>
      </aside>
    </div>
  );
}

function ProviderMark({ definition }: { definition: ProviderDefinition }) {
  return (
    <span
      className="provider-mark"
      style={{ "--provider-accent": definition.accent } as React.CSSProperties}
    >
      {definition.shortName}
    </span>
  );
}

function statusLabel(status: WorkspacePanel["status"]): string {
  return {
    loading: "载入中",
    "needs-login": "需登录",
    blocked: "无法嵌入",
    ready: "就绪",
    submitting: "发送中",
    submitted: "已发送",
    error: "失败",
    unavailable: "未连接",
  }[status];
}

function sessionStatusLabel(status: SessionRecord["status"]): string {
  return { active: "当前会话", archived: "已归档", imported: "已导入" }[status];
}

function turnStatusLabel(status: SessionDetail["turns"][number]["turn"]["status"]): string {
  return {
    preparing: "预检中",
    aborted: "已取消",
    waiting: "等待回复",
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
  }[status];
}

function exchangeStatusLabel(exchange: ProviderExchangeRecord): string {
  if (exchange.submitStatus !== "submitted") {
    return (
      {
        pending: "待发送",
        prepared: "已预检",
        aborted: "未发送",
        failed: "发送失败",
        unavailable: "未连接",
      }[exchange.submitStatus] ?? "已发送"
    );
  }
  return {
    waiting: "等待回复",
    streaming: "回复中",
    completed: "已完成",
    partial: "部分回复",
    timeout: "采集超时",
    failed: "采集失败",
    unsupported: "暂不支持采集",
  }[exchange.responseStatus];
}

function responsePlaceholder(status: ProviderExchangeRecord["responseStatus"]): string {
  return {
    waiting: "正在等待该站点开始回复...",
    streaming: "正在采集回复...",
    completed: "该站点没有可见的回复文本",
    partial: "仅采集到部分回复",
    timeout: "等待回复超时",
    failed: "回复采集失败",
    unsupported: "当前站点暂不支持回复采集",
  }[status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
