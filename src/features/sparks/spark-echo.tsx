import { X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { relativeDaysAgo } from "@/lib/dates";
import {
  arrivalAnimate,
  arrivalInitial,
  arrivalTransition,
} from "@/lib/motion";
import type { SparkEcho as SparkEchoModel } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

interface SparkEchoProps {
  echo: SparkEchoModel | null;
  onDismiss: () => void;
}

/**
 * One older spark, returned.
 *
 * Deliberately not On This Day. A memory is about a date coming round again
 * and says "one year ago"; this is about something a person left for
 * themselves and says how long ago in plain relative time. Two mechanisms, two
 * meanings - and never both on the same screen, so the home page cannot turn
 * into a wall of looking back.
 *
 * It recedes: the memory foreground, a barely-tinted surface, and the spark
 * rail so it is still visibly a spark. It arrives once, on mount, with a fade
 * and six pixels of rise - which is meaningful when reduced motion strips the
 * movement away and leaves the fade.
 */
export const SparkEcho = ({ echo, onDismiss }: SparkEchoProps) => {
  const { i18n, t } = useTranslation();

  if (!echo) {
    return null;
  }

  return (
    <motion.section
      animate={arrivalAnimate}
      initial={arrivalInitial}
      transition={arrivalTransition}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="eyebrow text-faint">{t("writeOnThisDay")}</h2>
        <Button
          aria-label={t("dismiss")}
          className="text-muted-foreground"
          onClick={onDismiss}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <Link
        className="group block rounded-xl outline-none"
        to={paths.sparks.detail.getHref(echo.id)}
      >
        <Card className="spark-rail rounded-l-sm border-hairline bg-memory-surface p-5 pl-4 transition-all duration-200 ease-out-soft group-hover:border-border group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
          <p className="text-memory text-meta">{t("sparkEchoLead")}</p>
          <p className="mt-2 font-serif text-body-sm text-memory italic leading-relaxed">
            {echo.preview}
          </p>
          <p className="mt-3 text-memory text-meta first-letter:uppercase">
            {relativeDaysAgo(i18n.language, echo.daysAgo)}
          </p>
        </Card>
      </Link>
    </motion.section>
  );
};
