import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderExchangeRecord, SessionRecord, TurnRecord } from "../../db/database";
import type { SessionDetail } from "../../db/session-service";
import { SessionHistoryDetail } from "./session-history-detail";

const scrollTo = vi.fn();
const scrollIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: scrollTo,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});

describe("SessionHistoryDetail", () => {
  beforeEach(() => {
    scrollTo.mockClear();
    scrollIntoView.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts at the latest turn and keeps every AI answer collapsed", () => {
    render(<SessionHistoryDetail detail={createDetail()} onClose={vi.fn()} onTransfer={vi.fn()} />);

    const latestNavigation = screen.getByRole("button", {
      name: "第 2 轮：Second question",
    });
    expect(latestNavigation).toHaveAttribute("aria-current", "location");
    expect(screen.getAllByRole("button", { name: /展开 .* 的回答/ })).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "Latest answer" })).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(document.querySelector(".unified-question-navigation-title")).toHaveTextContent("2 / 2");

    fireEvent.click(screen.getByRole("button", { name: "第 1 轮：First question" }));
    expect(screen.getByRole("button", { name: "第 1 轮：First question" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("tracks the visible turn with IntersectionObserver", () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }

        observe() {}
        disconnect() {}
      },
    );
    render(<SessionHistoryDetail detail={createDetail()} onClose={vi.fn()} onTransfer={vi.fn()} />);

    const firstTurn = document.querySelector<HTMLElement>('[data-turn-id="turn-1"]')!;
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true, target: firstTurn } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByRole("button", { name: "第 1 轮：First question" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("moves between turns with the compact navigation controls", () => {
    render(<SessionHistoryDetail detail={createDetail()} onClose={vi.fn()} onTransfer={vi.fn()} />);

    const previous = screen.getByRole("button", { name: "上一轮问题", hidden: true });
    const next = screen.getByRole("button", { name: "下一轮问题", hidden: true });
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();

    fireEvent.click(previous);
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /展开 .* 的回答/ })).toHaveLength(3);
  });

  it("renders sanitized GFM only after opening an answer and never mounts images", () => {
    render(<SessionHistoryDetail detail={createDetail()} onClose={vi.fn()} onTransfer={vi.fn()} />);

    const latestAnswer = screen.getAllByRole("button", { name: "展开 DeepSeek 的回答" }).at(-1)!;
    fireEvent.click(latestAnswer);

    expect(latestAnswer).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Latest answer" })).toBeVisible();
    expect(screen.getByText("one")).toBeVisible();
    expect(screen.getByRole("cell", { name: "value" })).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("unsafe content")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );

    fireEvent.click(latestAnswer);
    expect(latestAnswer).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Latest answer" })).not.toBeInTheDocument();
  });

  it("handles an empty session and closes on Escape", () => {
    const onClose = vi.fn();
    const detail = createDetail();
    detail.turns = [];
    render(<SessionHistoryDetail detail={detail} onClose={onClose} onTransfer={vi.fn()} />);

    expect(screen.getByText("这个会话还没有发送内容。")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "问题导航" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function createDetail(): SessionDetail {
  const session: SessionRecord = {
    id: "session-1",
    title: "Research session",
    createdAt: "2026-08-30T10:00:00.000Z",
    contentUpdatedAt: "2026-08-30T10:02:00.000Z",
    lastOpenedAt: "2026-08-30T10:02:00.000Z",
    source: "local",
    workspace: {
      layoutMode: "tiles",
      panels: [],
      updatedAt: "2026-08-30T10:02:00.000Z",
    },
  };
  const first = turn("turn-1", 1, "First question", "2026-08-30T10:00:00.000Z");
  const second = turn("turn-2", 2, "Second question", "2026-08-30T10:01:00.000Z");
  return {
    session,
    turns: [
      {
        turn: first,
        exchanges: [
          exchange("exchange-deepseek-1", first.id, "deepseek", "DeepSeek", "Plain answer"),
          exchange("exchange-kimi-1", first.id, "kimi", "Kimi", "Kimi answer", 1),
        ],
      },
      {
        turn: second,
        exchanges: [
          exchange(
            "exchange-deepseek-2",
            second.id,
            "deepseek",
            "DeepSeek",
            `## Latest answer

- one

| key | value |
| --- | --- |
| result | value |

![remote](https://example.com/tracker.png)

<script>unsafe content</script>

[Documentation](https://example.com/docs)`,
          ),
        ],
      },
    ],
  };
}

function turn(id: string, sequence: number, prompt: string, createdAt: string): TurnRecord {
  return {
    id,
    sessionId: "session-1",
    sequence,
    prompt,
    createdAt,
    status: "completed",
  };
}

function exchange(
  id: string,
  turnId: string,
  providerId: "deepseek" | "kimi",
  providerName: string,
  responseText: string,
  targetIndex = 0,
): ProviderExchangeRecord {
  return {
    id,
    sessionId: "session-1",
    turnId,
    panelId: `panel-${providerId}`,
    providerId,
    providerName,
    targetIndex,
    submitStatus: "submitted",
    responseStatus: "completed",
    responseText,
    ...(responseText.startsWith("## ") ? { responseMarkdown: responseText } : {}),
  };
}
