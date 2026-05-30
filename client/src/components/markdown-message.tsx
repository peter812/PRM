import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

/**
 * Renders assistant chat content as Markdown.
 *
 * Security note: react-markdown does NOT render raw HTML by default (no
 * rehype-raw plugin is enabled here), so embedded HTML in model output is
 * escaped and shown as text rather than executed. This avoids XSS from
 * untrusted model output. remark-gfm adds tables, task lists, strikethrough
 * and autolinks. Links are forced to open in a new tab with noopener.
 */
export function MarkdownMessage({ content, className }: MarkdownMessageProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:rounded-md",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2",
        className,
      )}
      data-testid="markdown-content"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          code: ({ node, className: codeClass, children, ...props }) => {
            const isInline = !String(codeClass ?? "").includes("language-");
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-sm", codeClass)} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
