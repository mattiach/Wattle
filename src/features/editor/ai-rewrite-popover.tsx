import { invoke } from "@tauri-apps/api/core";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AiFailure } from "@/features/ai/interfaces/ai-errors";
import { toAiFailure } from "@/features/ai/functions/ai-errors";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/redux/hooks";

/** The approved rewrite actions, in the order they are offered. */
const ACTIONS = ["fixGrammar", "makeShorter", "improveClarity"] as const;
type RewriteAction = (typeof ACTIONS)[number];

/**
 * What was selected when the rewrite was asked for.
 *
 * Captured once, at invocation, and held here rather than read back from the
 * editor: by the time a suggestion arrives the caret may be anywhere, and a
 * rewrite must land on the passage the writer chose or on nothing at all.
 */
export interface RewriteSelection {
  from: number;
  text: string;
  to: number;
}

interface AiRewritePopoverProps {
  editor: TiptapEditor;
  onClose: () => void;
  selection: RewriteSelection;
}

/**
 * Offers a rewrite, shows what came back, and applies it only if asked.
 *
 * The document is touched in exactly one place - the accept handlers below -
 * so a suggestion cannot overwrite anyone's writing by arriving. Until then the
 * original text is still there, unmodified, and autosave has nothing new to
 * save because nothing has changed.
 *
 * The suggestion is set in the interface font, deliberately. Serif is what the
 * writer wrote; a proposal in sans reads as a proposal, and only becomes theirs
 * - and Literata - at the moment it is accepted.
 */
export const AiRewritePopover = ({
  editor,
  onClose,
  selection,
}: AiRewritePopoverProps) => {
  const { t } = useTranslation();
  // The interface's language, not the passage's: someone reading Wattle in
  // Italian wants Italian back, whatever language they wrote that paragraph in.
  const language = useAppSelector((state) => state.settings.language);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    editor.commands.focus();
    onClose();
  }, [editor, onClose]);

  const run = async (action: RewriteAction) => {
    setFailure(null);
    setWorking(true);
    try {
      const result = await invoke<string>("ai_rewrite", {
        action,
        language,
        text: selection.text,
      });
      setSuggestion(result);
    } catch (error) {
      const next = toAiFailure(error);
      // Stopping on purpose is not a failure to report back at someone.
      if (next.wasCancelled) {
        setWorking(false);
        close();
        return;
      }
      setFailure(next);
    }
    setWorking(false);
  };

  const cancel = async () => {
    await invoke("ai_cancel_rewrite");
    close();
  };

  // Held in refs so the Escape listener below is registered once per state
  // rather than re-registered on every render.
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const closeRef = useRef(close);
  closeRef.current = close;

  // One chain, so Ctrl+Z reverses the whole rewrite in a single step.
  const replace = useCallback(() => {
    if (suggestion) {
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: selection.from, to: selection.to },
          { text: suggestion, type: "text" }
        )
        .run();
    }
    onClose();
  }, [editor, onClose, selection.from, selection.to, suggestion]);

  // Focus moves to the primary control of whatever the popover is showing -
  // on open, and again when a suggestion replaces the action list - so the
  // whole flow is reachable from the keyboard, Enter included. It was
  // mouse-only in practice before.
  // biome-ignore lint/correctness/useExhaustiveDependencies: which button is primary changes with the state, so focus has to follow the state even though the effect body only reads the DOM
  useEffect(() => {
    panelRef.current?.querySelector("button")?.focus();
  }, [suggestion, working, failure]);

  // Escape backs out from anywhere in the flow, including mid-request, where
  // it cancels rather than abandoning a model still generating.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (working) {
        cancelRef.current();
      } else {
        closeRef.current();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [working]);

  const insertBelow = () => {
    if (suggestion) {
      editor
        .chain()
        .focus()
        .insertContentAt(selection.to, {
          content: [{ text: suggestion, type: "text" }],
          type: "paragraph",
        })
        .run();
    }
    onClose();
  };

  const shell = (children: ReactNode) => (
    <div className="rounded-lg" ref={panelRef}>
      {children}
    </div>
  );

  if (working) {
    return shell(
      <div
        aria-busy="true"
        aria-live="polite"
        className="flex items-center gap-2 px-1.5 py-1"
        role="status"
      >
        <span className="text-assist-ink text-sm">{t("aiRewriting")}</span>
        <Button onClick={cancel} size="sm" type="button" variant="ghost">
          {t("cancel")}
        </Button>
      </div>
    );
  }

  if (failure) {
    return shell(
      <div className="flex max-w-sm flex-col gap-2 px-1.5 py-1">
        <div aria-live="polite" role="status">
          <p className="text-destructive text-sm leading-snug">
            {t(failure.messageKey)}
          </p>
          {/* The daemon's own words, kept as detail and never as the message. */}
          {failure.detail ? (
            <p className="wrap-break-word mt-1 text-meta text-muted-foreground">
              {failure.detail}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button onClick={close} size="sm" type="button" variant="ghost">
            {t("aiDiscard")}
          </Button>
        </div>
      </div>
    );
  }

  if (suggestion === null) {
    // A labelled list with descriptions, the same shape the slash menu uses -
    // one pattern, two menus, and room for a fourth action without a redesign.
    return shell(
      <div className="flex w-64 flex-col gap-0.5 px-1 py-1">
        <p className="eyebrow px-2 pt-1 pb-1 text-assist-ink">
          {t("aiSection")}
        </p>
        {ACTIONS.map((action) => (
          <RewriteActionButton
            action={action}
            description={t(`aiActionDescription.${action}`)}
            key={action}
            label={t(action)}
            onRun={run}
          />
        ))}
        <div className="mt-1 flex justify-end border-hairline border-t pt-1">
          <Button onClick={close} size="sm" type="button" variant="ghost">
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return shell(
    <div className="flex max-w-md flex-col gap-2 px-1.5 py-1">
      {/* The suggestion, still outside the document - and visibly so: the
          interface font and a dotted edge, never the page's own surface. */}
      <p
        aria-live="polite"
        className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-assist/30 border-dashed bg-assist/5 p-2 font-sans text-foreground text-sm leading-relaxed"
        role="status"
      >
        {suggestion}
      </p>
      <div className="flex items-center gap-0.5">
        <Button onClick={replace} size="sm" type="button" variant="ghost">
          {t("aiReplace")}
        </Button>
        <Button onClick={insertBelow} size="sm" type="button" variant="ghost">
          {t("aiInsertBelow")}
        </Button>
        <span className="mx-0.5 h-5 w-px bg-hairline" />
        <Button onClick={close} size="sm" type="button" variant="ghost">
          {t("aiDiscard")}
        </Button>
      </div>
    </div>
  );
};

interface RewriteActionButtonProps {
  action: RewriteAction;
  description: string;
  label: string;
  onRun: (action: RewriteAction) => void;
}

const RewriteActionButton = ({
  action,
  description,
  label,
  onRun,
}: RewriteActionButtonProps) => {
  const handleClick = () => onRun(action);
  return (
    <button
      className="rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
      onClick={handleClick}
      type="button"
    >
      <span className="block text-foreground text-sm leading-tight">
        {label}
      </span>
      <span className="mt-0.5 block text-meta text-muted-foreground leading-snug">
        {description}
      </span>
    </button>
  );
};
