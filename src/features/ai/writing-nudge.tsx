import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SparklesIcon } from "@/components/icons/sparkles";
import { partOfDay, todayCalendarDate } from "@/lib/dates";
import {
  arrivalAnimate,
  arrivalInitial,
  resizeTransition,
  settleAnimate,
  settleInitial,
  settleTransition,
} from "@/lib/motion";
import { useAppSelector } from "@/redux/hooks";

import { pickNudge } from "./functions/writing-nudges";
import { useAiReady } from "./hooks/use-ai-ready";

import type { SparklesIconHandle } from "@/components/icons/sparkles";

/** How many themes back the picker refuses to repeat. */
const RECENT_LIMIT = 5;

/**
 * What has just been asked, and what came back.
 *
 * Module-level rather than Redux, and deliberately not persisted. They exist so
 * that leaving the home screen and coming back does not cost a second model
 * load - a cold model is tens of seconds, and paying that twice for the same
 * sentence is the one way this could become an annoyance rather than an offer.
 * Restarting Wattle forgets all of it, which is the right amount of memory for
 * a suggestion.
 */
let recent: string[] = [];
let cached: { date: string; language: string; text: string } | null = null;
/** Waved off for this session. Not a setting: tomorrow it may ask again. */
let dismissed = false;

interface WritingNudgeProps {
  /** False during a search, or after a failed read of the timeline. A prompt
   * in the middle of either is an interruption rather than an offer. */
  browsing: boolean;
  /** Opens today's entry with this as the editor's placeholder. */
  onWrite: (nudge: string) => void;
}

/**
 * Something to write about, when nothing comes.
 *
 * The blank page is the oldest problem a journal has, and this is the only
 * place in Wattle where a model *composes* rather than reads back. What it
 * composes is a question - one sentence, asking about something the writer may
 * or may not have. Nothing it produces reaches an entry: accepted, it becomes
 * the editor's placeholder, which disappears the moment a key is pressed.
 *
 * It wears the dashed `--assist` surface every proposal in Wattle wears - the
 * same one a suggested title and the weekly invitation use - so it reads as a
 * suggestion before a word of it is read.
 *
 * **It fails silently.** `bootstrap.ts` wakes Ollama without waiting for it, so
 * the first request of a session can easily arrive before the daemon is
 * answering. That is ordinary and expected, and must not put an error on the
 * home screen; what is left instead is one quiet line offering to try again.
 */
