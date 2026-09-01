import type {
  FrameContext,
  NativeCopyAdapter,
  NativeCopyMimeType,
  NativeCopyPayload,
  NativeCopyTarget,
  PromptPayload,
  ResponseCaptureUpdate,
} from "./contracts";
import { responseHtmlToMarkdown, type ResponseContentSnapshot } from "./response-content";

const NATIVE_COPY_TIMEOUT_MS = 2_000;

export async function captureNativeResponse(
  adapter: NativeCopyAdapter | undefined,
  ctx: FrameContext,
  snapshot: ResponseContentSnapshot,
  prompt?: PromptPayload,
): Promise<ResponseCaptureUpdate | undefined> {
  if (!adapter || !ctx.nativeCopy) return undefined;
  let button = adapter.locateCopyButton(ctx, snapshot.element);
  if (!button && adapter.prepareCopy) {
    await adapter.prepareCopy(ctx, snapshot.element, undefined);
    button = adapter.locateCopyButton(ctx, snapshot.element);
  }
  if (!button || adapter.isReady?.(ctx, snapshot.element, button) === false) return undefined;

  return await captureNativeTarget(
    adapter,
    ctx,
    { key: snapshot.key, response: snapshot.element, button },
    snapshot,
    prompt,
  );
}

export async function captureNativeTarget(
  adapter: NativeCopyAdapter,
  ctx: FrameContext,
  target: NativeCopyTarget,
  snapshot?: ResponseContentSnapshot,
  prompt?: PromptPayload,
): Promise<ResponseCaptureUpdate | undefined> {
  const attempts = Math.max(1, Math.min(adapter.capturePolicy?.maxAttempts ?? 1, 3));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const button =
      attempt === 0
        ? target.button
        : (adapter.locateCopyButton(ctx, target.response) ?? target.button);
    if (
      !target.response.isConnected ||
      !button.isConnected ||
      adapter.isReady?.(ctx, target.response, button) === false
    ) {
      return undefined;
    }

    try {
      await adapter.prepareCopy?.(ctx, target.response, button);
      const captured = await ctx.nativeCopy!.capture({
        button,
        timeoutMs: NATIVE_COPY_TIMEOUT_MS,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        suppressSystemClipboard: true,
      });
      const payload =
        adapter.normalize?.(captured, {
          turnKey: target.key,
          domText: snapshot?.text ?? "",
          domMarkdown: snapshot?.markdown ?? "",
          ...(prompt?.text ? { prompt: prompt.text } : {}),
        }) ?? captured;
      if (prompt?.text && searchable(payload.text) === searchable(prompt.text)) continue;
      const validated = validateNativeCopy(
        payload,
        snapshot,
        target.response.ownerDocument,
        adapter.capturePolicy,
      );
      if (!validated) continue;

      return {
        status: "completed",
        terminalReason: "completed",
        text: validated.text,
        markdown: validated.markdown,
        captureSource: "native-copy",
        nativeMimeType: payload.mimeType,
      };
    } catch (error) {
      if (ctx.signal?.aborted || attempt === attempts - 1) throw error;
    }
  }
  return undefined;
}

export function validateNativeCopy(
  payload: NativeCopyPayload,
  snapshot?: Pick<ResponseContentSnapshot, "text" | "markdown">,
  document: Document = globalThis.document,
  policy: { readonly requireDomEndingAnchor?: boolean } = {},
): { text: string; markdown: string } | undefined {
  const value = normalize(payload.text);
  if (!value) return undefined;
  if (isCopyConfirmation(value)) return undefined;
  const domText = normalize(snapshot?.text ?? "");
  const domMarkdown = normalize(snapshot?.markdown ?? "");
  const nativeText = plainText(value, payload.mimeType, document);
  const minimumLength = Math.min(256, Math.floor(domText.length * 0.35));
  if (domText && nativeText.length < minimumLength) return undefined;
  if (policy.requireDomEndingAnchor !== false && !containsEndingAnchor(nativeText, domText)) {
    return undefined;
  }

  const markdown = nativeMarkdown(value, payload.mimeType, domMarkdown, document);
  return { text: nativeText, markdown };
}

function nativeMarkdown(
  value: string,
  mimeType: NativeCopyMimeType,
  domMarkdown: string,
  document: Document,
): string {
  if (mimeType === "text/html") {
    return (
      responseHtmlToMarkdown(value, document) || domMarkdown || plainText(value, mimeType, document)
    );
  }
  return value;
}

function plainText(value: string, mimeType: NativeCopyMimeType, document: Document): string {
  if (mimeType !== "text/html") return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  return normalize(renderHtmlText(container)).replace(/\n{3,}/g, "\n\n");
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "DIV",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

function renderHtmlText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";
  const content = [...element.childNodes].map(renderHtmlText).join("");
  return BLOCK_TAGS.has(element.tagName) ? `${content}\n` : content;
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function containsEndingAnchor(nativeText: string, domText: string): boolean {
  const normalizedDom = searchable(domText);
  if (normalizedDom.length < 120) return true;
  const anchor = normalizedDom.slice(-32);
  return searchable(nativeText).includes(anchor);
}

function searchable(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s#*_`>(){}~|\\-]+/g, "");
}

function isCopyConfirmation(value: string): boolean {
  return /^(copied|copy successful|copied to clipboard|已复制|复制成功)[.!。！]?$/i.test(value);
}
