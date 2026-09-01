import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./text-transfer";

describe("text transfer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes the complete transcript to the clipboard without transforming it", async () => {
    const markdown = "# 你好\n\n这是完整回答。\n\nLINE-001\n\nMID-SENTINEL\n\nEND-SENTINEL";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyText(markdown);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(markdown);
  });
});