export const WritingNudge = ({ browsing, onWrite }: WritingNudgeProps) => {
  const { t } = useTranslation();
  const language = useAppSelector((state) => state.settings.language);
  // Switched on with a model chosen is what the reader asked for; Ollama
  // installed, awake and holding that model is whether it can be given. An
  // unprompted offer has to know both, or the home screen shows a card that
  // can only ever fail.
  const enabled = useAppSelector(
    (state) =>
      browsing && state.settings.aiEnabled && state.settings.aiModel !== ""
  );
  const ready = useAiReady();
  const canNudge = enabled && ready === true;

  const [text, setText] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  // Whether the model has been asked and has finished being asked. The quiet
  // line is what is left over from a request that came back with nothing, so
  // it may not be on screen before there has been one: it used to appear on
  // the first frame of every visit and be replaced a moment later by the card,
  // which read as the home screen flickering.
  const [attempted, setAttempted] = useState(false);
  const [waved, setWaved] = useState(dismissed);

  // An answer that arrives after the reader has gone is dropped rather than
  // chased: nothing is cancelled in Rust, because a nudge is one short sentence
  // and `rewrite_cancelled` belongs to the editor - reaching for it here would
  // let leaving the home screen kill a rewrite someone is waiting on.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // The eyebrow's glyph, played once each time a new suggestion lands. Tied to
  // the arrival rather than to hover: this card appears on its own, and the one
  // moment worth marking is the moment it has something to say.
  const sparkleRef = useRef<SparklesIconHandle>(null);
  useEffect(() => {
    if (text !== null) {
      sparkleRef.current?.startAnimation();
    }
  }, [text]);

  const ask = useCallback(async () => {
    const nudge = pickNudge(partOfDay(), recent);
    if (!nudge) {
      return;
    }
    recent = [nudge.id, ...recent.filter((seen) => seen !== nudge.id)].slice(
      0,
      RECENT_LIMIT
    );
    setThinking(true);
    try {
      const invitation = await invoke<string>("ai_writing_nudge", {
        language,
        theme: nudge.theme,
      });
      cached = { date: todayCalendarDate(), language, text: invitation };
      if (liveRef.current) {
        setText(invitation);
      }
    } catch {
      // Said to nobody. A model that would not come is not news to a reader who
      // never asked for one - so a first attempt falls back to the quiet line,
      // and a failed "ask me something else" simply leaves standing what is
      // already on the screen rather than taking it away as well.
    }
    if (liveRef.current) {
      setThinking(false);
      setAttempted(true);
    }
  }, [language]);

  useEffect(() => {
    if (!canNudge || waved) {
      return;
    }
    // Yesterday's invitation is stale on a screen whose whole subject is today,
    // and one written in a language nobody is reading any more is stale at once.
    if (cached?.date === todayCalendarDate() && cached.language === language) {
      setText(cached.text);
      return;
    }
    cached = null;
    ask();
  }, [ask, canNudge, language, waved]);

  const wave = () => {
    dismissed = true;
    setWaved(true);
  };

  const write = () => {
    if (text !== null) {
      onWrite(text);
    }
  };

  // Nothing at all until there is something to say, or nothing to be said.
  if (!(canNudge && !waved) || (text === null && !attempted)) {
    return null;
  }

  return (
    <motion.section
      animate={settleAnimate}
      className="mt-6"
      initial={settleInitial}
      transition={settleTransition}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          animate={arrivalAnimate}
          exit={arrivalInitial}
          initial={arrivalInitial}
          key={text === null ? "waiting" : "invitation"}
          transition={resizeTransition}
        >
          {text === null ? (
            // Nothing to read yet, so nothing that looks like a card: one line,
            // whether it is still thinking or has quietly given up.
            <Button
              className="-ml-2 text-assist-ink"
              disabled={thinking}
              onClick={ask}
              size="sm"
              type="button"
              variant="ghost"
            >
              <SparklesIcon />
              {thinking ? t("nudgeThinking") : t("nudgeOffer")}
            </Button>
          ) : (
            <Card className="border-assist/30 border-dashed bg-assist/5 p-5 transition-colors duration-200 ease-out-soft hover:border-assist/50">
              {/* Read top to bottom now, rather than left to right: what this
                  is, what it suggests, what you can do about it. The suggestion
                  and the controls used to share a row - which set the question
                  in the smallest type on the card and stood three buttons of
                  equal weight beside it, so the one thing worth doing was the
                  hardest thing to find. */}
              <p className="eyebrow flex items-center gap-1.5 text-assist-ink">
                <SparklesIcon className="size-3.5" ref={sparkleRef} />
                {t("nudgeCue")}
              </p>
              {/* Inter, not Literata: this is the application speaking, and it
                  must never look like something already written. A step up in
                  size is all the emphasis it gets, and all it needs - nothing
                  else on the card competes with it now. */}
              <p className="mt-2 font-sans text-body text-foreground leading-snug">
                {text}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* The one action the card exists for, and the only one on it
                    painted as such. Asking again is a second attempt at the
                    same thing, and putting it away is not an action at all. */}
                <Button onClick={write} size="sm" type="button">
                  {t("nudgeWrite")}
                </Button>
                <Button
                  disabled={thinking}
                  onClick={ask}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {thinking ? t("nudgeThinking") : t("nudgeAnother")}
                </Button>
                <Button
                  className="ml-auto text-muted-foreground"
                  onClick={wave}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("nudgeDismiss")}
                </Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
};
