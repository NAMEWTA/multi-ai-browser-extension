import { expect, test, chromium, type BrowserContext, type Page } from "@playwright/test";
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
  await expect(workspace.locator(".panel-status.status-ready")).toHaveCount(2, { timeout: 12_000 });
});

test("synchronizes text into native website composers without submitting", async () => {
  const prompt = "你是什么模型？我是通过统一输入框输入的";
  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").fill(prompt);

  const frames = workspace.locator("article.provider-panel iframe");
  for (let index = 0; index < 2; index += 1) {
    const frame = frames.nth(index).contentFrame();
    await expect(frame.locator("body")).toHaveAttribute("data-last-synced", prompt, {
      timeout: 10_000,
    });
    await expect(frame.locator("body")).toHaveAttribute("data-submit-count", "0");
  }
});

test("keeps the global composer focused during debounced cross-frame synchronization", async () => {
  const composer = workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页");
  await composer.fill("");
  await composer.focus();

  for (const character of "持续输入不失焦") {
    await composer.pressSequentially(character);
    await workspace.waitForTimeout(180);
    await expect(composer).toBeFocused();
  }

  await expect(composer).toHaveValue("持续输入不失焦");
  await expect(
    workspace
      .locator("article.provider-panel[data-provider='deepseek'] iframe")
      .contentFrame()
      .locator("body"),
  ).toHaveAttribute("data-last-synced", "持续输入不失焦");
  await expect(
    workspace
      .locator("article.provider-panel[data-provider='kimi'] iframe")
      .contentFrame()
      .locator("body"),
  ).toHaveAttribute("data-last-synced", "持续输入不失焦");
});

test("submits the synchronized prompt exactly once and stores a lightweight history snapshot", async () => {
  const prompt = "你是什么模型？我是通过统一输入框输入的";
  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").fill(prompt);
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  const frames = workspace.locator("article.provider-panel iframe");
  for (let index = 0; index < 2; index += 1) {
    const frame = frames.nth(index).contentFrame();
    await expect(frame.locator("body")).toHaveAttribute("data-submit-count", "1");
    await expect(frame.locator("[data-last-prompt]")).toHaveText(prompt);
  }
  await expect(workspace.locator(".panel-status.status-submitted")).toHaveCount(2);
  await expect(workspace.locator(".history-item").first()).toContainText("你是什么模型");

  await workspace.locator(".history-item").first().click();
  const detail = workspace.getByRole("dialog", { name: "发送记录详情" });
  await expect(detail).toContainText(prompt);
  await expect(detail.locator(".delivery-list > div")).toHaveCount(2);
  await expect(detail).toContainText("不会恢复当时的网页或原始会话");
  await detail.getByTitle("关闭").click();
});

test("adds all seven preconfigured websites and exposes experimental embed status", async () => {
  await workspace.getByRole("button", { name: "添加站点" }).click();
  const picker = workspace.getByRole("dialog", { name: "选择 AI 网页" });
  await expect(picker.locator(".provider-option")).toHaveCount(7);
  await expect(picker.locator(".provider-option", { hasText: "Coze" })).toContainText("实验性");
  for (const name of ["Coze", "ChatGPT", "Claude", "通义千问", "MiniMax"]) {
    await picker.locator(".provider-option", { hasText: name }).click();
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
});

test("sends only to selected website panels", async () => {
  const panels = workspace.locator("article.provider-panel");
  const before = await getSubmitCounts(workspace);
  const coze = workspace.locator("article.provider-panel[data-provider='coze']");
  await coze.getByRole("checkbox").uncheck();

  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").fill("只发送到六个站点");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  const after = await getSubmitCounts(workspace);
  const cozeIndex = await panels.evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute("data-provider") === "coze"),
  );
  expect(after[cozeIndex]).toBe(before[cozeIndex]);
  for (let index = 0; index < after.length; index += 1) {
    if (index !== cozeIndex) expect(after[index]).toBe((before[index] ?? 0) + 1);
  }
  await coze.getByRole("checkbox").check();
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

test("isolates a provider DOM failure from all other websites", async () => {
  const panels = workspace.locator("article.provider-panel");
  const broken = workspace.locator("article.provider-panel[data-provider='qwen']");
  const brokenFrame = broken.locator("iframe").contentFrame();
  await brokenFrame.locator("button, [role='button']").evaluateAll((elements) => {
    elements.forEach((element) => element.remove());
  });
  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").fill("单站故障隔离测试");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(broken.locator(".panel-status.status-error")).toBeVisible({ timeout: 10_000 });
  await expect(panels.locator(".panel-status.status-submitted")).toHaveCount(6);
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

  for (const candidate of await workspace.locator("article.provider-panel").all()) {
    const checkbox = candidate.getByRole("checkbox");
    const shouldEnable = (await candidate.getAttribute("data-provider")) === "deepseek";
    if ((await checkbox.isChecked()) !== shouldEnable) await checkbox.setChecked(shouldEnable);
  }
  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").fill("普通标签页发送");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();
  await expect(providerTab.locator("body")).toHaveAttribute("data-submit-count", "1");
  await providerTab.close();

  for (const checkbox of await workspace.locator(".panel-identity input[type='checkbox']").all()) {
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
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
  <body data-submit-count="0" data-last-synced="">
    <header data-mock-ready="true">Mock AI · ${host}</header>
    <main>
      <textarea id="chat-input" class="ds-scroll-area" placeholder="输入问题"></textarea>
      <div id="prompt-textarea" class="ProseMirror chat-input-editor" contenteditable="true" data-lexical-editor="true" role="textbox"></div>
      <button data-testid="composer-submit-button" class="send-button-container send-button" aria-label="Send" type="submit">Send</button>
      <div class="markdown" data-last-prompt></div>
    </main>
    <script>
      const readPrompt = () => {
        const values = [...document.querySelectorAll('textarea, [contenteditable]')].map((element) =>
          'value' in element ? element.value : element.textContent || ''
        );
        return values.find((value) => value.length > 0) || '';
      };
      document.addEventListener('input', (event) => {
        if (event.target.matches('textarea, [contenteditable]')) document.body.dataset.lastSynced = readPrompt();
      });
      for (const button of document.querySelectorAll('button, [role="button"]')) {
        button.addEventListener('click', () => {
          const prompt = readPrompt();
          document.body.dataset.submitCount = String(Number(document.body.dataset.submitCount) + 1);
          document.querySelector('[data-last-prompt]').textContent = prompt;
          for (const composer of document.querySelectorAll('textarea, [contenteditable]')) {
            if ('value' in composer) composer.value = '';
            else composer.replaceChildren();
          }
        });
      }
    </script>
  </body>
</html>`;
}
