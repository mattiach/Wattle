import { Trash2 } from "lucide-react";
import { Fragment, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ENTRY_ROW_GRID, EntryDateRail } from "@/features/entries/entry-list";
import { cn } from "@/lib/utils";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

/** Where a result leads, which is decided entirely by what kind of writing it
 * is. Three surfaces, one list. */
const letterAwarePath = (entry: EntrySummary): string => {
  if (entry.kind === "letter") {
    return paths.letters.detail.getHref(entry.id);
  }
  if (entry.kind === "spark") {
    return paths.sparks.detail.getHref(entry.id);
  }
  return paths.entries.detail.getHref(entry.id);
};

/**
 * The markers SQLite's `snippet()` wraps each matching run in. Control
 * characters, so nothing a person could write into their journal is mistaken
 * for a highlight.
 */
const HIGHLIGHT_OPEN = "\u0002";
const HIGHLIGHT_CLOSE = "\u0003";

/**
 * Splits a snippet into plain and matched runs.
 *
 * Splitting on the markers rather than injecting HTML: the entry's own words go
 * into the document as text, never as markup.
 */
interface SnippetPart {
  isMatch: boolean;
  /** Where the run starts in the snippet, which is its stable identity. */
  offset: number;
  text: string;
}

const toHighlightedParts = (snippet: string): SnippetPart[] => {
  const parts: SnippetPart[] = [];
  let offset = 0;

  for (const [index, chunk] of snippet.split(HIGHLIGHT_OPEN).entries()) {
    if (index === 0) {
      if (chunk) {
        parts.push({ isMatch: false, offset, text: chunk });
        offset += chunk.length;
      }
      continue;
    }
    const [matched = "", rest = ""] = chunk.split(HIGHLIGHT_CLOSE);
    parts.push({ isMatch: true, offset, text: matched });
    offset += matched.length;
    if (rest) {
      parts.push({ isMatch: false, offset, text: rest });
      offset += rest.length;
    }
  }

  return parts;
};

/**
 * A snippet with its matching runs marked. Exported because the spark archive
 * searches the same index and must highlight it the same way - one
 * implementation, two surfaces.
 */
