import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  LockOpen,
  Trash2,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { TitleSuggestion } from "@/features/ai/title-suggestion";
import { useAttachments } from "@/hooks/use-attachments";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateField } from "@/components/date-field";
import { indexEntry } from "@/features/ai/functions/memories";
import { exportEntry } from "@/features/entries/functions/export";
import { Button } from "@/components/ui/button";
import type { EditorHandle } from "@/features/editor/editor";
import { Editor } from "@/features/editor/editor";
import { EditorScalePopover } from "@/features/editor/editor-scale-popover";
import type { AttachmentKind } from "@/features/editor/slash-command/slash-command-items";
import { useAutosave } from "@/features/editor/hooks/use-autosave";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  addAttachment,
  fetchEntry,
  isEntryEmpty,
  reconcileAttachments,
  removeEntry,
  saveEntry,
} from "@/redux/slices/entries/entries.slice";
import { paths } from "@/routing/paths";

interface AdjacentEntries {
  next: number | null;
  previous: number | null;
}

const ATTACHMENT_DIALOG_FILTERS: Partial<
  Record<AttachmentKind, { extensions: string[]; name: string }>
> = {
  image: {
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
    name: "Image",
  },
  video: { extensions: ["mp4", "webm", "mov", "avi", "mkv"], name: "Video" },
};

