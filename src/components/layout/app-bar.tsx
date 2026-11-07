import { motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AppBarProps {
  children: ReactNode;
  /** Matches the bar content to the width of the page below it. */
  width?: "column" | "reading";
}

/**
 * `fixed` rather than `sticky`, and a `motion.header` rather than a plain one,
 * for the pill inside it - see the note in `floating-nav`. Motion adds the
 * document scroll to every layout measurement unless an ancestor in its
 * projection tree is a scroll root, and only `position: fixed` counts as one; a
 * sticky bar is pinned to the viewport but still measured as if it were scrolling
 * away, so any change in scroll across a navigation turned the pill's horizontal
 * slide into a diagonal one. The height this stops occupying is given back as
 * padding in `AppLayout`.
 */
export const AppBar = ({ children, width = "column" }: AppBarProps) => (
  <motion.header
    className="fixed inset-x-0 top-0 z-20 border-hairline border-b bg-background/80 backdrop-blur-md"
    layoutScroll
  >
    <div
      className={cn(
        "mx-auto flex h-14 w-full items-center justify-between gap-4 px-6",
        width === "reading" ? "max-w-reading" : "max-w-column"
      )}
    >
      {children}
    </div>
  </motion.header>
);
