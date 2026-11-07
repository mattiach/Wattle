import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

interface SettingsSectionProps {
  children: ReactNode;
  description?: string;
  title: string;
  /** Anchors a guided-tour step to this section. */
  tourStepId?: string;
}

/**
 * A titled block of settings rows: a heading, a line saying why, and the card
 * the rows stand in.
 *
 * Shared by the settings page and the AI page rather than written twice. The
 * two screens are the same kind of screen - a column of decisions, read down
 * the same edge - and the AI page had drifted into one unlabelled card holding
 * everything, which is what a heading exists to prevent.
 */
export const SettingsSection = ({
  children,
  description,
  tourStepId,
  title,
}: SettingsSectionProps) => (
  <section data-tour-step-id={tourStepId}>
    <h2 className="font-heading font-medium text-[1.05rem] text-foreground leading-none">
      {title}
    </h2>
    {description ? (
      <p className="mt-1.5 text-muted-foreground text-xs leading-snug">
        {description}
      </p>
    ) : null}
    <Card className="mt-3 divide-y divide-hairline">{children}</Card>
  </section>
);
