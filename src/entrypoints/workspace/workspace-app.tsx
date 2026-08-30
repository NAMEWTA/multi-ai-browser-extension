import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
  Trash2,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import type { ProviderRunResult } from "../../core/messaging/protocol";
import { workspaceFrameStatusSchema } from "../../core/messaging/protocol";
import { providerRegistry } from "../../core/providers/registry";
import type { ProviderDefinition } from "../../core/providers/contracts";
import { deleteSendRecord, listSendRecords, saveSendRecord } from "../../db/history-service";
import type { SendRecord } from "../../db/database";
import { useWorkspaceStore, type WorkspacePanel } from "./workspace-store";

export function WorkspaceApp() {
  const panels = useWorkspaceStore((state) => state.panels);
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
  const [composing, setComposing] = useState(false);
  const [maximized, setMaximized] = useState<string>();
  const [history, setHistory] = useState<SendRecord[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [details, setDetails] = useState<SendRecord>();
  const [runtimeReady, setRuntimeReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editedRef = useRef(false);
  const syncRevisionRef = useRef(0);

  const refreshHistory = useCallback(async () => {
    setHistory(await listSendRecords());
  }, []);

  useEffect(() => {
    let mounted = true;
    void hydrate();
    void listSendRecords().then((records) => {
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
      const parsed = workspaceFrameStatusSchema.safeParse(raw);
      if (!parsed.success) return undefined;
      const current = useWorkspaceStore
        .getState()
        .panels.find((panel) => panel.id === parsed.data.panelId);
      if (
        parsed.data.status === "ready" &&
        current &&
        current.status !== "loading" &&
        current.status !== "needs-login" &&
        current.status !== "blocked"
      ) {
        return { ok: true };
      }
      setPanelStatus(parsed.data.panelId, parsed.data.status, parsed.data.message);
      return { ok: true };
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [setPanelStatus]);

  const enabledSignature = panels
    .filter((panel) => panel.enabled)
    .map((panel) => `${panel.id}:${panel.providerId}:${panel.revision}`)
    .join("|");

  useEffect(() => {
    if (!runtimeReady || !hydrated || composing || !editedRef.current) return;
    const timer = window.setTimeout(() => {
      if (!editedRef.current) return;
      const targets = currentTargets();
      if (!targets.length) return;
      const revision = ++syncRevisionRef.current;
      const restoreFocus = document.activeElement === inputRef.current;
      const selectionStart = inputRef.current?.selectionStart ?? null;
      const selectionEnd = inputRef.current?.selectionEnd ?? null;
      for (const target of targets) setPanelStatus(target.panelId, "syncing");
      void browser.runtime
        .sendMessage({ type: "WORKSPACE_SYNC", revision, prompt, targets })
        .then((raw) => {
          if (revision !== syncRevisionRef.current) return;
          for (const result of raw as ProviderRunResult[]) {
            setPanelStatus(
              result.panelId,
              result.status === "synced" || result.status === "duplicate" ? "ready" : "error",
              result.message,
            );
          }
          if (restoreFocus && inputRef.current) {
            inputRef.current.focus({ preventScroll: true });
            if (selectionStart !== null && selectionEnd !== null) {
              inputRef.current.setSelectionRange(selectionStart, selectionEnd);
            }
          }
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [prompt, composing, enabledSignature, hydrated, runtimeReady, setPanelStatus]);

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    if (!query) return history;
    return history.filter(
      (record) =>
        record.prompt.toLocaleLowerCase().includes(query) ||
        record.targets.some((target) => target.providerName.toLocaleLowerCase().includes(query)),
    );
  }, [history, historyQuery]);

  function currentTargets() {
    return useWorkspaceStore
      .getState()
      .panels.filter((panel) => panel.enabled)
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
    const taskId = crypto.randomUUID();
    setSending(true);
    editedRef.current = false;
    syncRevisionRef.current += 1;
    for (const target of targets) setPanelStatus(target.panelId, "submitting");
    try {
      const results = (await browser.runtime.sendMessage({
        type: "WORKSPACE_SUBMIT",
        taskId,
        prompt: text,
        targets,
      })) as ProviderRunResult[];
      for (const result of results) {
        setPanelStatus(
          result.panelId,
          result.status === "submitted" || result.status === "duplicate"
            ? "submitted"
            : result.errorCode === "LOGIN_REQUIRED"
              ? "needs-login"
              : result.status === "unavailable"
                ? "unavailable"
                : "error",
          result.message,
        );
      }
      await saveSendRecord(
        taskId,
        text,
        targets.map((target) => ({
          panelId: target.panelId,
          providerId: target.providerId,
          providerName: providerRegistry.get(target.providerId).definition.name,
        })),
        results,
      );
      await refreshHistory();
      setPrompt("");
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  }

  async function removeHistory(record: SendRecord) {
    if (!window.confirm("删除这条发送记录？")) return;
    await deleteSendRecord(record.id);
    if (details?.id === record.id) setDetails(undefined);
    await refreshHistory();
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
            onClick={() => {
              editedRef.current = false;
              setPrompt("");
              setDetails(undefined);
              inputRef.current?.focus();
            }}
          >
            <Plus size={17} />
            新任务
          </button>
          <label className="history-search">
            <Search size={15} />
            <input
              type="search"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="搜索发送记录"
              aria-label="搜索发送记录"
            />
          </label>
          <div className="sidebar-section-title">
            <History size={14} />
            最近发送
          </div>
          <div className="history-list">
            {filteredHistory.length ? (
              filteredHistory.map((record) => (
                <div
                  className={`history-row ${details?.id === record.id ? "active" : ""}`}
                  key={record.id}
                >
                  <button className="history-item" type="button" onClick={() => setDetails(record)}>
                    <span>{record.prompt}</span>
                    <small>
                      {record.targets.length} 个站点 · {formatTime(record.createdAt)}
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
              <p className="empty-copy">统一发送后，记录会保存在这里。</p>
            )}
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
              className={layoutMode === "columns" ? "active" : ""}
              title="分栏布局"
              aria-label="分栏布局"
              aria-pressed={layoutMode === "columns"}
              onClick={() => setLayoutMode("columns")}
            >
              <Columns3 size={16} />
            </button>
            <button
              type="button"
              className={layoutMode === "grid" ? "active" : ""}
              title="网格布局"
              aria-label="网格布局"
              aria-pressed={layoutMode === "grid"}
              onClick={() => setLayoutMode("grid")}
            >
              <Grid2X2 size={16} />
            </button>
          </div>
          <div className="toolbar-actions">
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
              添加站点
            </button>
          </div>
        </header>

        <section className="composer-band" aria-label="全局输入">
          <div className="global-composer">
            <div className="composer-targets" aria-label="当前发送目标">
              {panels.map((panel) => (
                <ProviderTarget key={panel.id} panel={panel} />
              ))}
            </div>
            <textarea
              ref={inputRef}
              value={prompt}
              rows={1}
              placeholder="输入一次，同步到所有已选择的 AI 网页"
              onChange={(event) => {
                editedRef.current = true;
                setPrompt(event.target.value);
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
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
              disabled={!prompt.trim() || sending || !panels.some((panel) => panel.enabled)}
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
                <Plus size={16} /> 添加站点
              </button>
            </div>
          ) : (
            <section
              className={`panel-grid layout-${layoutMode} ${maximized ? "has-maximized" : ""}`}
              style={{ "--panel-count": Math.min(panels.length, 6) } as React.CSSProperties}
            >
              {panels.map((panel, index) => (
                <ProviderPanel
                  key={`${panel.id}:${panel.revision}`}
                  panel={panel}
                  index={index}
                  count={panels.length}
                  maximized={panel.id === maximized}
                  hidden={Boolean(maximized && panel.id !== maximized)}
                  onMaximize={() => setMaximized(maximized === panel.id ? undefined : panel.id)}
                />
              ))}
            </section>
          )}
        </main>
      </section>

      {pickerOpen && <ProviderPicker onClose={() => setPickerOpen(false)} />}
      {details && <HistoryDetail record={details} onClose={() => setDetails(undefined)} />}
    </div>
  );
}

function ProviderTarget({ panel }: { panel: WorkspacePanel }) {
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
  const definition = providerRegistry.get(panel.providerId).definition;
  return (
    <button
      type="button"
      className={`target-chip ${panel.enabled ? "active" : ""}`}
      title={`${panel.enabled ? "取消" : "选择"} ${definition.name}`}
      aria-label={`${panel.enabled ? "取消" : "选择"} ${definition.name}`}
      aria-pressed={panel.enabled}
      onClick={() => togglePanel(panel.id)}
    >
      <ProviderMark definition={definition} />
      <span>{definition.name}</span>
      {panel.enabled && <Check size={13} />}
    </button>
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
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
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
        <label className="panel-identity">
          <input
            type="checkbox"
            checked={panel.enabled}
            aria-label={`选择 ${definition.name}`}
            onChange={() => togglePanel(panel.id)}
          />
          <ProviderMark definition={definition} />
          <strong>{definition.name}</strong>
        </label>
        <span className={`panel-status status-${panel.status}`} title={panel.message}>
          <i />
          {statusLabel(panel.status)}
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
  const addPanel = useWorkspaceStore((state) => state.addPanel);
  const providers = providerRegistry.all();
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
            <h2 id="provider-picker-title">选择 AI 网页</h2>
            <p>直接使用浏览器中各官方网站的现有登录状态。</p>
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
        <div className="provider-list">
          {providers.map(({ definition }) => {
            const added = panels.some((panel) => panel.providerId === definition.id);
            return (
              <button
                className="provider-option"
                type="button"
                key={definition.id}
                disabled={added}
                onClick={() => addPanel(definition.id)}
              >
                <ProviderMark definition={definition} />
                <span>
                  <strong>{definition.name}</strong>
                  <small>{new URL(definition.defaultUrl).hostname}</small>
                </span>
                {definition.embedMode !== "preferred" && <em>实验性</em>}
                {added ? <Check size={17} /> : <Plus size={17} />}
              </button>
            );
          })}
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

function HistoryDetail({ record, onClose }: { record: SendRecord; onClose(): void }) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="history-detail"
        role="dialog"
        aria-modal="true"
        aria-label="发送记录详情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>发送记录</strong>
            <span>{formatFullTime(record.createdAt)}</span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="detail-content">
          <section>
            <span>发送内容</span>
            <p>{record.prompt}</p>
          </section>
          <section>
            <span>当时打开的网页</span>
            <div className="delivery-list">
              {record.targets.map((target) => (
                <div key={target.panelId}>
                  <ProviderMark definition={providerRegistry.get(target.providerId).definition} />
                  <strong>{target.providerName}</strong>
                  <span className={`delivery-status status-${target.status}`}>
                    {deliveryLabel(target.status)}
                  </span>
                  {target.message && <small>{target.message}</small>}
                </div>
              ))}
            </div>
          </section>
          <p className="history-notice">这是一条发送快照，不会恢复当时的网页或原始会话。</p>
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
    ready: "可同步",
    syncing: "同步中",
    submitting: "发送中",
    submitted: "已发送",
    error: "失败",
    unavailable: "未连接",
  }[status];
}

function deliveryLabel(status: SendRecord["targets"][number]["status"]): string {
  return { submitted: "已发送", failed: "失败", unavailable: "未连接" }[status];
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
