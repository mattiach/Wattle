import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/layout/page-header";
import { paths } from "@/routing/paths";

interface SparkPageHeaderProps {
  /** Controls for the screen itself, pulled to the right of the title. */
  actions?: ReactNode;
  /** Left off on the sparks page, which is where the way back leads. */
  back?: boolean;
  /** One or two sentences on what this screen is for. Not on a single spark. */
  description?: string;
  /**
   * Absent while a page is still loading: the header stands alone. A node
   * rather than a string, because a spark's title *is* its date - and on that
   * screen the date is also the control that changes it.
   */
  title?: ReactNode;
}

/**
 * `PageHeader`, with the three things the spark screens always say.
 *
 * A shell rather than a header of its own: the shape, the spacing and the
 * hairline all live in `PageHeader` now, and what is left here is the subtitle
 * and the destination of the way back - the two facts that would otherwise be
 * repeated at four call sites. Moving between the sparks page, the archive and
 * a single spark should barely read as a page change, and this is what keeps
 * the three from drifting apart or from the rest of the application.
 */
export const SparkPageHeader = ({
  actions,
  back = false,
  description,
  title,
}: SparkPageHeaderProps) => {
  const { t } = useTranslation();

  return (
    <PageHeader
      actions={actions}
      backLabel={back ? t("dailySparks") : undefined}
      backTo={back ? paths.sparks.getHref() : undefined}
      description={description}
      subtitle={t("sparksEyebrow")}
      title={title}
    />
  );
};
