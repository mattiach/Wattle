import { motion } from "motion/react";
import type { ReactNode } from "react";

import {
  pageIntroAnimate,
  pageIntroInitial,
  pageIntroTransition,
} from "@/lib/motion";

interface PageIntroProps {
  children: ReactNode;
  className?: string;
  /** Seconds to wait, so a header can lead and the list follow it in. */
  delay?: number;
  /** Anchors a guided-tour step to the block this brings in. */
  tourStepId?: string;
}

/**
 * A block arriving with the screen it belongs to.
 *
 * Mount-only, on purpose. Nothing animates on the way *out*, so leaving a
 * screen is never held up by a transition - which matters most on the entry
 * page, where the exit path flushes autosave and reconciles attachments.
 *
 * Small delays let a screen resolve in order (masthead, then controls, then
 * the list) instead of everything appearing at once. Nothing moves while it
 * does: see `pageIntroInitial`.
 */
export const PageIntro = ({
  children,
  className,
  delay,
  tourStepId,
}: PageIntroProps) => (
  <motion.div
    animate={pageIntroAnimate}
    className={className}
    data-tour-step-id={tourStepId}
    initial={pageIntroInitial}
    transition={pageIntroTransition(delay)}
  >
    {children}
  </motion.div>
);
