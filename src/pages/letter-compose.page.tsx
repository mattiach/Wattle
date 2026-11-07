import { Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttachmentOwnerProvider } from "@/features/editor/attachment-owner-context";
import { Editor } from "@/features/editor/editor";
import { DurationPicker } from "@/features/letters/duration-picker";
import { LETTER_PROMPTS } from "@/features/letters/functions/letter-prompts";
import { downloadLetterAttachment } from "@/features/letters/functions/letter-attachments";
import {
  addLetterAttachment,
  createLetter,
  deleteLetter,
  listLetterAttachments,
  reconcileLetterAttachments,
  isLetterEmpty,
  listLetters,
  openLetter,
  saveLetterDraft,
  sealLetter,
} from "@/features/letters/functions/letters";
import { SealDialog } from "@/features/letters/seal-dialog";
import { askLetterQuestion } from "@/features/letters/functions/letter-question";
import { fromCalendarDate } from "@/lib/dates";
import { useAppSelector } from "@/redux/hooks";
import { paths } from "@/routing/paths";
import { useAutosave } from "@/features/editor/hooks/use-autosave";

import type {
  Letter,
  LetterAttachment,
} from "@/features/letters/interfaces/letters";
import type { LetterPrompt } from "@/features/letters/interfaces/letter-prompts";
import type { EditorHandle } from "@/features/editor/editor";
import type { AttachmentKind } from "@/features/editor/slash-command/slash-command-items";
import type { JSONContent } from "@tiptap/core";

const EMPTY_DOCUMENT: JSONContent = { content: [], type: "doc" };

/** The same filters the entry page offers, so picking a file feels the same on
 * both surfaces. */
const ATTACHMENT_DIALOG_FILTERS: Partial<
  Record<AttachmentKind, { extensions: string[]; name: string }>
> = {
  image: {
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
    name: "Image",
  },
  video: { extensions: ["mp4", "webm", "mov", "avi", "mkv"], name: "Video" },
};

/**
 * One direction, as a control.
 *
 * Its own component so the handler is stable across renders, and so the label
 * stays what it is: a static piece of copy in the reader's language, shown
 * whether or not assistance has ever been switched on.
 */
const DirectionButton = ({
  chosen,
  onPick,
  prompt,
}: {
  chosen: boolean;
  onPick: (id: string) => void;
  prompt: LetterPrompt;
}) => {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onPick(prompt.id), [onPick, prompt.id]);

  return (
    <Button
      aria-pressed={chosen}
      className={chosen ? "border-wattle text-wattle-ink" : ""}
      onClick={handleClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {t(prompt.labelKey)}
    </Button>
  );
};

/**
 * Writing a letter, and closing it.
 *
 * **One draft at a time.** The schema allows several and the backend does not
 * forbid them, but two half-written letters to your future self is two
 * obligations, and the second one is the one that never gets finished. Arriving
 * here resumes the draft if there is one.
 *
 * The page holds the draft in its own state and in the `letters` table, and
 * nowhere else. No Redux slice - see `letters.ts` for why, and the reason that
 * matters here is that a global store is a copy of the plaintext in a place
 * nothing is responsible for clearing.
 */