export const EntryPage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const entryId = Number(id);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  // Set only when this entry was opened from a writing nudge on the home
  // screen. It reaches the editor as its placeholder and nothing else - the
  // document itself is untouched by it.
  const nudge = (useLocation().state as { nudge?: string } | null)?.nudge;
  const activeEntry = useAppSelector((state) => state.entries.activeEntry);
  const activeEntryStatus = useAppSelector(
    (state) => state.entries.activeEntryStatus
  );
  const entryLock = useAppSelector((state) => state.settings.entryLock);

  const [title, setTitle] = useState("");
  const titleRef = useRef(title);
  titleRef.current = title;

  // Held locally like the title so an edit shows immediately and autosave picks
  // it up; a plain `YYYY-MM-DD` string throughout, never a Date.
  const [entryDate, setEntryDate] = useState("");
  const entryDateRef = useRef(entryDate);
  entryDateRef.current = entryDate;

  const contentRef = useRef<JSONContent | null>(null);
  const editorHandleRef = useRef<EditorHandle>(null);
  const titleFieldRef = useRef<HTMLTextAreaElement>(null);
  const activeEntryRef = useRef(activeEntry);
  activeEntryRef.current = activeEntry;
  const entryPath = paths.entries.detail.getHref(entryId);

  const { attach, loadAttachments } = useAttachments(entryId);

  useEffect(() => {
    if (!Number.isNaN(entryId) && activeEntry?.id !== entryId) {
      dispatch(fetchEntry(entryId));
    }
  }, [entryId, activeEntry?.id, dispatch]);

  // The entry's own attachment rows, which is what lets a file attachment show
  // its filename rather than a placeholder after the entry is reopened.
  useEffect(() => {
    if (!Number.isNaN(entryId)) {
      loadAttachments();
    }
  }, [entryId, loadAttachments]);

  // An entry that already holds writing opens read-only, so arriving at
  // something written months ago cannot take an accidental keystroke. A
  // just-created entry is blank, so it opens ready to write in - which is why
  // the decision is made from the content rather than from how you got here.
  const [locked, setLocked] = useState(false);
  // Which entry the fields were last filled from.
  //
  // The whole seeding happens once per entry, not once per update. `saveEntry`
  // replaces `activeEntry` with what the backend echoed back, so re-seeding on
  // every update wrote the just-saved title over the one being typed - anything
  // entered while a save was in flight was reverted, which is what made a title
  // look like it never saved. The lock has the same reason: re-deciding it on
  // an autosave would slam it shut in the middle of a sentence.
  const seededForRef = useRef<number | null>(null);

  useEffect(() => {
    if (activeEntry?.id !== entryId || seededForRef.current === entryId) {
      return;
    }
    seededForRef.current = entryId;
    const blank = isEntryEmpty(activeEntry.title, activeEntry.content);
    setTitle(activeEntry.title);
    setEntryDate(activeEntry.entryDate);
    contentRef.current = null;
    setIsBlank(blank);
    setLocked(entryLock && !blank);
  }, [activeEntry, entryId, entryLock]);

  const { flush, scheduleSave } = useAutosave(async () => {
    if (!activeEntry || activeEntry.id !== entryId) {
      return;
    }
    const content = contentRef.current ?? activeEntry.content;
    await dispatch(
      saveEntry({
        content,
        // The stored date stands until the field has actually been populated,
        // so a save that lands before the entry has finished loading cannot
        // blank it.
        entryDate: entryDateRef.current || activeEntry.entryDate,
        id: activeEntry.id,
        title: titleRef.current,
      })
    );
  });

  // Leaving an untouched entry discards it: the row is inserted the moment the
  // entry is created, so nothing else would ever clean a blank one up.
  useEffect(
    () => () => {
      // StrictMode replays this cleanup immediately after mount in development.
      // A real exit has already pushed the new URL by the time cleanup runs,
      // which separates the two - without this, a just-created entry would
      // delete itself on arrival and leave the page loading forever.
      if (window.location.pathname === entryPath) {
        return;
      }
      const entry = activeEntryRef.current;
      if (entry?.id !== entryId) {
        return;
      }
      if (isEntryEmpty(titleRef.current, contentRef.current ?? entry.content)) {
        dispatch(removeEntry(entryId));
        return;
      }
      // The document has stopped changing, so now - and only now - is it safe
      // to say what it no longer references. Waiting until the save lands means
      // the backend reconciles against the document that was actually stored.
      flush().then(() => {
        dispatch(reconcileAttachments(entryId));
        // The same moment, for the same reason: the text is final, so reading
        // it for likeness costs one embedding instead of one per autosave.
        // Nothing is awaited and nothing is shown - Rust answers `false` and
        // makes no request at all when there is no model to read it with.
        indexEntry(entryId);
      });
    },
    [entryId, entryPath, dispatch, flush]
  );

  // The title is a textarea so long titles wrap instead of scrolling; it is
  // resized to its content on every change.
  const resizeTitle = useCallback(() => {
    const field = titleFieldRef.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, []);

  // Keyed on the title itself, so a value set programmatically - an accepted
  // suggestion - resizes the field the same way typing does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height depends on the title even though the effect body reads it from the DOM rather than from the variable
  useEffect(() => {
    const field = titleFieldRef.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [title]);

  // Moving through the journal one entry at a time, without going back to a
  // list first. Refetched per entry, so it stays right after a date changes.
  const [neighbours, setNeighbours] = useState<AdjacentEntries>({
    next: null,
    previous: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the neighbours depend on where this entry sits in time, so changing its date has to re-ask even though the effect body never reads the date
  useEffect(() => {
    if (Number.isNaN(entryId)) {
      return;
    }
    let cancelled = false;
    invoke<AdjacentEntries>("adjacent_entries", { id: entryId }).then(
      (result) => {
        if (!cancelled) {
          setNeighbours(result);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [entryId, activeEntry?.entryDate]);

  const handleDateChange = (value: string) => {
    setEntryDate(value);
    scheduleSave();
  };

  const handleTitleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setTitle(next);
    setIsBlank(
      isEntryEmpty(next, contentRef.current ?? activeEntry?.content ?? {})
    );
    resizeTitle();
    scheduleSave();
  };

  const handleTitleKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      editorHandleRef.current?.focus();
    }
  };

  // Whether there is anything to export yet.
  //
  // The same predicate that decides whether leaving an untouched entry
  // discards it, so the two can never disagree: an entry that would be thrown
  // away on exit is not one there is a file to write.
  const [isBlank, setIsBlank] = useState(true);

  const handleEditorUpdate = (content: JSONContent) => {
    contentRef.current = content;
    setIsBlank(isEntryEmpty(titleRef.current, content));
    scheduleSave();
  };

  const getEntryContent = useCallback(
    () => contentRef.current ?? activeEntryRef.current?.content ?? null,
    []
  );

  const toggleLock = () => setLocked((current) => !current);

  const handleAcceptTitle = (suggested: string) => {
    setTitle(suggested);
    setIsBlank(false);
    scheduleSave();
  };

  const handleAttach = async (sourcePath: string) => {
    const result = await attach(sourcePath);
    if (!addAttachment.fulfilled.match(result)) {
      return;
    }
    const dto = result.payload;
    const insertArgs = {
      attachmentId: dto.id,
      mimeType: dto.mimeType,
      path: dto.path,
    };
    if (dto.mimeType.startsWith("image/")) {
      editorHandleRef.current?.insertAttachment("image", insertArgs);
    } else if (dto.mimeType.startsWith("video/")) {
      editorHandleRef.current?.insertAttachment("video", insertArgs);
    } else {
      editorHandleRef.current?.insertAttachment("file", insertArgs);
    }
  };

  const handleRequestAttachment = async (kind: AttachmentKind) => {
    const filter = ATTACHMENT_DIALOG_FILTERS[kind];
    const sourcePath = await open({
      filters: filter ? [filter] : undefined,
      multiple: false,
    });
    if (typeof sourcePath !== "string") {
      return;
    }
    await handleAttach(sourcePath);
  };

  // Delete resolves before navigating: the store drops the entry and the route
  // change land in the same render, so the page never flashes its empty state.
  const handleDelete = async () => {
    const result = await dispatch(removeEntry(entryId));
    if (removeEntry.fulfilled.match(result)) {
      navigate(paths.app.path);
    }
  };

  // The export is written from what is stored, so anything still waiting on
  // the autosave timer has to land first - otherwise the file on disk is the
  // entry as it was a few seconds ago.
  const handleExport = async () => {
    await flush();
    await exportEntry(entryId);
  };

  const backButton = (
    <Button
      aria-label={t("allEntries")}
      className="-ml-1.5 shrink-0 text-muted-foreground"
      nativeButton={false}
      render={<Link to={paths.app.path} />}
      size="icon-sm"
      variant="ghost"
    >
      <ArrowLeft />
    </Button>
  );

  if (!activeEntry || activeEntry.id !== entryId) {
    return (
      <main className="mx-auto w-full max-w-reading flex-1 px-6 pt-12">
        {backButton}
        {/* A failed fetch must say so, never spin forever. */}
        <p className="mt-4 text-muted-foreground text-sm">
          {activeEntryStatus === "error" ? t("entryNotFound") : t("loading")}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-reading flex-1 px-6 pt-14 pb-28">
      {/* Entry actions sit with the entry, not in the navigation bar. */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {backButton}
          {/* The date is the entry's most important fact, so it is also the one
              control that lives in the header: an entry written today about
              last Tuesday belongs on last Tuesday. */}
          <DateField
            aria-label={t("entryDate")}
            className="eyebrow"
            disabled={locked}
            onChange={handleDateChange}
            value={entryDate}
          />
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          data-tour-step-id="entry-actions"
        >
          {/* Step through the journal in time without returning to a list. */}
          <Button
            aria-label={t("previousEntry")}
            className="text-muted-foreground"
            disabled={neighbours.previous === null}
            nativeButton={false}
            render={
              <Link
                to={paths.entries.detail.getHref(neighbours.previous ?? 0)}
              />
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <Button
            aria-label={t("nextEntry")}
            className="text-muted-foreground"
            disabled={neighbours.next === null}
            nativeButton={false}
            render={
              <Link to={paths.entries.detail.getHref(neighbours.next ?? 0)} />
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
          {/* The lock is a statement about this entry right now, not a
              setting: it says whether a keystroke would land, and one click
              changes the answer. The preference decides only how it starts. */}
          {entryLock ? (
            <Button
              aria-label={locked ? t("unlockEntry") : t("lockEntry")}
              aria-pressed={locked}
              className={locked ? "text-wattle-ink" : "text-muted-foreground"}
              onClick={toggleLock}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {locked ? <Lock /> : <LockOpen />}
            </Button>
          ) : null}
          {/* One entry leaves as one file, and there is only one reading of
              it - so the action does the whole thing on its own. */}
          <Button
            aria-label={t("exportEntry")}
            className="text-muted-foreground"
            // Nothing written yet means nothing to write out - and an entry
            // this empty is discarded when it is left, so offering a download
            // of it would be offering a file about to vanish.
            disabled={isBlank}
            onClick={handleExport}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Download />
          </Button>
          {/* Between the download and the bin, because it is the same kind of
              thing as both: something you do to this page while you are on it.
              It writes a setting, so it holds for the next page too - which is
              what somebody who cannot read this one comfortably wants. */}
          <EditorScalePopover />
          <ConfirmDialog
            confirmLabel={t("delete")}
            description={t("deleteEntryConfirm")}
            onConfirm={handleDelete}
            title={t("deleteEntry")}
            trigger={
              <Button
                aria-label={t("deleteEntry")}
                size="icon-sm"
                variant="destructiveGhost"
              />
            }
          >
            <Trash2 />
          </ConfirmDialog>
        </div>
      </div>
      <textarea
        className="mt-5 w-full resize-none overflow-hidden bg-transparent font-heading font-medium text-display text-foreground outline-none placeholder:text-placeholder"
        data-tour-step-id="entry-title"
        onChange={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        placeholder={t("entryTitlePlaceholder")}
        readOnly={locked}
        ref={titleFieldRef}
        rows={1}
        spellCheck={false}
        value={title}
      />

      <TitleSuggestion
        getContent={getEntryContent}
        locked={locked}
        onAccept={handleAcceptTitle}
      />

      {/* The same hairline the home masthead uses: the title is a heading for
          what follows, not the first line of it. */}
      <div className="mt-4 border-hairline border-b" />

      <div className="mt-8" data-tour-step-id="entry-editor">
        <Editor
          content={activeEntry.content}
          editable={!locked}
          key={activeEntry.id}
          onRequestAttachment={handleRequestAttachment}
          onUpdate={handleEditorUpdate}
          placeholder={nudge}
          ref={editorHandleRef}
        />
      </div>
    </main>
  );
};
