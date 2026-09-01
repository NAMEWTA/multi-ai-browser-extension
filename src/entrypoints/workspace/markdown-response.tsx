import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export interface MarkdownResponseProps {
  content: string;
}

export function MarkdownResponse({ content }: MarkdownResponseProps) {
  return (
    <div className="markdown-response">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              target={href?.startsWith("http") ? "_blank" : undefined}
            >
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function safeMarkdownUrl(url: string): string {
  if (url.startsWith("#") || url.startsWith("mailto:")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}
