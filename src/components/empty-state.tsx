import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** A single control, when there is something useful to offer. */
  action?: ReactNode;
  body?: string;
  className?: string;
  title: string;
}

/**
 * Nothing here, said the same way everywhere.
 *
 * The copy stays per screen - an empty journal, a search with no match and a
 * failed read are three different facts and must not be flattened into one
 * sentence. What this fixes is the shape, which had drifted apart across home,
 * the archive and the calendar.
 */
export const EmptyState = ({
  action,
  body,
  className,
  title,
}: EmptyStateProps) => (
  <div className={cn("flex flex-col items-center text-center", className)}>
    <p className="max-w-sm text-balance font-heading text-[1.35rem] text-foreground/90 leading-snug">
      {title}
    </p>
    {body ? (
      <p className="mt-4 max-w-sm text-balance text-meta text-muted-foreground leading-relaxed">
        {body}
      </p>
    ) : null}
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
);
