"use client";

/**
 * MarkdownLite — renders a result comment's plain text with line breaks and
 * auto-linked http(s) URLs (docs/PRD-plans-runs.md decision 4). The parse lives
 * in `lib/markdown-lite`; this file only turns the nodes into React elements, so
 * a comment can never inject HTML (no `dangerouslySetInnerHTML`).
 */
import { Fragment, type ReactElement } from "react";
import { parseMarkdownLite } from "@/lib/markdown-lite";

export interface MarkdownLiteProps {
  text: string;
  className?: string;
}

export function MarkdownLite({
  text,
  className,
}: MarkdownLiteProps): ReactElement {
  const nodes = parseMarkdownLite(text);
  return (
    <p className={className}>
      {nodes.map((node, index) => {
        if (node.kind === "break") return <br key={index} />;
        if (node.kind === "link") {
          return (
            <a
              key={index}
              href={node.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {node.text}
            </a>
          );
        }
        return <Fragment key={index}>{node.text}</Fragment>;
      })}
    </p>
  );
}