export const Snippet = ({
  className,
  snippet,
}: {
  className?: string;
  snippet: string;
}) => (
  <p
    className={
      className ?? "mt-2 text-body-sm text-muted-foreground leading-relaxed"
    }
  >
    {toHighlightedParts(snippet).map((part) => (
      <Fragment key={part.offset}>
        {part.isMatch ? (
          <mark className="rounded-[0.2rem] bg-wattle/25 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        )}
      </Fragment>
    ))}
  </p>
);

/**
 * Whatever stands at the top of the card: a title, or the one word that says
 * what this is instead.
 *
 * An entry has a title. A letter has never had one - its identity is its two
 * dates - so it wears a label. A spark has no title either, and wherever it has
 * given up its rail it wears the same label, which is then the whole of what
 * tells the two apart.
 */
const CardHeading = ({ entry, uniform }: EntryHeadingProps) => {
  const { t } = useTranslation();

  if (entry.kind === "letter") {
    return (
      <p className="eyebrow mb-1.5 text-memory">{t("letterResultLabel")}</p>
    );
  }

  if (entry.kind === "spark") {
    return uniform ? (
      <p className="eyebrow mb-1.5 text-wattle-ink">{t("sparkResultLabel")}</p>
    ) : null;
  }

  return (
    <h3 className="pr-10 font-heading font-medium text-[1.125rem] text-foreground leading-snug">
      {entry.title || (
        <span className="text-faint italic">{t("untitled")}</span>
      )}
    </h3>
  );
};

interface EntryHeadingProps {
  entry: EntrySummary;
  uniform?: boolean;
}

interface EntryResultRowProps {
  entry: EntrySummary;
  /** Left off where a list is only for reading, as the calendar's day is. */
  onDelete?: (entry: EntrySummary) => void;
  /**
   * One card shape for every kind, whatever was written.
   *
   * A spark ordinarily wears its rail: a clipped left corner, its own padding
   * and its text set in the reading face. That is right in a list *of* sparks
   * and on the home screen, where the two kinds are gathered under different
   * headings. It is wrong in the calendar's day, where entries and sparks are
   * a single answer to "what did I write on the 4th" and two card shapes read
   * as two lists. Here the shape is the same for both and the kind is said in
   * a word above the text, exactly as a letter already says it.
   */
  uniform?: boolean;
}

/**
 * One entry as a card with its date rail, either kind.
 *
 * Exported because the calendar's day shows the same thing a search result
 * does - an entry found by asking a question about it - and a day's results
 * should read exactly like the home screen's, down to the spacing.
 */
export const EntryResultRow = ({
  entry,
  onDelete,
  uniform,
}: EntryResultRowProps) => {
  const { t } = useTranslation();
  const isSpark = entry.kind === "spark";
  // An opened letter, found by searching for what it said. It reaches this list
  // through its own index and only once it has actually been read - a sealed
  // letter has no text to find, and a draft is deliberately kept out.
  const isLetter = entry.kind === "letter";

  const handleConfirmDelete = useCallback(() => {
    onDelete?.(entry);
  }, [entry, onDelete]);

  // In uniform mode a spark is given the eyebrow a letter has, so its text
  // sits under a line the same way an entry's sits under a title.
  const wearsSparkRail = isSpark && !uniform;

  const bodyClassName = cn(
    "text-body-sm text-muted-foreground leading-relaxed",
    // Neither a spark nor a letter has a heading above its text, so there is
    // nothing for it to sit under. A letter is set in the reading face for the
    // same reason it is on its own page: it is prose, not a note.
    wearsSparkRail || isLetter
      ? "pr-10 font-serif text-foreground/90 italic"
      : "mt-2"
  );

  // Same shape as the browse list, date rail included: a result is a row of
  // the same timeline, so it is placed in time the same way rather than
  // carrying its date inside the card. The delete control is a sibling of the
  // link, never a child, because an interactive element cannot nest inside an
  // anchor.
  return (
    <li className="group/row relative">
      <Link
        className={cn("group rounded-xl outline-none", ENTRY_ROW_GRID)}
        to={letterAwarePath(entry)}
      >
        <EntryDateRail entry={entry} showMonth />

        {/* A spark carries its rail here too, so a one-line result is
            recognisable as a spark without reading it - except where the list
            it is in wants one shape for everything, and says the kind in words
            instead. */}
        <Card
          className={cn(
            "p-5 transition-all duration-200 ease-out-soft group-hover:border-border group-hover:shadow-raise group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60",
            wearsSparkRail && "spark-rail rounded-l-sm pl-4"
          )}
        >
          <CardHeading entry={entry} uniform={uniform} />
          {entry.snippet ? (
            <Snippet className={bodyClassName} snippet={entry.snippet} />
          ) : null}
          {/* Nothing was asked, so nothing is highlighted: the stored preview
              is the same opening words the snippet would have shown. */}
          {!entry.snippet && entry.preview ? (
            <p className={cn(bodyClassName, "line-clamp-2")}>{entry.preview}</p>
          ) : null}
        </Card>
      </Link>

      {/* Absent for a letter, never disabled: an opened letter cannot be
          deleted at all, and a control that only refuses is a reproach. */}
      {onDelete && !isLetter ? (
        <ConfirmDialog
          confirmLabel={t("delete")}
          description={
            isSpark ? t("deleteSparkConfirm") : t("deleteEntryConfirm")
          }
          onConfirm={handleConfirmDelete}
          title={isSpark ? t("deleteSpark") : t("deleteEntry")}
          trigger={
            <Button
              aria-label={isSpark ? t("deleteSpark") : t("deleteEntry")}
              className="absolute top-3 right-3 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-soft hover:text-destructive focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
              size="icon-sm"
              type="button"
              variant="destructiveGhost"
            />
          }
        >
          <Trash2 />
        </ConfirmDialog>
      ) : null}
    </li>
  );
};

interface SearchResultsProps {
  entries: EntrySummary[];
  /** Total matches, which is more than the loaded page while scrolling. */
  matchCount: number | null;
  onDelete: (entry: EntrySummary) => void;
}

/**
 * Results are ranked by relevance, not grouped by month: the question being
 * answered is "where did I write about this", so the best match leads and the
 * snippet says why it matched.
 */
export const SearchResults = ({
  entries,
  matchCount,
  onDelete,
}: SearchResultsProps) => {
  const { t } = useTranslation();

  return (
    <div>
      <p aria-live="polite" className="eyebrow mb-3 text-faint">
        {t("searchResultCount", { count: matchCount ?? entries.length })}
      </p>
      <ul className="flex flex-col gap-4">
        {/* Keyed on the kind as well as the id: entry 4 and letter 4 are
            different rows in different tables, and a bare id would collide. */}
        {entries.map((entry) => (
          <EntryResultRow
            entry={entry}
            key={`${entry.kind}-${entry.id}`}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
};
