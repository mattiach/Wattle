import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";
import { SquarePen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { indexEntry } from "@/features/ai/functions/memories";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateField } from "@/components/date-field";
import { EmptyState } from "@/components/empty-state";
import { PageIntro } from "@/components/layout/page-intro";
import { SparkComposer } from "@/features/sparks/spark-composer";
import { SparkPageHeader } from "@/features/sparks/spark-page-header";
import { Button } from "@/components/ui/button";
import { docToText, isPlainSpark, textToDoc } from "@/lib/spark-content";
import { useAppDispatch } from "@/redux/hooks";
import { removeEntry, saveEntry } from "@/redux/slices/entries/entries.slice";
import { paths } from "@/routing/paths";

/** `get_entry` as it comes off the wire: the document is still a string. */
interface SparkWireDto {
  content: string;
  entryDate: string;
  id: number;
}

type LoadStatus = "loading" | "loaded" | "error";

/**
 * A spark's own page.
 *
 * This is what replaces "a Spark is an Entry with fewer features": a spark now
 * has somewhere of its own to be read, at reading width, in the typeface it
 * was read back in on the card. Editing happens here, in the same field it was
 * written in - not in the full entry editor.
 *
 * A legacy spark that holds formatting or attachments is not converted and not
 * refused. It is named as what it is and handed to the editor that can open
 * it, which is the whole of the compatibility guarantee: nothing is
 * transformed, so nothing can be lost.
 */
export const SparkPage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const sparkId = Number(id);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [entryDate, setEntryDate] = useState("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editing, setEditing] = useState(searchParams.has("edit"));

  useEffect(() => {
    if (Number.isNaN(sparkId)) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    invoke<SparkWireDto>("get_entry", { id: sparkId })
      .then((dto) => {
        if (cancelled) {
          return;
        }
        setDoc(JSON.parse(dto.content) as JSONContent);
        setEntryDate(dto.entryDate);
        setStatus("loaded");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sparkId]);

  const handleSave = async (edited: string) => {
    const next = textToDoc(edited);
    const result = await dispatch(
      saveEntry({ content: next, entryDate, id: sparkId, title: "" })
    );
    if (saveEntry.fulfilled.match(result)) {
      setDoc(next);
      setEditing(false);
      // A spark is small enough that its whole life is one save, so this is
      // the moment its text stops changing. Fire and forget, as on the entry
      // page: it makes no request when there is no model to make one with.
      indexEntry(sparkId);
    }
  };

  // A spark can be filed on the wrong day as easily as an entry can - caught
  // after midnight, or written up from a note days later. Saved on the spot
  // rather than scheduled: there is no autosave on this screen, and a date
  // picked and then forgotten about would be a date silently discarded.
  const handleDateChange = async (next: string) => {
    if (!doc) {
      return;
    }
    const previous = entryDate;
    setEntryDate(next);
    const result = await dispatch(
      saveEntry({ content: doc, entryDate: next, id: sparkId, title: "" })
    );
    if (!saveEntry.fulfilled.match(result)) {
      setEntryDate(previous);
    }
  };

  const handleDelete = async () => {
    const result = await dispatch(removeEntry(sparkId));
    if (removeEntry.fulfilled.match(result)) {
      navigate(paths.sparks.getHref());
    }
  };

  const startEditing = () => setEditing(true);
  const stopEditing = () => setEditing(false);

  if (status !== "loaded" || !doc) {
    return (
      <main className="mx-auto w-full max-w-column flex-1 px-6">
        <SparkPageHeader back />
        <p className="mt-4 text-meta text-muted-foreground">
          {status === "error" ? t("entryNotFound") : t("loading")}
        </p>
      </main>
    );
  }

  const text = docToText(doc);
  const isPlain = isPlainSpark(doc);

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <SparkPageHeader
        actions={
          <>
            {isPlain && !editing ? (
              <Button
                className="text-muted-foreground"
                onClick={startEditing}
                size="sm"
                type="button"
                variant="ghost"
              >
                <SquarePen />
                {t("edit")}
              </Button>
            ) : null}
            <ConfirmDialog
              confirmLabel={t("delete")}
              description={t("deleteSparkConfirm")}
              onConfirm={handleDelete}
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
          </>
        }
        back
        // The day this was written, where the other two screens put their
        // name. A spark has no title, and its date is the only thing that
        // names it - so the title is also where the day is corrected, rather
        // than a second control repeating it underneath.
        title={
          <DateField
            aria-label={t("sparkDate")}
            onChange={handleDateChange}
            value={entryDate}
          />
        }
      />

      <PageIntro delay={0.05}>
        <article className="spark-rail mt-8 pl-6">
          {editing ? (
            <SparkComposer
              autoFocus
              initialText={text}
              onCancel={stopEditing}
              onSubmit={handleSave}
              submitLabel={t("save")}
            />
          ) : (
            <p className="whitespace-pre-wrap font-serif text-[1.25rem] text-foreground italic leading-relaxed">
              {text}
            </p>
          )}
        </article>
      </PageIntro>

      {/* Written with the full editor, before sparks were plain text. Nothing
          about it is invalid; it simply needs the editor that can open it. */}
      {isPlain ? null : (
        <div className="mt-8 rounded-xl border border-hairline bg-muted/40 p-5">
          <p className="eyebrow text-faint">{t("sparkRichBadge")}</p>
          <p className="mt-2 text-body-sm text-muted-foreground leading-relaxed">
            {t("sparkRichBody")}
          </p>
          <Button
            className="mt-4"
            nativeButton={false}
            render={<Link to={paths.entries.detail.getHref(sparkId)} />}
            size="sm"
            variant="outline"
          >
            {t("sparkOpenAsEntry")}
          </Button>
        </div>
      )}

      {text.trim() === "" && isPlain ? (
        <EmptyState className="mt-16" title={t("sparkEmpty")} />
      ) : null}
    </main>
  );
};
