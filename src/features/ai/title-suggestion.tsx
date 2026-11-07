import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";
import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { resizeTransition } from "@/lib/motion";
import { docToText } from "@/lib/spark-content";
import { useAppSelector } from "@/redux/hooks";

import type { AiFailure } from "./interfaces/ai-errors";
import { toAiFailure } from "./functions/ai-errors";
import { useAiReady } from "./hooks/use-ai-ready";

/** The slot only ever fades: its height is reserved either way. */
const fadeHidden = { opacity: 0 };
const fadeVisible = { opacity: 1 };

interface TitleSuggestionProps {
  /** The entry's document as it stands when the action is invoked. */
  getContent: () => JSONContent | null;
  /** The entry is open read-only, so nothing may be written to its title. */
  locked?: boolean;
  onAccept: (title: string) => void;
}

/**
 * A name for what is already written.
 *
 * The one generative action in the product. It names what the text already
 * says rather than adding to it, and it is accepted or discarded like any
 * rewrite - nothing reaches the entry except through the accept handler.
 *
 * It stays offered for as long as assistance is on, including on an entry that
 * already has a title: a title you are unhappy with is exactly when you would
 * want another one, and having the control vanish the moment you typed a
 * character made it feel like it was hiding from you. Switching assistance off
 * on the AI screen is what removes it.
 */
export const TitleSuggestion = ({
  getContent,
  locked = false,
  onAccept,
}: TitleSuggestionProps) => {
  const { t } = useTranslation();
  const language = useAppSelector((state) => state.settings.language);
  // Assistance on and a model chosen says what was asked for; whether Ollama
  // is on this machine with that model downloaded says whether it can be
  // delivered. Both, because an offer that can only fail is worse than none.
  const enabled = useAppSelector(
    (state) => state.settings.aiEnabled && state.settings.aiModel !== ""
  );
  const ready = useAiReady();
  const canSuggest = enabled && ready === true;

  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);

  const run = async () => {
    const content = getContent();
    if (!content) {
      return;
    }
    setFailure(null);
    setWorking(true);
    try {
      const suggested = await invoke<string>("ai_rewrite", {
        action: "suggestTitle",
        language,
        text: docToText(content),
      });
      setSuggestion(suggested);
    } catch (error) {
      const next = toAiFailure(error);
      setFailure(next.wasCancelled ? null : next);
    }
    setWorking(false);
  };

  const accept = () => {
    if (suggestion) {
      onAccept(suggestion);
    }
    setSuggestion(null);
  };

  const discard = () => {
    setSuggestion(null);
    setFailure(null);
  };

  if (!canSuggest) {
    return null;
  }

  // A locked entry cannot take a new title, so offering to write one is an
  // action that would have to be refused. The row stays - same `min-h-8`, same
  // margins - so unlocking does not shove the editor down the page.
  if (locked) {
    return <div className="mt-2 min-h-8" />;
  }

  return (
    <div
      aria-live="polite"
      className="mt-2 flex min-h-8 items-center"
      role="status"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          animate={fadeVisible}
          className="w-full"
          exit={fadeHidden}
          initial={fadeHidden}
          key={suggestion === null ? "offer" : "suggestion"}
          transition={resizeTransition}
        >
          {suggestion === null ? (
            <Button
              className="-ml-2 text-assist-ink"
              disabled={working}
              onClick={run}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Sparkles />
              {working ? t("aiRewriting") : t("suggestTitle")}
            </Button>
          ) : (
            // Marked as coming from assistance, and set in the interface
            // font, so it never reads as something already written.
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-assist/30 border-dashed bg-assist/5 px-3 py-2">
              <span className="min-w-0 flex-1 font-sans text-foreground text-sm">
                {suggestion}
              </span>
              <Button onClick={accept} size="sm" type="button" variant="ghost">
                {t("aiUseTitle")}
              </Button>
              <Button onClick={discard} size="sm" type="button" variant="ghost">
                {t("aiDiscard")}
              </Button>
            </div>
          )}
          {failure ? (
            <p className="mt-1 text-destructive text-meta leading-snug">
              {t(failure.messageKey)}
            </p>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
