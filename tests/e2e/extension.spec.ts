import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve(".output/chrome-mv3-e2e");
const providerHosts = [
  "chat.deepseek.com",
  "www.kimi.com",
  "www.coze.cn",
  "coze.cn",
  "chatgpt.com",
  "claude.ai",
  "www.qianwen.com",
  "chat.minimax.io",
  "agent.minimax.io",
];

let context: BrowserContext;
let profilePath: string;
let workspace: Page;

test.beforeAll(async () => {
  profilePath = await mkdtemp(path.join(tmpdir(), "multi-ai-e2e-"));
  context = await launchContext(profilePath);
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  workspace = await context.newPage();
  await workspace.goto(`chrome-extension://${extensionId}/workspace.html`);
});

test.afterAll(async () => {
  await context?.close();
  if (profilePath) await rm(profilePath, { recursive: true, force: true });
});

async function launchContext(userDataDir: string): Promise<BrowserContext> {
  const launched = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  for (const host of providerHosts) {
    await launched.route(`https://${host}/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: mockProviderHtml(host),
      });
    });
  }
  return launched;
}

test("opens a full-page workspace with DeepSeek and Kimi by default", async () => {
  await expect(workspace.locator(".toolbar-title strong")).toHaveText("对比工作台");
  await expect(workspace.locator("article.provider-panel")).toHaveCount(2);
  await expect(workspace.locator("article.provider-panel[data-provider='deepseek']")).toBeVisible();
  await expect(workspace.locator("article.provider-panel[data-provider='kimi']")).toBeVisible();
  await expect(workspace.locator(".global-composer")).toBeVisible();
  await expect(workspace.locator(".target-summary")).toContainText("发送至 2");
  await expect(workspace.locator(".panel-status.status-ready")).toHaveCount(2, { timeout: 30_000 });
});

test("keeps drafts isolated from native website composers until submit", async () => {
  const prompt = "你是什么模型？我是通过统一输入框输入的";
  await workspace.locator(".global-composer textarea").fill(prompt);
  await workspace.waitForTimeout(1_000);

  const frames = workspace.locator("article.provider-panel iframe");
  for (let index = 0; index < 2; index += 1) {
    const frame = frames.nth(index).contentFrame();
    await expect(frame.locator("body")).toHaveAttribute("data-last-synced", "");
    await expect(frame.locator("body")).toHaveAttribute("data-submit-count", "0");
  }
});

test("keeps the global composer focused while editing an isolated draft", async () => {
  const composer = workspace.locator(".global-composer textarea");
  await composer.fill("");
  await composer.focus();

  for (const character of "持续输入不失焦") {
    await composer.pressSequentially(character);
    await workspace.waitForTimeout(180);
    await expect(composer).toBeFocused();
  }

  await expect(composer).toHaveValue("持续输入不失焦");
  await expect(
    workspace.locator("article.provider-panel iframe").first().contentFrame().locator("body"),
  ).toHaveAttribute("data-last-synced", "");
});

test("submits exactly once and stores provider replies in the session timeline", async () => {
  const prompt = "你是什么模型？我是通过统一输入框输入的";
  await workspace.locator(".global-composer textarea").fill(prompt);
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  const frames = workspace.locator("article.provider-panel iframe");
  for (let index = 0; index < 2; index += 1) {
    const frame = frames.nth(index).contentFrame();
    await expect(frame.locator("body")).toHaveAttribute("data-submit-count", "1");
    await expect(frame.locator("[data-last-prompt]")).toHaveText(prompt);
  }
  await expect(workspace.locator(".history-item").first()).toContainText("你是什么模型");

  await workspace.getByLabel("查看对话记录").first().click();
  const detail = workspace.getByRole("dialog", { name: "会话历史详情" });
  await expect(detail).toContainText(prompt);
  const exchanges = detail.locator(".unified-exchange-record");
  await expect(exchanges).toHaveCount(2);
  const desktopTimeline = await detail.locator(".unified-history-timeline").boundingBox();
  const desktopNavigation = await detail.locator(".unified-question-navigation").boundingBox();
  expect(desktopNavigation!.x).toBeGreaterThan(desktopTimeline!.x);
  await expect(
    detail.locator('.unified-question-navigation button[aria-current="location"]'),
  ).toContainText(prompt);
  expect(
    await detail
      .locator(".unified-exchange-summary")
      .evaluateAll((summaries) =>
        summaries.map((summary) => summary.getAttribute("aria-expanded")),
      ),
  ).toEqual(["false", "false"]);
  await exchanges.first().locator(".unified-exchange-summary").click();
  await expect(exchanges.first().locator(".unified-exchange-content")).toContainText(
    `Mock AI 回复：${prompt}`,
    { timeout: 10_000 },
  );
  await detail.getByTitle("关闭").click();

  await workspace.getByLabel("复制或下载当前任务").click();
  await workspace.getByRole("menuitem", { name: "复制所有站点最近一轮" }).click();
  await expect(workspace.getByRole("status")).toContainText("已复制当前网页的最近一轮回复");

  const deepSeekPanel = workspace.locator("article.provider-panel", { hasText: "DeepSeek" });
  await deepSeekPanel.getByLabel("复制 DeepSeek 会话").click();
  await deepSeekPanel.getByRole("menuitem", { name: "复制最后一次问答" }).click();
  await expect(workspace.getByRole("status")).toContainText("已复制 DeepSeek 最近一次问答");
});

test("moves unified question navigation above the timeline on narrow screens", async () => {
  await workspace.setViewportSize({ width: 700, height: 800 });
  await workspace.getByLabel("查看对话记录").first().click();
  const detail = workspace.getByRole("dialog", { name: "会话历史详情" });
  const timeline = await detail.locator(".unified-history-timeline").boundingBox();
  const navigation = await detail.locator(".unified-question-navigation").boundingBox();
  expect(navigation!.y).toBeLessThanOrEqual(timeline!.y);
  expect(await workspace.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await workspace.evaluate(() => document.documentElement.clientWidth),
  );
  await detail.getByTitle("关闭").click();
  await workspace.setViewportSize({ width: 1440, height: 900 });
});

test("keeps multiple turns and restores exact official URLs when switching tasks", async () => {
  await workspace.locator(".global-composer textarea").fill("同一会话的第二个问题");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(workspace.locator(".history-item")).toHaveCount(1);
  await workspace.getByLabel("查看对话记录").first().click();
  const detail = workspace.getByRole("dialog", { name: "会话历史详情" });
  await expect(detail.locator(".unified-turn-record")).toHaveCount(2);
  await detail.getByTitle("关闭").click();

  await expect
    .poll(async () => {
      const urls = await getFrameUrls(workspace);
      return (
        urls.length === 2 &&
        urls.every((url) => url.includes("/totally-new/") && url.includes("?source=mock#saved"))
      );
    })
    .toBe(true);
  const oldUrls = await getFrameUrls(workspace);

  await workspace.getByRole("button", { name: "新任务", exact: true }).click();
  await expect(workspace.locator(".history-item")).toHaveCount(2);
  await expect
    .poll(async () => {
      const urls = await getFrameUrls(workspace);
      return urls.length === 2 && urls.every((url) => new URL(url).pathname === "/");
    })
    .toBe(true);

  await workspace.locator(".global-composer textarea").fill("新任务的第一个问题");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(async () => {
      const urls = await getFrameUrls(workspace);
      return (
        urls.length === oldUrls.length &&
        urls.every((url) => url.includes("/totally-new/")) &&
        urls.some((url, index) => url !== oldUrls[index])
      );
    })
    .toBe(true);
  const newUrls = await getFrameUrls(workspace);

  await workspace.locator(".history-item", { hasText: "你是什么模型" }).click();
  await expect
    .poll(async () => await getFrameUrls(workspace), { timeout: 12_000 })
    .toEqual(oldUrls);
  await workspace.locator(".history-item", { hasText: "新任务的第一个问题" }).click();
  await expect
    .poll(async () => await getFrameUrls(workspace), { timeout: 12_000 })
    .toEqual(newUrls);
});

test("keeps sidebar order stable until a session is explicitly pinned", async () => {
  const olderTitle = "置顶顺序较早会话";
  const currentTitle = "置顶顺序当前会话";
  await expect(workspace.locator(".panel-status.status-ready")).toHaveCount(2, { timeout: 30_000 });
  await workspace.getByRole("button", { name: "新任务", exact: true }).click();
  await workspace.locator(".global-composer textarea").fill(olderTitle);
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(workspace.locator(".history-item", { hasText: olderTitle })).toBeVisible();
  await workspace.getByRole("button", { name: "新任务", exact: true }).click();
  await workspace.locator(".global-composer textarea").fill(currentTitle);
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(workspace.locator(".history-item", { hasText: currentTitle })).toBeVisible();
  const titlesBefore = await workspace.locator(".history-item > span").allTextContents();

  await workspace.locator(".history-item", { hasText: olderTitle }).click();
  await expect(workspace.locator(".history-item > span")).toHaveText(titlesBefore);

  const olderRow = workspace.locator(".history-row", { hasText: olderTitle });
  await olderRow.getByLabel("置顶会话").click();
  await expect(workspace.locator(".history-item").first()).toContainText(olderTitle);

  await workspace.locator(".history-row", { hasText: olderTitle }).getByLabel("取消置顶").click();
  await expect(workspace.locator(".history-item").first()).toContainText(currentTitle);
});

test("manages all seven preconfigured websites and exposes experimental embed status", async () => {
  await workspace.getByRole("button", { name: "管理站点" }).click();
  const picker = workspace.getByRole("dialog", { name: "管理 AI 网页" });
  await expect(picker.locator(".provider-option")).toHaveCount(7);
  await expect(picker.locator(".provider-option", { hasText: "Coze" })).toContainText("实验性");
  for (const name of ["Coze", "ChatGPT", "Claude", "通义千问", "MiniMax"]) {
    await picker.getByRole("checkbox", { name: `打开 ${name}` }).check();
  }
  await picker.getByRole("button", { name: "完成" }).click();
  await expect(workspace.locator("article.provider-panel")).toHaveCount(7);
  await expect(workspace.locator("article.provider-panel iframe")).toHaveCount(7);
  await expect
    .poll(
      async () =>
        await workspace
          .locator(".panel-status.status-ready, .panel-status.status-submitted")
          .count(),
      { timeout: 15_000 },
    )
    .toBe(7);
  await expect(workspace.locator(".target-summary")).toContainText("发送至 7");
});

test("selects send targets independently without closing website panels", async () => {
  const panels = workspace.locator("article.provider-panel");
  const before = await getSubmitCounts(workspace);
  const cozeFrameName = await workspace
    .locator("article.provider-panel[data-provider='coze'] iframe")
    .getAttribute("name");
  await openTargetSelector(workspace);
  const targets = workspace.getByRole("dialog", { name: "选择发送目标" });
  await targets.locator(".target-option[data-provider='coze'] input").uncheck();
  await workspace.locator(".global-composer textarea").click();

  await workspace.locator(".global-composer textarea").fill("只发送到六个站点");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  const after = await getSubmitCounts(workspace);
  const cozeIndex = await panels.evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute("data-provider") === "coze"),
  );
  expect(after[cozeIndex]).toBe(before[cozeIndex]);
  for (let index = 0; index < after.length; index += 1) {
    if (index !== cozeIndex) expect(after[index]).toBe((before[index] ?? 0) + 1);
  }
  await expect(workspace.locator("article.provider-panel")).toHaveCount(7);
  await expect(
    workspace.locator("article.provider-panel[data-provider='coze'] iframe"),
  ).toHaveAttribute("name", cozeFrameName!);
  await openTargetSelector(workspace);
  await workspace
    .getByRole("dialog", { name: "选择发送目标" })
    .locator(".target-option[data-provider='coze'] input")
    .check();
  await workspace.locator(".global-composer textarea").click();
});

test("closes and reopens a website from the site manager", async () => {
  const minimax = workspace.locator("article.provider-panel[data-provider='minimax']");
  await minimax.getByTitle("最大化").click();
  await workspace.getByRole("button", { name: "管理站点" }).click();
  const manager = workspace.getByRole("dialog", { name: "管理 AI 网页" });
  await manager.getByRole("checkbox", { name: "关闭 MiniMax" }).uncheck();
  await expect(workspace.locator("article.provider-panel[data-provider='minimax']")).toHaveCount(0);
  await expect(workspace.locator("article.provider-panel.panel-hidden")).toHaveCount(0);
  await manager.getByRole("checkbox", { name: "打开 MiniMax" }).check();
  await manager.getByRole("button", { name: "完成" }).click();
  await expect(workspace.locator("article.provider-panel[data-provider='minimax']")).toBeVisible();
  await expect(workspace.locator(".target-summary")).toContainText("发送至 7");
});

test("keeps a native single-site follow-up independent", async () => {
  const deepseek = workspace.locator("article.provider-panel[data-provider='deepseek']");
  const frame = deepseek.locator("iframe").contentFrame();
  const before = await getSubmitCounts(workspace);
  await frame.locator("textarea#chat-input").fill("只在 DeepSeek 继续追问");
  await frame.locator("button[aria-label='Send']").evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(frame.locator("body")).toHaveAttribute(
    "data-submit-count",
    String((before[0] ?? 0) + 1),
  );
  const after = await getSubmitCounts(workspace);
  expect(after[0]).toBe((before[0] ?? 0) + 1);
  expect(after.slice(1)).toEqual(before.slice(1));
});

test("aborts all sends when one provider fails strict preflight", async () => {
  const panels = workspace.locator("article.provider-panel");
  const before = await getSubmitCounts(workspace);
  await workspace.getByLabel("查看对话记录").first().click();
  const historyDetail = workspace.getByRole("dialog", { name: "会话历史详情" });
  await expect(historyDetail).toBeVisible();
  const turnsBefore = await historyDetail.locator(".unified-turn-record").count();
  await historyDetail.getByTitle("关闭").click();
  const broken = workspace.locator("article.provider-panel[data-provider='qwen']");
  const brokenFrame = broken.locator("iframe").contentFrame();
  await brokenFrame.locator("button, [role='button']").evaluateAll((elements) => {
    elements.forEach((element) => element.remove());
  });
  await workspace.locator(".global-composer textarea").fill("预检原子性测试");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(broken.locator(".panel-status.status-error")).toBeVisible({ timeout: 10_000 });
  expect(await getSubmitCounts(workspace)).toEqual(before);
  await expect(panels.locator(".panel-status.status-ready")).toHaveCount(6);
  for (let index = 0; index < (await panels.count()); index += 1) {
    expect(
      await panels
        .nth(index)
        .locator("iframe")
        .contentFrame()
        .locator("textarea, [contenteditable]")
        .evaluateAll((composers) =>
          composers.every((composer) =>
            "value" in composer
              ? !(composer as HTMLTextAreaElement).value
              : !(composer.textContent ?? ""),
          ),
        ),
    ).toBe(true);
  }
  await workspace.getByLabel("查看对话记录").first().click();
  await expect(historyDetail).toBeVisible();
  await expect(historyDetail.locator(".unified-turn-record")).toHaveCount(turnsBefore);
  await historyDetail.getByTitle("关闭").click();
  await broken.getByTitle("刷新网页").click();
  await expect(broken.locator(".panel-status.status-ready")).toBeVisible({ timeout: 12_000 });
});

test("maximizes one website without unmounting the others", async () => {
  const deepseek = workspace.locator("article.provider-panel[data-provider='deepseek']");
  const firstFrameName = await deepseek.locator("iframe").getAttribute("name");
  await deepseek.getByTitle("最大化").click();
  await expect(workspace.locator("article.provider-panel")).toHaveCount(7);
  await expect(deepseek).toBeVisible();
  await expect(workspace.locator("article.provider-panel.panel-hidden")).toHaveCount(6);
  await deepseek.getByTitle("恢复").click();
  await expect(workspace.locator("article.provider-panel.panel-hidden")).toHaveCount(0);
  await expect(deepseek.locator("iframe")).toHaveAttribute("name", firstFrameName!);
});

test("routes a selected panel through an ordinary browser tab fallback", async () => {
  const panel = workspace.locator("article.provider-panel[data-provider='deepseek']");
  const [providerTab] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByTitle("在普通标签页打开").click(),
  ]);
  await providerTab.waitForLoadState("domcontentloaded");
  await expect(providerTab.locator("[data-mock-ready='true']")).toBeVisible();

  await selectOnlyTarget(workspace, "deepseek");
  await workspace.locator(".global-composer textarea").fill("普通标签页发送");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(providerTab.locator("body")).toHaveAttribute("data-submit-count", "1");
  await providerTab.close();

  await openTargetSelector(workspace);
  await workspace
    .getByRole("dialog", { name: "选择发送目标" })
    .getByRole("button", { name: "全选" })
    .click();
  await workspace.locator(".global-composer textarea").click();
});

test("renders stable rounded workbench layouts without page overflow", async () => {
  await workspace.setViewportSize({ width: 1440, height: 900 });
  await expect(workspace.locator(".app-toolbar")).toBeVisible();
  await expect(workspace.locator(".global-composer")).toBeVisible();
  await workspace.getByTitle("自适应布局").click();
  const grid = workspace.locator(".panel-grid");
  await expect(grid).toHaveClass(/layout-adaptive/);
  const size = await workspace.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
    scrollHeight: document.body.scrollHeight,
    clientHeight: document.body.clientHeight,
  }));
  expect(size.scrollWidth).toBe(size.clientWidth);
  expect(size.scrollHeight).toBe(size.clientHeight);
  const gridSize = await grid.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(gridSize.scrollWidth).toBe(gridSize.clientWidth);
  await workspace.getByTitle("平铺布局").click();
  await workspace.screenshot({ path: "test-results/workspace-v3-1440x900.png", fullPage: true });
  await openTargetSelector(workspace);
  await workspace.screenshot({
    path: "test-results/workspace-target-selector-1440x900.png",
    fullPage: true,
  });
  await workspace.locator(".global-composer textarea").click();
});

test("resizes adjacent tiled panels and restores equal widths", async () => {
  await workspace.getByTitle("平铺布局").click();
  const panels = workspace.locator("article.provider-panel");
  const divider = workspace.locator(".panel-divider").first();
  await expect(workspace.locator(".panel-divider")).toHaveCount((await panels.count()) - 1);
  const before = await panels.evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => element.getBoundingClientRect().width),
  );
  await divider.focus();
  await divider.press("ArrowRight");
  const after = await panels.evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => element.getBoundingClientRect().width),
  );
  expect(after[0]).toBeGreaterThan(before[0]!);
  expect(Math.abs(after[0]! + after[1]! - before[0]! - before[1]!)).toBeLessThan(2);

  await workspace.getByTitle("等分容器").click();
  const reset = await panels.evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => element.getBoundingClientRect().width),
  );
  expect(Math.abs(reset[0]! - reset[1]!)).toBeLessThan(2);
});

test("renders provider frames at a stable native scale", async () => {
  const frame = workspace.locator("article.provider-panel iframe").first();
  const samples: Array<{ width: number; height: number; transform: string }> = [];
  for (let index = 0; index < 30; index += 1) {
    samples.push(
      await frame.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(element).transform,
        };
      }),
    );
    await workspace.waitForTimeout(16);
  }
  expect(new Set(samples.map((sample) => `${sample.width}:${sample.height}`)).size).toBe(1);
  expect(new Set(samples.map((sample) => sample.transform))).toEqual(new Set(["none"]));
});

test("sends the exact A plus C prompt composition to every selected website", async () => {
  await workspace.locator(".prompt-summary").click();
  await workspace
    .getByRole("dialog", { name: "选择提示词" })
    .getByRole("button", { name: "管理提示词" })
    .click();
  const manager = workspace.getByRole("dialog", { name: "管理提示词" });
  await addPromptTemplate(manager, "提示词A", "使用表格回答");
  await addPromptTemplate(manager, "提示词B", "给出更多例子");
  await addPromptTemplate(manager, "提示词C", "保持简洁");
  await manager.getByTitle("关闭").click();

  await workspace.locator(".prompt-summary").click();
  const selector = workspace.getByRole("dialog", { name: "选择提示词" });
  await selector.getByRole("checkbox", { name: /提示词A/ }).check();
  await selector.getByRole("checkbox", { name: /提示词C/ }).check();
  await workspace.locator(".global-composer textarea").fill("解释 Go channel");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();

  const expected = "提示词A\n使用表格回答\n\n提示词C\n保持简洁\n\n用户\n解释 Go channel";
  const frames = workspace.locator("article.provider-panel iframe");
  for (let index = 0; index < (await frames.count()); index += 1) {
    await expect(frames.nth(index).contentFrame().locator("[data-last-prompt]")).toHaveText(
      expected,
    );
  }
});

async function getSubmitCounts(page: Page): Promise<number[]> {
  const frames = page.locator("article.provider-panel iframe");
  const counts: number[] = [];
  for (let index = 0; index < (await frames.count()); index += 1) {
    counts.push(
      Number(
        await frames.nth(index).contentFrame().locator("body").getAttribute("data-submit-count"),
      ),
    );
  }
  return counts;
}

async function addPromptTemplate(manager: Locator, name: string, content: string) {
  await manager.getByRole("button", { name: "新建提示词" }).click();
  await manager.getByLabel("名称").fill(name);
  await manager.getByLabel("内容").fill(content);
  await manager.getByRole("button", { name: "保存" }).click();
  await expect(manager.locator(".prompt-library-list")).toContainText(name);
}

async function getFrameUrls(page: Page): Promise<string[]> {
  return page
    .frames()
    .filter((frame) => frame.parentFrame() === page.mainFrame() && frame.name().startsWith("maw:"))
    .map((frame) => frame.url())
    .toSorted((left, right) => new URL(left).hostname.localeCompare(new URL(right).hostname));
}

async function openTargetSelector(page: Page): Promise<void> {
  await page.locator(".target-summary").click();
  await expect(page.getByRole("dialog", { name: "选择发送目标" })).toBeVisible();
}

async function selectOnlyTarget(page: Page, providerId: string): Promise<void> {
  await openTargetSelector(page);
  const selector = page.getByRole("dialog", { name: "选择发送目标" });
  await selector.getByRole("button", { name: "清空" }).click();
  await selector.locator(`.target-option[data-provider='${providerId}'] input`).check();
  await page.locator(".global-composer textarea").click();
}

function mockProviderHtml(host: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; color: #17191c; background: #fff; }
      header { padding: 12px 16px; border-bottom: 1px solid #e4e7eb; font-size: 13px; }
      main { padding: 16px; }
      textarea, [contenteditable] { display: block; width: calc(100% - 20px); min-height: 72px; margin: 12px 0; padding: 9px; border: 1px solid #b9c0ca; }
      button, [role='button'] { display: inline-block; margin-right: 8px; padding: 7px 12px; }
      [data-last-prompt] { margin-top: 14px; padding: 10px; background: #f2f4f7; white-space: pre-wrap; }
    </style>
  </head>
  <body data-submit-count="0" data-new-session-count="0" data-last-synced="">
    <header data-mock-ready="true">Mock AI · ${host}</header>
    <main>
      <button id="new-chat" aria-label="New chat" type="button">New chat</button>
      <textarea id="chat-input" class="ds-scroll-area" placeholder="输入问题"></textarea>
      <div id="prompt-textarea" class="ProseMirror chat-input-editor" contenteditable="true" data-lexical-editor="true" role="textbox"></div>
      <button data-testid="composer-submit-button" class="send-button-container send-button" aria-label="Send" type="submit" disabled>Send</button>
      <div data-last-prompt></div>
    </main>
    <script>
      const readPrompt = () => {
        const values = [...document.querySelectorAll('textarea, [contenteditable]')].map((element) =>
          'value' in element ? element.value : element.innerText || element.textContent || ''
        );
        return values.find((value) => value.length > 0) || '';
      };
      document.addEventListener('input', (event) => {
        if (event.target.matches('textarea, [contenteditable]')) {
          document.body.dataset.lastSynced = readPrompt();
          document.querySelector('[data-testid="composer-submit-button"]').disabled = !readPrompt();
        }
      });
      document.querySelector('#new-chat').addEventListener('click', () => {
        document.body.dataset.newSessionCount = String(Number(document.body.dataset.newSessionCount) + 1);
        document.querySelector('.assistant-response')?.remove();
        document.querySelector('[data-last-prompt]').textContent = '';
        for (const composer of document.querySelectorAll('textarea, [contenteditable]')) {
          if ('value' in composer) composer.value = '';
          else composer.replaceChildren();
        }
      });
      document.querySelector('[data-testid="composer-submit-button"]').addEventListener('click', () => {
          const prompt = readPrompt();
          document.body.dataset.submitCount = String(Number(document.body.dataset.submitCount) + 1);
          if (location.pathname === '/') {
            history.pushState({}, '', '/totally-new/' + crypto.randomUUID() + '?source=mock#saved');
          }
          document.querySelector('[data-last-prompt]').textContent = prompt;
          const response = document.querySelector('.assistant-response') || document.createElement('div');
          response.className = 'assistant-response';
          response.textContent = 'Mock AI 回复：' + prompt;
          document.querySelector('main').append(response);
          for (const composer of document.querySelectorAll('textarea, [contenteditable]')) {
            if ('value' in composer) composer.value = '';
            else composer.replaceChildren();
          }
          document.querySelector('[data-testid="composer-submit-button"]').disabled = true;
      });
    </script>
  </body>
</html>`;
}
