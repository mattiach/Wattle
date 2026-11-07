import { SquarePen, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fromCalendarDate } from "@/lib/dates";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

interface SparkCardProps {
  onDelete: (spark: EntrySummary) => void;
  spark: EntrySummary;
}

/**
 * A spark as it is read back: a fragment, not a miniature entry.
 *
 * No title row, because a spark has no title. The rail down the leading edge
 * is the identity marker - the same one a spark carries in search results and
 * in a calendar day - and the whole card opens the spark's own page.
 *
 * The lock that used to sit on past sparks is gone. It implied an immutability
 * nothing in the database enforced, and it sat beside an Edit button, which is
 * the worst of both: either a spark is editable or it is not, and it is.
 */
export const SparkCard = ({ onDelete, spark }: SparkCardProps) => {
  const { i18n, t } = useTranslation();

  const handleConfirmDelete = useCallback(() => {
    onDelete(spark);
  }, [onDelete, spark]);

  // Both controls are siblings of the link, never children: an interactive
  // element cannot be nested inside an anchor.
  // The caller owns the list item, so the card can be wrapped in whatever the
  // surface needs - a plain `li` in the archive, an animated one on the sparks
  // page - without this component knowing about either.
  return (
    <div className="group/row relative">
      <Link
        className="group block rounded-xl outline-none"
        to={paths.sparks.detail.getHref(spark.id)}
      >
        <Card className="spark-rail flex h-full flex-col rounded-l-sm p-5 pl-4 transition-all duration-200 ease-out-soft group-hover:border-border group-hover:shadow-raise group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
          <p className="eyebrow text-faint">
            {new Intl.DateTimeFormat(i18n.language, {
              day: "numeric",
              month: "short",
            }).format(fromCalendarDate(spark.entryDate))}
          </p>
          <p className="mt-2.5 flex-1 pr-16 font-serif text-body-sm text-foreground/90 italic leading-relaxed">
            {spark.preview}
          </p>
        </Card>
      </Link>

      <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 ease-out-soft focus-within:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        <Button
          aria-label={t("edit")}
          className="text-muted-foreground"
          nativeButton={false}
          render={<Link to={paths.sparks.detail.getHref(spark.id, true)} />}
          size="icon-sm"
          variant="ghost"
        >
          <SquarePen />
        </Button>
        <ConfirmDialog
          confirmLabel={t("delete")}
          description={t("deleteSparkConfirm")}
          onConfirm={handleConfirmDelete}
          title={t("deleteSpark")}
          trigger={
            <Button
              aria-label={t("deleteSpark")}
              className="text-muted-foreground hover:text-destructive"
              size="icon-sm"
              type="button"
              variant="destructiveGhost"
            />
          }
        >
          <Trash2 />
        </ConfirmDialog>
      </div>
    </div>
  );
};
