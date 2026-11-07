import type { JSONContent } from "@tiptap/core";
import { Download, PenLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { Button } from "@/components/ui/button";
import { AttachmentOwnerProvider } from "@/features/editor/attachment-owner-context";
import { Editor } from "@/features/editor/editor";
import { downloadLetterAttachment } from "@/features/letters/functions/letter-attachments";
import { exportLetter } from "@/features/letters/functions/letter-export";
import {
  listLetterAttachments,
  openLetter,
  toLetterErrorKey,
} from "@/features/letters/functions/letters";
import { fromCalendarDate, todayCalendarDate } from "@/lib/dates";
import { useAppDispatch } from "@/redux/hooks";
import { createEntry } from "@/redux/slices/entries/entries.slice";
import { paths } from "@/routing/paths";
import type {
  Letter,
  LetterAttachment,
} from "@/features/letters/interfaces/letters";

/**
 * A letter from a person who no longer exists, read.
 *
 * Reading width and the reading face, the same as an entry - what makes this
 * page different is what is *not* on it. There is no edit control and no delete
 * control, and they are **absent** rather than disabled: the codebase's own
 * rule is that below the line where an action is unavailable it is not shown at
 * all, never shown with a reproach attached.
 *
 * Opening happens in Rust, on Rust's clock, and this page cannot ask it to do
 * otherwise. A refusal is shown as a sentence, and - this matters - a letter
 * whose seal no longer matches says so as corruption rather than as "not yet"
 * or as an empty letter.
 */
export const LetterPage = () => {
  const { i18n, t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const letterId = Number(id);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [letter, setLetter] = useState<Letter | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<LetterAttachment[]>([]);

  useEffect(() => {
    if (Number.isNaN(letterId)) {
      return;
    }
    let cancelled = false;
    setLetter(null);
    setFailure(null);
    const read = async () => {
      const opened = await openLetter(letterId);
      if (cancelled) {
        return;
      }
      // `open_letter` passes a draft straight through - that is how the
      // composer reloads one - but a draft has no `openedAt`, and this page is
      // for letters that have arrived. It belongs to the composer.
      if (opened.status === "draft") {
        navigate(paths.letters.compose.getHref(), { replace: true });
        return;
      }
      setLetter(opened);
      // Opening is what unsealed them, so they are readable by the time this
      // asks - and a file chip needs its row to know what it is called.
      const rows = await listLetterAttachments(opened.id);
      if (!cancelled) {
        setAttachments(rows);
      }
    };

    read().catch((error: unknown) => {
      if (!cancelled) {
        setFailure(toLetterErrorKey(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [letterId, navigate]);

  const longDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(fromCalendarDate(value));

  /**
   * Writing back.
   *
   * An ordinary entry, dated today, in the ordinary editor. No `reply_to`, no
   * thread, no correspondence: the value is in the gesture, and a thread of
   * letters to yourself starts to look like the one thing this application has
   * permanently excluded.
   */
  const handleWriteBack = async () => {
    const result = await dispatch(createEntry(todayCalendarDate()));
    if (createEntry.fulfilled.match(result)) {
      navigate(paths.entries.detail.getHref(result.payload.id));
    }
  };

  const handleExport = useCallback(() => {
    if (letter) {
      exportLetter(letter.id);
    }
  }, [letter]);

  if (failure) {
    return (
      <main className="mx-auto w-full max-w-reading flex-1 px-6 pb-28">
        <PageHeader
          backLabel={t("letters")}
          backTo={paths.letters.getHref()}
          title={t("letters")}
        />
        <p className="mt-8 text-meta text-muted-foreground leading-relaxed">
          {t(failure)}
        </p>
      </main>
    );
  }

  if (!letter) {
    return (
      <main className="mx-auto w-full max-w-reading flex-1 px-6 pb-28">
        <PageHeader
          backLabel={t("letters")}
          backTo={paths.letters.getHref()}
          title={t("letters")}
        />
        <p className="mt-8 text-muted-foreground text-sm">{t("loading")}</p>
      </main>
    );
  }

  const content = JSON.parse(letter.content) as JSONContent;

  return (
    <main className="mx-auto w-full max-w-reading flex-1 px-6 pb-28">
      <PageHeader
        actions={
          <Button
            aria-label={t("letterExport")}
            className="text-muted-foreground"
            onClick={handleExport}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Download />
          </Button>
        }
        backLabel={t("letters")}
        backTo={paths.letters.getHref()}
        subtitle={t("letterWrittenOn", { date: longDate(letter.writtenOn) })}
        title={t("letterFromYourself")}
        titleTourId="letter-read"
      />

      <PageIntro className="mt-8" delay={0.05} tourStepId="letter-keep">
        {/* Read-only, so no attachment can be added - but the nodes are still
            in the model, which is what lets an opened letter show the pictures
            it was written with. */}
        <AttachmentOwnerProvider
          owner={{ attachments, download: downloadLetterAttachment }}
        >
          <Editor content={content} editable={false} />
        </AttachmentOwnerProvider>
      </PageIntro>

      <div className="mt-10 border-hairline border-t pt-5">
        <p className="text-meta text-muted-foreground">
          {t("letterFooterDates", {
            opened: longDate(letter.openedAt.slice(0, 10)),
            written: longDate(letter.writtenOn),
          })}
        </p>
        {/* Offered, not modelled. It makes an ordinary entry and then this page
            has nothing more to do with it. */}
        <Button
          className="mt-4"
          onClick={handleWriteBack}
          type="button"
          variant="outline"
        >
          <PenLine />
          {t("letterWriteBack")}
        </Button>
      </div>
    </main>
  );
};
