import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekStrategy } from "./strategy";

describe("DeepSeekStrategy", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="ds-icon-button" aria-label="附件">附件</button>
      <section class="composer-shell">
        <textarea class="ds-scroll-area"></textarea>
        <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled">
          <svg><path d="send" /></svg>
        </div>
      </section>
    `;
  });

  it("clicks the enabled primary circle nearest to the active composer", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const send = document.querySelector<HTMLElement>("div[role='button']")!;
    const unrelated = document.querySelector<HTMLButtonElement>("button")!;
    composer.addEventListener("input", () => send.classList.remove("ds-button--disabled"));
    const sendClick = vi.fn(() => {
      composer.value = "";
      send.classList.add("ds-button--disabled");
    });
    const unrelatedClick = vi.spyOn(unrelated, "click");
    send.addEventListener("click", sendClick);

    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    await strategy.stagePrompt(ctx, { text: "发送到 DeepSeek" });
    await strategy.submit(ctx);

    expect(sendClick).toHaveBeenCalledOnce();
    expect(unrelatedClick).not.toHaveBeenCalled();
  });

  it("never clicks the shared control while it is still the stop action", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const control = document.querySelector<HTMLElement>("div[role='button']")!;
    control.classList.remove("ds-button--disabled");
    const click = vi.spyOn(control, "click");

    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    await expect(strategy.stagePrompt(ctx, { text: "下一轮问题" })).rejects.toMatchObject({
      code: "PROVIDER_BUSY",
    });
    expect(click).not.toHaveBeenCalled();

    composer.value = "下一轮问题";
  });

  it("allows sending after the shared control changes back from stop to send", async () => {
    const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const control = document.querySelector<HTMLElement>("div[role='button']")!;
    control.classList.remove("ds-button--disabled");
    const strategy = new DeepSeekStrategy();
    const ctx = { document, window, timeoutMs: 100 };
    await strategy.prepareSubmit(ctx);
    composer.addEventListener("input", () => {
      control.innerHTML = '<svg><path d="new-send" /></svg>';
    });
    await strategy.stagePrompt(ctx, { text: "等待后的问题" });
    control.addEventListener("click", () => {
      composer.value = "";
    });

    await expect(strategy.submit(ctx)).resolves.toBeUndefined();
  });
});
