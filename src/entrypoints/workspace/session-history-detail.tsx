import { ChevronDown, Copy, FileDown, MessageSquareText, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import { providerRegistry } from "../../core/providers/registry";
import type { ProviderExchangeRecord } from "../../db/database";
import type { SessionDetail } from "../../db/session-service";
import { ActionMenu } from "./action-menu";
import { MarkdownResponse } from "./markdown-response";
import "./session-history-detail.css";

export interface SessionHistoryDetailProps {
  detail: SessionDetail;
  onClose(): void;
  onTransfer(mode: "copy" | "download"): void;
}

interface ExpansionState {
  sessionId: string;
  exchangeIds: ReadonlySet<string>;
}

interface ActiveTurnState {
  sessionId: string;
  turnId: string | undefined;
}

export function SessionHistoryDetail({ detail, onClose, onTransfer }: SessionHistoryDetailProps) {
  const turns = detail.turns;
  const latestTurnId = turns.at(-1)?.turn.id;
  const timelineRef = useRef<HTMLDivElement>(null);
  const turnElementsRef = useRef(new Map<string, HTMLElement>());
  const [activeState, setActiveState] = useState<ActiveTurnState>({
    sessionId: detail.session.id,
    turnId: latestTurnId,
  });
  const [expansionState, setExpansionState] = useState<ExpansionState>({
    sessionId: detail.session.id,
    exchangeIds: new Set(),
  });

  const turnIds = useMemo(() => new Set(turns.map(({ turn }) => turn.id)), [turns]);
  const activeTurnId =
    activeState.sessionId === detail.session.id &&
    activeState.turnId !== undefined &&
    turnIds.has(activeState.turnId)
      ? activeState.turnId
      : latestTurnId;
  const expandedExchangeIds =
    expansionState.sessionId === detail.session.id
      ? expansionState.exchangeIds
      : EMPTY_EXCHANGE_IDS;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useLayoutEffect(() => {
    if (latestTurnId)
      scrollToTurn(timelineRef.current, turnElementsRef.current, latestTurnId, "auto");
  }, [detail.session.id, latestTurnId]);

  function navigateToTurn(turnId: string) {
    setActiveState({ sessionId: detail.session.id, turnId });
    scrollToTurn(timelineRef.current, turnElementsRef.current, turnId, "smooth");
  }

  function updateActiveTurn(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const containerTop = container.getBoundingClientRect().top;
    let closestId: string | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const { turn } of turns) {
      const element = turnElementsRef.current.get(turn.id);
      if (!element) continue;
      const distance = Math.abs(element.getBoundingClientRect().top - containerTop - 12);
      if (distance < closestDistance) {
        closestId = turn.id;
        closestDistance = distance;
      }
    }

    if (closestId && closestId !== activeTurnId) {
      setActiveState({ sessionId: detail.session.id, turnId: closestId });
    }
  }

  function toggleExchange(exchangeId: string) {
    setExpansionState((current) => {
      const next =
        current.sessionId === detail.session.id ? new Set(current.exchangeIds) : new Set<string>();
      if (next.has(exchangeId)) next.delete(exchangeId);
      else next.add(exchangeId);
      return { sessionId: detail.session.id, exchangeIds: next };
    });
  }

  return (
    <div className="unified-history-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="unified-history-detail"
        role="dialog"
        aria-modal="true"
        aria-label="会话历史详情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="unified-history-header">
          <div className="unified-history-heading">
            <strong>{detail.session.title}</strong>
            <span>
              {turns.length} 轮问答 · {formatFullTime(detail.session.createdAt)}
            </span>
          </div>
          <div className="unified-history-actions">
            <ActionMenu
              label="复制或下载完整会话"
              icon={<Copy size={16} />}
              items={[
                {
                  id: "copy",
                  label: "复制完整会话",
                  icon: <Copy size={14} />,
                  onSelect: () => onTransfer("copy"),
                },
                {
                  id: "download",
                  label: "下载 Markdown",
                  icon: <FileDown size={14} />,
                  onSelect: () => onTransfer("download"),
                },
              ]}
            />
            <button
              className="unified-history-close"
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        {turns.length ? (
          <div className="unified-history-layout">
            <div className="unified-history-timeline" ref={timelineRef} onScroll={updateActiveTurn}>
              {turns.map(({ turn, exchanges }) => (
                <article
                  className="unified-turn-record"
                  id={`history-turn-${turn.id}`}
                  key={turn.id}
                  ref={(element) => {
                    if (element) turnElementsRef.current.set(turn.id, element);
                    else turnElementsRef.current.delete(turn.id);
                  }}
                  data-active={activeTurnId === turn.id || undefined}
                >
                  <header className="unified-turn-header">
                    <strong>第 {turn.sequence} 轮</strong>
                    <span>
                      {formatFullTime(turn.createdAt)} · {turnStatusLabel(turn.status)}
                    </span>
                  </header>
                  <section className="unified-turn-prompt">
                    <span>我的提问</span>
                    <p>{turn.userQuestion ?? turn.prompt}</p>
                    {turn.appliedPromptTemplates?.length ? (
                      <details className="unified-effective-prompt">
                        <summary>
                          已应用{" "}
                          {turn.appliedPromptTemplates.map((template) => template.name).join("、")}
                        </summary>
                        <pre>{turn.prompt}</pre>
                      </details>
                    ) : null}
                  </section>
                  <div className="unified-exchange-list">
                    {exchanges.map((exchange) => (
                      <ExchangeRecord
                        exchange={exchange}
                        expanded={expandedExchangeIds.has(exchange.id)}
                        key={exchange.id}
                        onToggle={() => toggleExchange(exchange.id)}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <nav className="unified-question-navigation" aria-label="问题导航">
              <div className="unified-question-navigation-title">
                <MessageSquareText size={14} />
                <strong>问答导航</strong>
              </div>
              <div className="unified-question-navigation-list">
                {turns.map(({ turn }) => (
                  <button
                    type="button"
                    key={turn.id}
                    aria-current={activeTurnId === turn.id ? "location" : undefined}
                    aria-label={`第 ${turn.sequence} 轮：${singleLine(turn.userQuestion ?? turn.prompt)}`}
                    title={turn.userQuestion ?? turn.prompt}
                    onClick={() => navigateToTurn(turn.id)}
                  >
                    <span>{turn.sequence}</span>
                    <strong>{turn.userQuestion ?? turn.prompt}</strong>
                  </button>
                ))}
              </div>
            </nav>
          </div>
        ) : (
          <p className="unified-history-empty">这个会话还没有发送内容。</p>
        )}
      </section>
    </div>
  );
}

function ExchangeRecord({
  exchange,
  expanded,
  onToggle,
}: {
  exchange: ProviderExchangeRecord;
  expanded: boolean;
  onToggle(): void;
}) {
  const contentId = `exchange-content-${useId().replace(/:/gu, "")}`;
  const definition = providerRegistry.get(exchange.providerId).definition;
  const hasResponse = Boolean(exchange.responseMarkdown || exchange.responseText);

  return (
    <section className="unified-exchange-record">
      <button
        className="unified-exchange-summary"
        type="button"
        aria-controls={contentId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"} ${exchange.providerName} 的回答`}
        onClick={onToggle}
      >
        <span
          className="unified-provider-mark"
          style={{ "--provider-accent": definition.accent } as CSSProperties}
          aria-hidden="true"
        >
          {definition.shortName}
        </span>
        <strong>{exchange.providerName}</strong>
        <span className={`unified-delivery-status status-${exchange.responseStatus}`}>
          {exchangeStatusLabel(exchange)}
        </span>
        <ChevronDown className="unified-exchange-chevron" size={16} aria-hidden="true" />
      </button>
      {expanded && (
        <div
          className="unified-exchange-content"
          id={contentId}
          role="region"
          aria-label={`${exchange.providerName} 的回答`}
        >
          {exchange.responseMarkdown ? (
            <MarkdownResponse content={exchange.responseMarkdown} />
          ) : exchange.responseText ? (
            <p className="unified-plain-response">{exchange.responseText}</p>
          ) : (
            <p className="unified-response-placeholder">
              {exchange.message ?? responsePlaceholder(exchange.responseStatus)}
            </p>
          )}
          {exchange.message && hasResponse && (
            <small className="unified-response-message">{exchange.message}</small>
          )}
        </div>
      )}
    </section>
  );
}

const EMPTY_EXCHANGE_IDS: ReadonlySet<string> = new Set();

function scrollToTurn(
  container: HTMLDivElement | null,
  elements: ReadonlyMap<string, HTMLElement>,
  turnId: string,
  behavior: ScrollBehavior,
) {
  const target = elements.get(turnId);
  if (!container || !target) return;
  const top =
    target.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    12;
  if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior });
  else container.scrollTop = top;
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

function formatFullTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim() || "（空内容）";
}
