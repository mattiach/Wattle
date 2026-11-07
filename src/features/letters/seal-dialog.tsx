import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AttachmentOwnerProvider } from "@/features/editor/attachment-owner-context";
import { Editor } from "@/features/editor/editor";
import { downloadLetterAttachment } from "@/features/letters/functions/letter-attachments";
import { fromCalendarDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import type { LetterAttachment } from "@/features/letters/interfaces/letters";
import type { JSONContent } from "@tiptap/core";
import type { ChangeEvent } from "react";

interface SealDialogProps {
  /** The draft's files, so the last reading shows what is actually in it. */
  attachments: LetterAttachment[];
  /** The letter as it stands, read-only, for the last reading. */
  content: JSONContent;
  onCancel: () => void;
  /** Resolves when the letter is sealed, or rejects with a `letter:` code. */
  onSeal: () => Promise<void>;
  open: boolean;
  unlockOn: string;
  wordCount: number;
  writtenOn: string;
}

type Stage = "review" | "seal";

/**
 * The gate in front of a letter that cannot be taken back.
 *
 * **Not `ConfirmDialog`.** That one is uncontrolled by design - the trigger
 * owns the open state - and this needs two stages, a typed confirmation and a
 * pending state of its own. It follows `NewProfileDialog`'s precedent instead:
 * built from the same primitives, so a shared component used by four other
 * callers is not widened for this one.
 *
 * **Why the date is typed.** Choosing the wrong date is the single mistake this
 * feature cannot undo, and typing it is the one act that makes a reader look at
 * the date rather than past it. It is the maximum friction this should ever
 * have: two stages and one field. Anything more tips a serious moment into a
 * tedious one.
 *
 * **What the copy has to say, and has to not say.** It says the letter cannot
 * be opened, edited, deleted or re-dated, that Wattle cannot open it either,
 * and that emptying the whole journal is the one way to remove it - which is
 * what makes the promise honest rather than cruel. It does not say the letter
 * is safe from everyone. The key travels with the ciphertext, in the file and
 * in every backup, and telling someone otherwise might change what they write.
 */
export const SealDialog = ({
  attachments,
  content,
  onCancel,
  onSeal,
  open,
  unlockOn,
  wordCount,
  writtenOn,
}: SealDialogProps) => {
  const { i18n, t } = useTranslation();
  const [stage, setStage] = useState<Stage>("review");
  const [typed, setTyped] = useState("");
  const [sealing, setSealing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const longDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(fromCalendarDate(value));

  const handleOpenChange = (next: boolean) => {
    if (next) {
      return;
    }
    // Every dismissal resets: a half-typed date left over from a cancelled
    // attempt is the wrong thing to find waiting the next time.
    setStage("review");
    setTyped("");
    setFailure(null);
    onCancel();
  };

  const handleTyped = (event: ChangeEvent<HTMLInputElement>) => {
    setTyped(event.target.value);
  };

  const handleContinue = () => setStage("seal");

  const handleSeal = async () => {
    setSealing(true);
    setFailure(null);
    try {
      await onSeal();
    } catch (error) {
      setFailure(typeof error === "string" ? error : String(error));
    } finally {
      setSealing(false);
    }
  };

  const isReview = stage === "review";
  // Typed as the date is stored, not as it is spoken: an unambiguous form is
  // the only one that can be checked without guessing at a locale.
  const confirmed = typed.trim() === unlockOn;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className={cn(isReview && "sm:max-w-xl")}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {isReview ? t("letterReviewTitle") : t("letterSealTitle")}
          </DialogTitle>
          <DialogDescription>
            {isReview
              ? t("letterReviewBody")
              : t("letterSealBody", { date: longDate(unlockOn) })}
          </DialogDescription>
        </DialogHeader>

        {isReview ? (
          <>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-hairline bg-memory-surface px-5 py-4">
              {/* The letter itself, read-only and with no formatting bar: this
                  is the last reading, not another chance to edit. */}
              <AttachmentOwnerProvider
                owner={{ attachments, download: downloadLetterAttachment }}
              >
                <Editor content={content} editable={false} />
              </AttachmentOwnerProvider>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-meta">
              <dt className="text-muted-foreground">{t("letterWritten")}</dt>
              <dd className="text-foreground">{longDate(writtenOn)}</dd>
              <dt className="text-muted-foreground">{t("letterOpensOn")}</dt>
              <dd className="text-foreground">{longDate(unlockOn)}</dd>
              <dt className="text-muted-foreground">{t("letterLength")}</dt>
              <dd className="text-foreground">
                {t("letterWordCount", { count: wordCount })}
              </dd>
            </dl>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-meta text-muted-foreground leading-relaxed">
              {t("letterSealTerms", { date: longDate(unlockOn) })}
            </p>
            {/* Said plainly, because the alternative is letting someone believe
                something about their own writing that is not true. */}
            <p className="text-meta text-muted-foreground/80 leading-relaxed">
              {t("letterSealHonesty")}
            </p>
            <label
              className="flex flex-col gap-1.5 text-foreground text-meta"
              htmlFor="letter-seal-confirm"
            >
              {t("letterTypeDate")}
              <Input
                autoComplete="off"
                id="letter-seal-confirm"
                onChange={handleTyped}
                placeholder={unlockOn}
                spellCheck={false}
                value={typed}
              />
            </label>
            {failure ? (
              <p aria-live="polite" className="text-destructive text-meta">
                {t("letterSealFailed")}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {isReview ? t("letterKeepEditing") : t("cancel")}
          </DialogClose>
          {isReview ? (
            <Button onClick={handleContinue} type="button">
              {t("continue")}
            </Button>
          ) : (
            <Button
              disabled={!confirmed || sealing}
              onClick={handleSeal}
              type="button"
            >
              {sealing ? t("letterSealing") : t("letterSealAction")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
