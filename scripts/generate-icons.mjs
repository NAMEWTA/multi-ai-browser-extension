import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const outputDir = path.join(root, "public", "icon");
const svg = await readFile(path.join(root, "scripts", "icon-source.svg"), "utf8");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;width:${size}px;height:${size}px;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({
      path: path.join(outputDir, `${size}.png`),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
