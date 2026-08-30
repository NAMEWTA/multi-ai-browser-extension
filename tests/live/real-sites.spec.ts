import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve(".output/chrome-mv3");
const expectedHosts = [
  "chat.deepseek.com",
  "www.kimi.com",
  "www.coze.cn",
  "chatgpt.com",
  "claude.ai",
  "www.qianwen.com",
  "agent.minimax.io",
];

let context: BrowserContext;
let profilePath: string;
let workspace: Page;
let worker: Worker;

test.beforeAll(async () => {
  profilePath = await mkdtemp(path.join(tmpdir(), "multi-ai-live-smoke-"));
  context = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  worker = context.serviceWorkers()[0]!;
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  workspace = await context.newPage();
  await workspace.goto(`chrome-extension://${extensionId}/workspace.html`);
});

test.afterAll(async () => {
  await context?.close();
  if (profilePath) await rm(profilePath, { recursive: true, force: true });
});

test("loads the seven configured real AI websites without test interception", async () => {
  await workspace.getByRole("button", { name: "管理站点" }).click();
  for (const name of ["Coze", "ChatGPT", "Claude", "通义千问", "MiniMax"]) {
    await workspace.getByRole("checkbox", { name: `打开 ${name}` }).check();
  }
  await workspace.getByRole("button", { name: "完成" }).click();
  const frames = workspace.locator("article.provider-panel iframe");
  await expect(frames).toHaveCount(7);

  const observations: Array<{ expectedHost: string; finalUrl: string; composerFound: boolean }> =
    [];
  for (let index = 0; index < expectedHosts.length; index += 1) {
    const expectedHost = expectedHosts[index]!;
    await expect
      .poll(
        () =>
          workspace
            .frames()
            .map((frame) => frame.url())
            .find((url) => isExpectedSite(url, expectedHost)),
        {
          timeout: 45_000,
          message: `${expectedHost} should load as a real HTTPS frame`,
        },
      )
      .toBeTruthy();
    const frame = workspace
      .frames()
      .find((candidate) => isExpectedSite(candidate.url(), expectedHost));
    expect(frame, `${expectedHost} should create a real browser frame`).toBeTruthy();
    await frame!.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined);
    const finalUrl = frame!.url();
    const composerFound =
      (await frame!
        .locator("textarea, div[contenteditable='true'], [role='textbox']")
        .count()
        .catch(() => 0)) > 0;
    observations.push({ expectedHost, finalUrl, composerFound });
  }

  await test.info().attach("real-site-observations", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
  await workspace.setViewportSize({ width: 1440, height: 900 });
  await workspace.screenshot({ path: "test-results/live-sites-1440x900.png" });
});

test("synchronizes into the real Kimi Lexical editor without sending", async () => {
  const prompt = "【官网同步验收】这段文字不会发送";
  const kimiPanel = workspace.locator("article.provider-panel[data-provider='kimi']");
  await expect(kimiPanel.locator(".panel-status.status-ready")).toBeVisible({ timeout: 45_000 });
  await selectOnlyTarget("kimi");

  const composer = workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页");
  await composer.fill(prompt);
  await expect(composer).toBeFocused();
  const kimiFrame = kimiPanel.locator("iframe").contentFrame();
  await expect(
    kimiFrame.locator("[data-lexical-editor='true'].chat-input-editor").first(),
  ).toContainText(prompt, { timeout: 15_000 });
  await expect(composer).toBeFocused();
});

test("routes a prompt to a real ready website frame", async () => {
  const panels = workspace.locator("article.provider-panel");
  await expect
    .poll(
      async () => {
        const statuses = await panels.locator(".panel-status").allTextContents();
        return statuses.filter((status) => status.trim() === "就绪").length;
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);

  const readyPanel = panels.filter({ has: workspace.locator(".status-ready") }).first();
  const provider = await readyPanel.getAttribute("data-provider");
  await selectOnlyTarget(provider!);

  await workspace
    .getByPlaceholder("输入一次，同步到所有已选择的 AI 网页")
    .fill("【官网路由验收】请只回复：网页统一提问正常");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();

  await expect(readyPanel.locator(".panel-status")).toHaveText("已提交", { timeout: 30_000 });
  await expect(workspace.locator(".history-list")).toContainText("官网路由验收");

  const runtimeSnapshot = await worker.evaluate(async () => {
    const runtime = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: { get(key: string): Promise<Record<string, unknown>> };
        };
      };
    };
    return await runtime.chrome.storage.session.get("runtime-snapshot-v1");
  });
  await test.info().attach("runtime-snapshot", {
    body: JSON.stringify(runtimeSnapshot, null, 2),
    contentType: "application/json",
  });
});

function isExpectedSite(url: string, expectedHost: string): boolean {
  if (!url.startsWith("https://")) return false;
  const finalHost = new URL(url).hostname;
  const baseDomain = expectedHost.split(".").slice(-2).join(".");
  return finalHost === expectedHost || finalHost.endsWith(`.${baseDomain}`);
}

async function selectOnlyTarget(providerId: string): Promise<void> {
  await workspace.locator(".target-summary").click();
  const selector = workspace.getByRole("dialog", { name: "选择发送目标" });
  await selector.getByRole("button", { name: "清空" }).click();
  await selector.locator(`.target-option[data-provider='${providerId}'] input`).check();
  await workspace.getByPlaceholder("输入一次，同步到所有已选择的 AI 网页").click();
}
