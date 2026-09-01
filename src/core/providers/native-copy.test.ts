import { describe, expect, it, vi } from "vitest";
import type { NativeCopyAdapter, NativeCopyClient } from "./contracts";
import { captureNativeResponse, validateNativeCopy } from "./native-copy";

describe("native response copy", () => {
  it("captures the provider button payload as the canonical terminal response", async () => {
    document.body.innerHTML = "<article><p>DOM answer</p><button>copy</button></article>";
    const element = document.querySelector<HTMLElement>("article")!;
    const button = document.querySelector<HTMLButtonElement>("button")!;
    const client: NativeCopyClient = {
      capture: vi.fn().mockResolvedValue({
        text: "# Complete answer\n\nMiddle\n\nEnd",
        mimeType: "text/markdown",
      }),
    };
    const adapter: NativeCopyAdapter = {
      id: "test",
      locateCopyButton: () => button,
    };

    await expect(
      captureNativeResponse(
        adapter,
        { document, window, nativeCopy: client },
        {
          element,
          key: "turn:1",
          candidateId: "test:final",
          tierId: "test",
          tierIndex: 0,
          source: "final-container",
          blockCount: 1,
          quality: 1,
          hasFinalContainer: true,
          statusOnly: false,
          text: "DOM answer",
          markdown: "DOM answer",
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      captureSource: "native-copy",
      nativeMimeType: "text/markdown",
      markdown: expect.stringContaining("End"),
    });
  });

  it("rejects a native payload that is materially shorter than the DOM snapshot", () => {
    expect(
      validateNativeCopy(
        { text: "title", mimeType: "text/plain" },
        { text: "x".repeat(500), markdown: "x".repeat(500) },
      ),
    ).toBeUndefined();
  });

  it("converts an HTML-only native payload instead of reusing a shorter DOM snapshot", () => {
    expect(
      validateNativeCopy(
        {
          text: "<h2>Complete answer</h2><p><strong>Native</strong> ending.</p>",
          mimeType: "text/html",
        },
        { text: "DOM", markdown: "DOM" },
        document,
      ),
    ).toMatchObject({
      text: "Complete answer\nNative ending.",
      markdown: "## Complete answer\n\n**Native** ending.",
    });
  });

  it("rejects a long but truncated payload that is missing the DOM ending", () => {
    const ending = "END-SENTINEL-OF-THE-COMPLETE-ANSWER";
    const dom = `${"complete middle ".repeat(80)}${ending}`;
    expect(
      validateNativeCopy(
        { text: "complete middle ".repeat(40), mimeType: "text/plain" },
        { text: dom, markdown: dom },
      ),
    ).toBeUndefined();
  });
});
