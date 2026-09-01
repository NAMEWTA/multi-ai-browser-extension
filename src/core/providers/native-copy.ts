import type {
  FrameContext,
  NativeCopyAdapter,
  NativeCopyMimeType,
  NativeCopyPayload,
  ResponseCaptureUpdate,
} from "./contracts";
import { responseHtmlToMarkdown, type ResponseContentSnapshot } from "./response-content";

const NATIVE_COPY_TIMEOUT_MS = 2_000;

export async function captureNativeResponse(
  adapter: NativeCopyAdapter | undefined,
  ctx: FrameContext,
  snapshot: ResponseContentSnapshot,
): Promise<ResponseCaptureUpdate | undefined> {
  if (!adapter || !ctx.nativeCopy) return undefined;
  let button = adapter.locateCopyButton(ctx, snapshot.element);
  if (!button && adapter.prepareCopy) {
    await adapter.prepareCopy(ctx, snapshot.element, undefined);
    button = adapter.locateCopyButton(ctx, snapshot.element);
  }
  if (!button || adapter.isReady?.(ctx, snapshot.element, button) === false) return undefined;

  await adapter.prepareCopy?.(ctx, snapshot.element, button);
  const captured = await ctx.nativeCopy.capture({
    button,
    timeoutMs: NATIVE_COPY_TIMEOUT_MS,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    suppressSystemClipboard: true,
  });
  const payload =
    adapter.normalize?.(captured, {
      turnKey: snapshot.key,
      domText: snapshot.text,
      domMarkdown: snapshot.markdown,
    }) ?? captured;
  const validated = validateNativeCopy(payload, snapshot, snapshot.element.ownerDocument);
  if (!validated) return undefined;

  return {
    status: "completed",
    terminalReason: "completed",
    text: validated.text,
    markdown: validated.markdown,
    captureSource: "native-copy",
    nativeMimeType: payload.mimeType,
  };
}

export function validateNativeCopy(
  payload: NativeCopyPayload,
  snapshot: Pick<ResponseContentSnapshot, "text" | "markdown">,
  document: Document = globalThis.document,
): { text: string; markdown: string } | undefined {
  const value = normalize(payload.text);
  if (!value) return undefined;
  const domText = normalize(snapshot.text);
  const domMarkdown = normalize(snapshot.markdown);
  const nativeText = plainText(value, payload.mimeType, document);
  const minimumLength = Math.min(256, Math.floor(domText.length * 0.35));
  if (domText && nativeText.length < minimumLength) return undefined;
  if (!containsEndingAnchor(nativeText, domText)) return undefined;

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
