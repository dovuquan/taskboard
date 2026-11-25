import type { ReactNode } from "react";

import { type Inline, parseMarkdown, shortUrl } from "../cards/markdown";

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return node.v;
      case "bold":
        return <strong key={i}>{inline(node.c)}</strong>;
      case "italic":
        return <em key={i}>{inline(node.c)}</em>;
      case "code":
        return <code key={i}>{node.v}</code>;
      case "link":
        return (
          <a
            key={i}
            className="ext"
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            title={node.href}
          >
            {node.label ?? shortUrl(node.href)}
          </a>
        );
    }
  });
}

/** A description as React elements. Text is never read as HTML, and only http(s) links are made. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      {parseMarkdown(source).map((block, i) =>
        block.t === "p" ? (
          <p key={i}>{inline(block.c)}</p>
        ) : (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