export const LetterComposePage = () => {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const canAsk = useAppSelector(
    (state) => state.settings.aiEnabled && state.settings.aiModel !== ""
  );

  const [letter, setLetter] = useState<Letter | null>(null);
  const [content, setContent] = useState<JSONContent>(EMPTY_DOCUMENT);
  const [unlockOn, setUnlockOn] = useState("");
  const [promptId, setPromptId] = useState("");
  const [question, setQuestion] = useState("");
  // Set aside for this visit and no further. Leaving the composer unmounts this
  // page, so coming back - or restarting - asks again. Deliberately not stored
  // anywhere: the notice exists to be acted on, and a permanent dismissal is
  // how it would quietly stop being acted on.
  const [warningSetAside, setWarningSetAside] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [attachments, setAttachments] = useState<LetterAttachment[]>([]);
  const editorHandleRef = useRef<EditorHandle>(null);

  // Read by the autosave and by the exit cleanup, both of which run outside a
  // render and must not see a stale closure.
  const stateRef = useRef({ content, letter, promptId, sealed, unlockOn });
  stateRef.current = { content, letter, promptId, sealed, unlockOn };

  // Resume, or start. Runs once: creating a second draft because a re-render
  // happened would be the one bug this page cannot recover from on its own.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const begin = async () => {
      const existing = (await listLetters()).find(
        (candidate) => candidate.status === "draft"
      );
      const resumed = existing
        ? await openLetter(existing.id)
        : await createLetter("");
      setLetter(resumed);
      setUnlockOn(resumed.unlockOn);
      setPromptId(resumed.promptId);
      setContent(
        resumed.content
          ? (JSON.parse(resumed.content) as JSONContent)
          : EMPTY_DOCUMENT
      );
      // A file chip reopened later has no filename to show without these.
      setAttachments(await listLetterAttachments(resumed.id));
    };
    begin();
  }, []);

  const { flush, scheduleSave } = useAutosave(async () => {
    const {
      content: text,
      letter: draft,
      promptId: from,
      sealed: closed,
      unlockOn: opens,
    } = stateRef.current;
    if (!draft || closed) {
      return;
    }
    await saveLetterDraft(draft.id, JSON.stringify(text), opens, from);
  });

  // Leaving an untouched draft discards it: the row is inserted the moment the
  // page opens, and nothing else would ever clean a blank one up. The same
  // reasoning, and the same StrictMode guard, as the entry page's exit.
  useEffect(
    () => () => {
      if (window.location.pathname === paths.letters.compose.path) {
        return;
      }
      const { content: text, letter: draft, sealed: closed } = stateRef.current;
      if (!draft || closed) {
        return;
      }
      if (isLetterEmpty(text)) {
        deleteLetter(draft.id);
        return;
      }
      // The document has stopped changing, so now is when it is safe to say
      // what it no longer references - and the save has to land first, so Rust
      // reconciles against the document that was actually stored.
      flush().then(() => reconcileLetterAttachments(draft.id));
    },
    [flush]
  );

  const handleUpdate = (next: JSONContent) => {
    setContent(next);
    scheduleSave();
  };

  const handleUnlockChange = (next: string) => {
    setUnlockOn(next);
    scheduleSave();
  };

  /**
   * Choosing a direction, and - only when assistance is on - asking for one
   * question to start from.
   *
   * The direction itself is static text and always available: a letter must be
   * writable by someone who has never turned assistance on, which is everyone
   * by default. The model's question is an addition to that and never a
   * replacement for it, and when it cannot be had nothing is said.
   */
  const handleDirection = useCallback(
    async (id: string) => {
      const next = promptId === id ? "" : id;
      setPromptId(next);
      setQuestion("");
      scheduleSave();
      if (!(next && canAsk)) {
        return;
      }
      const asked = await askLetterQuestion(next, i18n.language);
      // Only if the reader has not moved on since; and silence on failure.
      if (asked && stateRef.current.promptId === next) {
        setQuestion(asked);
      }
    },
    [canAsk, i18n.language, promptId, scheduleSave]
  );

  /**
   * A file, chosen and copied into the letter's own folder.
   *
   * The same two steps the entry page takes: the backend copies the file and
   * answers with its row, and only then is a node inserted pointing at it -
   * so a document can never reference a file that was not stored.
   */
  const handleAttach = async (sourcePath: string) => {
    const { letter: draft } = stateRef.current;
    if (!draft) {
      return;
    }
    const added = await addLetterAttachment(draft.id, sourcePath);
    setAttachments((current) => [...current, added]);
    const insertArgs = {
      attachmentId: added.id,
      mimeType: added.mimeType,
      path: added.path,
    };
    if (added.mimeType.startsWith("image/")) {
      editorHandleRef.current?.insertAttachment("image", insertArgs);
    } else if (added.mimeType.startsWith("video/")) {
      editorHandleRef.current?.insertAttachment("video", insertArgs);
    } else {
      editorHandleRef.current?.insertAttachment("file", insertArgs);
    }
  };

  const handleRequestAttachment = async (kind: AttachmentKind) => {
    const filter = ATTACHMENT_DIALOG_FILTERS[kind];
    const sourcePath = await openFileDialog({
      filters: filter ? [filter] : undefined,
      multiple: false,
    });
    if (typeof sourcePath === "string") {
      await handleAttach(sourcePath);
    }
  };

  /**
   * Opens the ceremony on what is actually stored.
   *
   * A plain save rather than a flush, and the saved letter replaces the one in
   * state: the review shows the letter's length, and a length worked out from a
   * draft that had not been written yet would be a number about the wrong text.
   */
  const handleReview = async () => {
    const {
      content: text,
      letter: draft,
      promptId: from,
      unlockOn: opens,
    } = stateRef.current;
    if (!draft) {
      return;
    }
    const saved = await saveLetterDraft(
      draft.id,
      JSON.stringify(text),
      opens,
      from
    );
    setLetter(saved);
    setReviewing(true);
  };

  const handleCancelReview = useCallback(() => setReviewing(false), []);

  const handleSetAsideWarning = useCallback(() => setWarningSetAside(true), []);

  const handleSeal = async () => {
    if (!letter) {
      return;
    }
    // What is on screen has to be what is sealed, so anything still sitting on
    // the autosave timer lands first. Sealing a letter as it was two seconds
    // ago is not a mistake that can be corrected afterwards.
    await flush();
    await sealLetter(letter.id, unlockOn);
    setSealed(true);
    setReviewing(false);
    navigate(paths.letters.getHref());
  };

  const ready = !isLetterEmpty(content) && unlockOn !== "";
  const resolved = unlockOn
    ? new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(fromCalendarDate(unlockOn))
    : "";

  const owner = { attachments, download: downloadLetterAttachment };

  return (
    <AttachmentOwnerProvider owner={owner}>
      <main className="mx-auto w-full max-w-reading flex-1 px-6 pb-28">
        <PageHeader
          backLabel={t("letters")}
          backTo={paths.letters.getHref()}
          description={t("letterComposeDescription")}
          subtitle={
            letter
              ? t("letterWrittenOn", {
                  date: new Intl.DateTimeFormat(i18n.language, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(fromCalendarDate(letter.writtenOn)),
                })
              : undefined
          }
          title={t("letterComposeTitle")}
        />

        <PageIntro className="mt-8" delay={0.05} tourStepId="letter-directions">
          <h2 className="eyebrow text-faint">{t("letterWhereToStart")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {LETTER_PROMPTS.map((prompt) => (
              <DirectionButton
                chosen={promptId === prompt.id}
                key={prompt.id}
                onPick={handleDirection}
                prompt={prompt}
              />
            ))}
          </div>
          {/* One question, in the reader's language, and never a line of the
            letter. Nothing it says is stored: it is a thing to look at while
            writing, and it is gone when the direction changes. */}
          {question ? (
            <p className="mt-4 flex items-start gap-2 font-serif text-body-sm text-foreground/90 italic leading-relaxed">
              <Sparkles className="mt-1 size-4 shrink-0 text-assist-ink" />
              {question}
            </p>
          ) : null}

          {/* Said on arrival rather than after the disappointment: picking a
            direction and getting silence teaches nothing, and this is the one
            place where saying what is missing is also saying what is on offer.
            The directions above are untouched by any of it - a letter has
            always been writable with assistance switched off, which is how it
            arrives. Gone entirely once a model is chosen. */}
          {canAsk || warningSetAside ? null : (
            <Alert className="mt-4">
              <Sparkles />
              <AlertTitle>{t("letterAiUnavailableTitle")}</AlertTitle>
              <AlertDescription>
                {t("letterAiUnavailableBody")}
              </AlertDescription>
              <AlertAction>
                <Button
                  aria-label={t("dismiss")}
                  className="text-muted-foreground"
                  onClick={handleSetAsideWarning}
                  size="icon-sm"
                  variant="ghost"
                >
                  <X />
                </Button>
              </AlertAction>
            </Alert>
          )}
        </PageIntro>

        <div className="mt-8 border-hairline border-b" />

        <div className="mt-8">
          {/* The ordinary editor, with everything an entry has: pictures, clips,
            files, the slash menu, and - when assistance is on - the same
            bubble-menu rewrite. A letter is a normal Wattle document until the
            moment it is sealed. */}
          <Editor
            content={content}
            key={letter?.id ?? "pending"}
            onRequestAttachment={handleRequestAttachment}
            onUpdate={handleUpdate}
            placeholder={t("letterContentPlaceholder")}
            ref={editorHandleRef}
          />
        </div>

        <PageIntro className="mt-6" delay={0.1} tourStepId="letter-seal">
          <h2 className="eyebrow text-faint">{t("letterOpensOn")}</h2>
          <div className="mt-3">
            <DurationPicker onChange={handleUnlockChange} value={unlockOn} />
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            {/* The date, the moment a span is chosen. No days remaining, here or
              anywhere: a letter with a timer on it is a letter that nags. */}
            <p className="text-meta text-muted-foreground">
              {resolved
                ? t("letterWillOpen", { date: resolved })
                : t("letterNoDateYet")}
            </p>
            <Button disabled={!ready} onClick={handleReview} type="button">
              {t("letterReviewAction")}
            </Button>
          </div>
        </PageIntro>

        {/* Mounted only once there is a date, because the ceremony is *about* a
          date: its body is rendered as soon as it exists, closed or not, and a
          letter with no date chosen yet has nothing for it to say. */}
        {letter && unlockOn ? (
          <SealDialog
            attachments={attachments}
            content={content}
            onCancel={handleCancelReview}
            onSeal={handleSeal}
            open={reviewing}
            unlockOn={unlockOn}
            wordCount={letter.wordCount}
            writtenOn={letter.writtenOn}
          />
        ) : null}
      </main>
    </AttachmentOwnerProvider>
  );
};
