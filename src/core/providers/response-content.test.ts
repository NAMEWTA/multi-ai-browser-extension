import { describe, expect, it } from "vitest";
import { readResponseContent, responseElementToMarkdown } from "./response-content";

describe("response content", () => {
  it("converts semantic response HTML to GFM and removes page controls", () => {
    document.body.innerHTML = `
      <article id="response">
        <div class="answer">
          <h2>Go 入门</h2>
          <p><strong>并发</strong>参考<a href="https://go.dev/">官方文档</a>。</p>
          <pre><code class="language-go">fmt.Println("hello")</code></pre>
          <table><thead><tr><th>名称</th><th>用途</th></tr></thead>
            <tbody><tr><td>Gin</td><td>Web</td></tr></tbody></table>
          <div class="thinking">内部推理</div>
          <button aria-label="Copy">复制</button>
        </div>
      </article>
    `;
    const response = document.querySelector<HTMLElement>("#response")!;
    const markdown = responseElementToMarkdown(response, {
      content: [".answer"],
      exclude: [".thinking"],
    });

    expect(markdown).toContain("## Go 入门");
    expect(markdown).toContain("**并发**");
    expect(markdown).toContain("[官方文档](https://go.dev/)");
    expect(markdown).toContain('```go\nfmt.Println("hello")\n```');
    expect(markdown).toContain("| 名称 | 用途 |");
    expect(markdown).not.toContain("内部推理");
    expect(markdown).not.toContain("复制");
  });

  it("deduplicates nested selector matches and assigns stable response keys", () => {
    document.body.innerHTML = `
      <article class="response" data-message-id="one"><div class="content"><p>第一条</p></div></article>
      <article class="response" data-message-id="two"><div class="content"><p>第二条</p></div></article>
      <article class="response" data-message-id="hidden" hidden><div class="content">隐藏</div></article>
    `;

    const snapshots = readResponseContent(document, {
      roots: [".response", ".content"],
      content: [".content"],
    });

    expect(snapshots.map(({ key, text, markdown }) => ({ key, text, markdown }))).toEqual([
      { key: "data-message-id:one", text: "第一条", markdown: "第一条" },
      { key: "data-message-id:two", text: "第二条", markdown: "第二条" },
    ]);
  });

  it("does not stop at a narrow heading block when a later selector covers the full answer", () => {
    document.body.innerHTML = `
      <article class="response" data-message-id="current">
        <div class="answer">
          <div class="markdown"><h1>你好</h1></div>
          <div class="answer-detail">
            <p>这是完整回答的第一段。</p>
            <ul><li>第一项</li><li>最后一项</li></ul>
          </div>
        </div>
      </article>
    `;

    const [snapshot] = readResponseContent(document, {
      roots: [".response"],
      content: [".answer .markdown", ".answer"],
    });

    expect(snapshot?.markdown).toContain("# 你好");
    expect(snapshot?.markdown).toContain("这是完整回答的第一段。");
    expect(snapshot?.text).toContain("最后一项");
  });
});
