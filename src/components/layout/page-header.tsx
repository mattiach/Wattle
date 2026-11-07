import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { PageIntro } from "@/components/layout/page-intro";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  /** Controls for the screen itself, pulled to the right of the title. */
  actions?: ReactNode;
  /** Accessible name for the way back. Required whenever `backTo` is given. */
  backLabel?: string;
  /** Where the way back leads. Absent on a screen that is its own root. */
  backTo?: string;
  /**
   * One or two sentences on what this screen is for, under everything else.
   *
   * Every screen has one except the home screen, which opens on a greeting: an
   * application explaining its front door to someone already standing in it is
   * the definition of talking over the journal.
   */
  description?: string;
  /** Under the title, never over it. */
  subtitle?: ReactNode;
  /** Absent while a screen is still loading: the header stands empty. */
  title?: ReactNode;
  /** Anchors a guided-tour step to the title. */
  titleTourId?: string;
}

/**
 * The masthead every screen in the application opens with.
 *
 * There were three of these. The home screen and the spark screens put a line
 * of small caps *above* the title, settings set its title two steps smaller
 * than everyone else's and spaced its description differently, and the
 * calendar had neither. Same block, same job, three shapes - which is what made
 * moving between screens feel like moving between applications.
 *
 * The order here is the one the archive pages already used, and it is the order that
 * reads: **what this is**, then where it sits, then what it is for. A subtitle
 * above a title is a label on a box; a subtitle under one is a second thought
 * about it.
 *
 * The hairline is part of the header rather than the page: it separates reading
 * the header from acting on whatever is under it, and every screen wants that
 * separation in the same place.
 */
export const PageHeader = ({
  actions,
  backLabel,
  backTo,
  description,
  subtitle,
  title,
  titleTourId,
}: PageHeaderProps) => (
  <PageIntro className="border-hairline border-b pt-14 pb-6">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {/* Beside the title rather than above it: one line, read the way it is
            used - the way back, then where you are. Pulled left out of the
            column so the row's first ink still lands on the column edge. */}
        <div className="flex items-center gap-2.5">
          {backTo ? (
            <Button
              aria-label={backLabel}
              className="-ml-1.5 shrink-0 text-muted-foreground"
              nativeButton={false}
              render={<Link to={backTo} />}
              size="icon-sm"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
          ) : null}
          {title ? (
            <h1
              className="min-w-0 text-balance font-heading font-medium text-display text-foreground"
              data-tour-step-id={titleTourId}
            >
              {title}
            </h1>
          ) : null}
        </div>
        {subtitle ? (
          <p className="eyebrow mt-2 text-faint">{subtitle}</p>
        ) : null}
        {description ? (
          <p className="mt-3 max-w-prose text-meta text-muted-foreground leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {/* Pulled back out of the line's height: the controls are taller than the
          first line of a title, and letting them set the row would push the
          title below where the other screens put theirs. */}
      {actions ? (
        <div className="-my-1 flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </div>
  </PageIntro>
);
