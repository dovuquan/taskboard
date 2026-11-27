import type { ReactNode } from "react";

import { navigate } from "../routes";

/** An anchor that changes screen without a page load; modified clicks keep their default. */
export function Link({
  to,
  className,
  children,
  title,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <a
      className={className}
      href={to}
      title={title}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
