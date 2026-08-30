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

test("keeps a draft out of the real Kimi Lexical editor before sending", async () => {
  const prompt = "【官网草稿隔离验收】这段文字不会写入官网";
  const kimiPanel = workspace.locator("article.provider-panel[data-provider='kimi']");
  await expect(kimiPanel.locator(".panel-status.status-ready")).toBeVisible({ timeout: 45_000 });
  await selectOnlyTarget("kimi");

  const composer = workspace.locator(".global-composer textarea");
  await composer.fill(prompt);
  await expect(composer).toBeFocused();
  const kimiFrame = kimiPanel.locator("iframe").contentFrame();
  await workspace.waitForTimeout(1_500);
  await expect(
    kimiFrame.locator("[data-lexical-editor='true'].chat-input-editor").first(),
  ).not.toContainText(prompt);
  await expect(composer).toBeFocused();
});

test("connects the real Qwen composer without leaking the workspace draft", async () => {
  const prompt = "【千问官网草稿隔离验收】这段文字不会提前写入官网";
  const sessionId = crypto.randomUUID();
  const turnId = crypto.randomUUID();
  const qwenPanel = workspace.locator("article.provider-panel[data-provider='qwen']");
  const qwenFrame = qwenPanel.locator("iframe").contentFrame();
  const nativeComposer = qwenFrame
    .locator(
      "textarea#chat-input, [data-slate-editor='true'][contenteditable='true'], [role='textbox'][contenteditable='true'], textarea[placeholder*='千问'], textarea[placeholder*='问']",
    )
    .first();
  const composerAvailable = await nativeComposer
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!composerAvailable, "隔离浏览器中的千问未登录营销页不提供聊天输入框");
  const realFrame = workspace
    .frames()
    .find((candidate) => isExpectedSite(candidate.url(), "www.qianwen.com"));
  const diagnostic = {
    url: realFrame?.url(),
    windowName: await realFrame?.evaluate(() => window.name),
    composer: await nativeComposer.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      id: element.id,
      role: element.getAttribute("role"),
      placeholder: element.getAttribute("placeholder"),
      contenteditable: element.getAttribute("contenteditable"),
      visibleTextLength: element.textContent?.trim().length ?? 0,
    })),
    status: await qwenPanel.locator(".panel-status").textContent(),
    runtime: await readRuntimeSnapshot(),
  };
  await test.info().attach("qwen-bridge-diagnostic", {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: "application/json",
  });
  const precheckRun = await sendDirectQwenCommand({
    type: "PRECHECK_PROMPT",
    panelId: "",
    sessionId,
    turnId,
    prompt,
  });
  expect(precheckRun.result, JSON.stringify({ diagnostic, precheckRun })).toMatchObject({
    status: "prechecked",
  });
  await sendDirectQwenCommand({
    type: "ROLLBACK_PROMPT",
    panelId: "",
    sessionId,
    turnId,
    prompt,
  });

  const composer = workspace.locator(".global-composer textarea");
  await composer.fill(prompt);
  await workspace.waitForTimeout(1_500);
  const nativeValue = await nativeComposer.evaluate((element) =>
    element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : element.textContent,
  );
  expect(nativeValue).not.toContain(prompt);
  await expect(composer).toBeFocused();
  await composer.fill("");
});

test("routes a prompt to a real ready website frame", async () => {
  const readyPanel = workspace.locator("article.provider-panel[data-provider='qwen']");
  await expect(readyPanel.locator(".panel-status.status-ready")).toBeVisible({ timeout: 45_000 });
  await selectOnlyTarget("qwen");

  await workspace
    .locator(".global-composer textarea")
    .fill("【官网路由验收】请只回复：网页统一提问正常");
  await workspace.getByRole("button", { name: "发送", exact: true }).click();

  await expect
    .poll(() => readyPanel.locator(".panel-status").textContent(), { timeout: 30_000 })
    .toMatch(/已发送|失败/);
  await expect(readyPanel.locator(".panel-status")).toContainText("已发送");
  await expect(workspace.locator(".history-list")).toContainText("官网路由验收");

  const runtimeSnapshot = await readRuntimeSnapshot();
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

async function readRuntimeSnapshot(): Promise<Record<string, unknown>> {
  return await worker.evaluate(async () => {
    const runtime = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: { get(key: string): Promise<Record<string, unknown>> };
        };
      };
    };
    return await runtime.chrome.storage.session.get("runtime-snapshot-v1");
  });
}

async function sendDirectQwenCommand(
  command: Record<string, unknown>,
): Promise<{ result: unknown; diagnostics: Record<string, unknown> }> {
  return await worker.evaluate(async (rawCommand) => {
    const runtime = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: { get(key: string): Promise<Record<string, unknown>> };
        };
        tabs: {
          sendMessage(
            tabId: number,
            message: unknown,
            options: { frameId: number },
          ): Promise<unknown>;
        };
      };
    };
    const stored = await runtime.chrome.storage.session.get("runtime-snapshot-v1");
    const snapshot = stored["runtime-snapshot-v1"] as {
      frames?: Array<{ frameId: number; panelId: string; providerId: string; tabId: number }>;
    };
    const frame = snapshot.frames?.find((candidate) => candidate.providerId === "qwen");
    if (!frame) throw new Error("千问 iframe 尚未注册");
    const result = await runtime.chrome.tabs.sendMessage(
      frame.tabId,
      { ...rawCommand, panelId: frame.panelId },
      { frameId: frame.frameId },
    );
    const diagnostics = await runtime.chrome.storage.session.get(
      `provider-diagnostics-v1:${frame.panelId}`,
    );
    return { result, diagnostics };
  }, command);
}

async function selectOnlyTarget(providerId: string): Promise<void> {
  await workspace.locator(".target-summary").click();
  const selector = workspace.getByRole("dialog", { name: "选择发送目标" });
  await selector.getByRole("button", { name: "清空" }).click();
  await selector.locator(`.target-option[data-provider='${providerId}'] input`).check();
  await workspace.locator(".global-composer textarea").click();
}
