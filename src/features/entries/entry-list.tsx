import { Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fromCalendarDate } from "@/lib/dates";
import { springTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

/**
 * A row arriving and a row leaving, the same way a spark does on its own page.
 *
 * Enter rises; exit fades and settles back, and the rows below glide up to
 * close the gap rather than jumping into it. Both read correctly as pure
 * opacity when the operating system asks for reduced motion.
 */
const rowInitial = { opacity: 0, y: 8 };
const rowAnimate = { opacity: 1, y: 0 };
const rowExit = { opacity: 0, scale: 0.97 };

/**
 * Consecutive entries split into the months they belong to.
 *
 * Exported because the spark archive groups the same way: one pattern, two
 * lists, and the same `YYYY-MM` key feeding the same month heading.
 */
export const groupByMonth = (entries: EntrySummary[]) => {
  const groups: { entries: EntrySummary[]; key: string }[] = [];
  for (const entry of entries) {
    const key = entry.entryDate.slice(0, 7);
    const currentGroup = groups.at(-1);
    if (currentGroup?.key === key) {
      currentGroup.entries.push(entry);
    } else {
      groups.push({ entries: [entry], key });
    }
  }
  return groups;
};

/**
 * The date rail every list of entries is read against: the day at reading
 * size, and the finer detail under it.
 *
 * Exported because search results are the same list answering a different
 * question - one rail, so a row is placed in time the same way whether it was
 * browsed to or searched for.
 */
export const EntryDateRail = ({
  entry,
  repeated = false,
}: {
  entry: EntrySummary;
  /**
   * True when the row above this one is already filed under the same day. A day
   * is written once and then held: repeating "19 / Tuesday" down a column of
   * entries written on the same afternoon is the list saying the same thing
   * three times. The rail keeps its width, so the cards stay in one line.
   */
  repeated?: boolean;
  /**
   * Ranked results are not grouped under a month heading, so there the rail
   * has to name the month itself - a bare day number would place a row in no
   * particular one.
   */
  showMonth?: boolean;
}) => {
  const { i18n } = useTranslation();

  if (repeated) {
    return <div />;
  }

  const date = fromCalendarDate(entry.entryDate);

  // No clock. The hour an entry was last touched is not how anyone finds it
  // again, and it made a second entry on the same day look like a different
  // day at a glance.
  const caption = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
  }).format(date);

  return (
    <div className="pt-4">
      <p className="pr-4 font-heading font-light text-foreground text-title tabular-nums">
        {new Intl.DateTimeFormat(i18n.language, { day: "numeric" }).format(
          date
        )}
      </p>
      {/* The date rail never wraps: a two-line weekday would push the card out
          of alignment with the ones above and below it. */}
      <p className="mt-2 truncate whitespace-nowrap text-meta text-muted-foreground capitalize leading-tight">
        {caption}
      </p>
    </div>
  );
};

/** The grid a row is laid out on: the date rail, then the card. */
export const ENTRY_ROW_GRID =
  "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-6";

interface EntryRowProps {
  entry: EntrySummary;
  onDelete: (entry: EntrySummary) => void;
  /** The row above is filed under the same day, so this one does not say it. */
  repeated?: boolean;
}

const EntryRow = ({ entry, onDelete, repeated }: EntryRowProps) => {
  const { t } = useTranslation();

  const handleConfirmDelete = useCallback(() => {
    onDelete(entry);
  }, [entry, onDelete]);

  // The delete control is a sibling of the link, never a child: an interactive
  // element cannot be nested inside an anchor. It sits in the card's top-right
  // corner, which the heading keeps clear with its own right padding.
  return (
    <motion.li
      animate={rowAnimate}
      className="group/row relative"
      exit={rowExit}
      initial={rowInitial}
      // `layout="position"` rather than full layout: only the offsets are
      // animated when a neighbour leaves, so a long timeline never re-measures
      // every card's box on every frame.
      layout="position"
      transition={springTransition}
    >
      <Link
        className={cn("group rounded-xl outline-none", ENTRY_ROW_GRID)}
        to={paths.entries.detail.getHref(entry.id)}
      >
        <EntryDateRail entry={entry} repeated={repeated} />

        <Card className="p-5 transition-all duration-200 ease-out-soft group-hover:border-border group-hover:shadow-raise group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
          <h3 className="pr-10 font-heading font-medium text-[1.125rem] text-foreground leading-snug">
            {entry.title || (
              <span className="text-faint italic">{t("untitled")}</span>
            )}
          </h3>
          {entry.preview ? (
            <p className="mt-2 line-clamp-2 text-body-sm text-muted-foreground leading-relaxed">
              {entry.preview}
            </p>
          ) : null}
        </Card>
      </Link>

      <ConfirmDialog
        confirmLabel={t("delete")}
        description={t("deleteEntryConfirm")}
        onConfirm={handleConfirmDelete}
        title={t("deleteEntry")}
        trigger={
          <Button
            aria-label={t("deleteEntry")}
            className="absolute top-3 right-3 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-soft hover:text-destructive focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
            size="icon-sm"
            type="button"
            variant="destructiveGhost"
          />
        }
      >
        <Trash2 />
      </ConfirmDialog>
    </motion.li>
  );
};

interface EntryListProps {
  entries: EntrySummary[];
  onDelete: (entry: EntrySummary) => void;
}

export const EntryList = ({ entries, onDelete }: EntryListProps) => {
  const { i18n } = useTranslation();

  return (
    <div className="flex flex-col gap-10">
      {groupByMonth(entries).map((group) => (
        <section key={group.key}>
          <h2 className="eyebrow mb-3 px-0 text-faint">
            {new Intl.DateTimeFormat(i18n.language, {
              month: "long",
              year: "numeric",
            }).format(new Date(`${group.key}-01T00:00:00`))}
          </h2>
          <ul className="flex flex-col gap-4">
            {/* `initial={false}`: a page of entries that was already there
                does not animate in. Only what actually arrives or leaves
                afterwards moves, which is the only thing worth saying. */}
            <AnimatePresence initial={false}>
              {group.entries.map((entry, index) => (
                <EntryRow
                  entry={entry}
                  key={entry.id}
                  onDelete={onDelete}
                  repeated={
                    group.entries[index - 1]?.entryDate === entry.entryDate
                  }
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
};
