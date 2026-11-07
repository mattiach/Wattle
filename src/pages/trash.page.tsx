import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { Button } from "@/components/ui/button";
import {
  emptyTrash,
  expiresOn,
  listTrash,
  purgeEntry,
  restoreEntry,
  trashRetentionDays,
} from "@/features/entries/functions/trash";
import type { TrashedEntry } from "@/features/entries/interfaces/trash";
import { fromCalendarDate } from "@/lib/dates";
import { paths } from "@/routing/paths";

interface TrashRowProps {
  entry: TrashedEntry;
  /** Both dates, already written out in the reader's language. */
  formatDay: (date: Date) => string;
  onPurge: (id: number) => void;
  onRestore: (id: number) => void;
  retentionDays: number;
}

/**
 * One waiting page: what it was, when it was written, and when it stops
 * existing.
 *
 * Its own component so each row's two handlers are bound once against its own
 * id, rather than a new pair of closures for every row on every render.
 */
const TrashRow = ({
  entry,
  formatDay,
  onPurge,
  onRestore,
  retentionDays,
}: TrashRowProps) => {
  const { t } = useTranslation();

  const handleRestore = useCallback(() => {
    onRestore(entry.id);
  }, [entry.id, onRestore]);

  const handlePurge = useCallback(() => {
    onPurge(entry.id);
  }, [entry.id, onPurge]);

  return (
    <li className="flex items-start gap-3 border-hairline border-b py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading font-medium text-foreground">
          {entry.title || (
            <span className="text-faint italic">
              {entry.kind === "spark" ? t("sparkResultLabel") : t("untitled")}
            </span>
          )}
        </p>
        {entry.preview ? (
          <p className="mt-0.5 truncate text-muted-foreground text-sm">
            {entry.preview}
          </p>
        ) : null}
        <p className="mt-1 text-meta text-muted-foreground">
          {t("trashRow", {
            removed: formatDay(expiresOn(entry.deletedAt, retentionDays)),
            written: formatDay(fromCalendarDate(entry.entryDate)),
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          aria-label={t("trashRestore")}
          className="text-muted-foreground"
          onClick={handleRestore}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RotateCcw />
        </Button>
        {/* Asked twice, because this is the one control here that takes the
            last copy of something away. */}
        <ConfirmDialog
          confirmLabel={t("trashPurge")}
          description={t("trashPurgeConfirm")}
          onConfirm={handlePurge}
          title={t("trashPurge")}
          trigger={
            <Button
              aria-label={t("trashPurge")}
              size="icon-sm"
              variant="destructiveGhost"
            />
          }
        >
          <Trash2 />
        </ConfirmDialog>
      </div>
    </li>
  );
};

/**
 * The one place a deleted page can be got back from.
 *
 * A screen and not a dialog: recovering something is reading a list, deciding,
 * and sometimes deciding twice, and a list of unknown length inside a box that
 * has to stay shorter than the window is the wrong shape for that. It reads and
 * behaves like the spark archive - the same masthead, the same way back, the
 * same column - and reaching it is one click from Settings, where it is looked
 * for. Nothing in the navigation points here.
 *
 * The list is read on arrival and after every change rather than kept in the
 * store. It is short, it is looked at rarely, and holding it in Redux would mean
 * every screen carrying a copy of the reader's deletions around for the one
 * moment somebody opens this.
 */
export const TrashPage = () => {
  const { i18n, t } = useTranslation();
  const [entries, setEntries] = useState<TrashedEntry[]>([]);
  const [retentionDays, setRetentionDays] = useState(0);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [waiting, days] = await Promise.all([
        listTrash(),
        trashRetentionDays(),
      ]);
      setEntries(waiting);
      setRetentionDays(days);
      setFailed(false);
    } catch {
      setEntries([]);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Nothing else to tell: every list of entries in the application re-asks the
  // database when its screen is opened, so by the time the restored page could
  // be looked at, it has been fetched.
  const handleRestore = useCallback(
    async (id: number) => {
      await restoreEntry(id);
      await refresh();
    },
    [refresh]
  );

  const handlePurge = useCallback(
    async (id: number) => {
      await purgeEntry(id);
      await refresh();
    },
    [refresh]
  );

  const handleEmpty = useCallback(async () => {
    await emptyTrash();
    await refresh();
  }, [refresh]);

  const formatDay = useCallback(
    (date: Date) =>
      new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(date),
    [i18n.language]
  );

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <PageHeader
        actions={
          entries.length > 0 ? (
            <ConfirmDialog
              confirmLabel={t("trashEmptyAction")}
              description={t("trashEmptyConfirm")}
              onConfirm={handleEmpty}
              title={t("trashEmptyTitle")}
              trigger={<Button size="sm" variant="destructiveGhost" />}
            >
              {t("trashEmptyAction")}
            </ConfirmDialog>
          ) : null
        }
        backLabel={t("settings")}
        backTo={paths.settings.getHref()}
        description={
          failed ? t("trashError") : t("trashIntro", { days: retentionDays })
        }
        title={t("trash")}
      />

      <PageIntro className="mt-8" delay={0.05}>
        {entries.length === 0 ? (
          <EmptyState className="mt-16" title={t("trashNothing")} />
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <TrashRow
                entry={entry}
                formatDay={formatDay}
                key={entry.id}
                onPurge={handlePurge}
                onRestore={handleRestore}
                retentionDays={retentionDays}
              />
            ))}
          </ul>
        )}
      </PageIntro>
    </main>
  );
};
