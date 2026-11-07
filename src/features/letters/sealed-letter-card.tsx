import { Mail, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { fromCalendarDate } from "@/lib/dates";
import {
  arrivalAnimate,
  arrivalInitial,
  arrivalTransition,
} from "@/lib/motion";
import { paths } from "@/routing/paths";

import { letterStatus } from "./functions/letters";

import type { LetterSummary } from "./interfaces/letters";

/**
 * Set aside for this session.
 *
 * A module variable rather than a Redux slice or a stored setting. It has to
 * outlive the component - navigating to the calendar and back should not bring
 * a dismissed line straight back - and it must **not** outlive the run: a
 * letter's date is worth mentioning again tomorrow. That is exactly the
 * lifetime of a module in a page that is never reloaded, and it costs a
 * variable rather than a slice.
 */
let dismissedThisSession = false;

interface SealedLetterCardProps {
  /** False during a search, or after a failed read of the timeline. */
  browsing: boolean;
}

/**
 * One quiet line: there is a letter, and this is the day it opens.
 *
 * **No countdown.** Not "in 347 days", not a progress bar, not a badge, not a
 * count of how many are waiting. `relativeDaysAgo` in `lib/dates` is past-only
 * by construction and this is why: a number that counts down turns a letter
 * into a timer, and a timer is a nudge. With several letters sealed this names
 * the nearest one and says nothing at all about the rest.
 *
 * It can be set aside for the session, the way On This Day and the spark echo
 * can. A letter waiting is a small permanent obligation on the home screen, and
 * anything permanent on a home screen has to be dismissible.
 *
 * A line rather than a card, because it is not something to act on today. Every
 * rule about when it may appear lives inside it, so the home screen renders it
 * unconditionally and it renders nothing when there is nothing to say.
 */
export const SealedLetterCard = ({ browsing }: SealedLetterCardProps) => {
  const { i18n, t } = useTranslation();
  const [letter, setLetter] = useState<LetterSummary | null>(null);
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  useEffect(() => {
    if (!browsing) {
      return;
    }
    let cancelled = false;
    letterStatus()
      .then((status) => {
        if (!cancelled) {
          setLetter(status.waiting);
        }
      })
      .catch(() => {
        // Nothing is said. A home screen that cannot reach the database has
        // larger problems, and this line is not the place to report them.
        if (!cancelled) {
          setLetter(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [browsing]);

  const handleDismiss = () => {
    dismissedThisSession = true;
    setDismissed(true);
  };

  if (!(browsing && letter) || dismissed) {
    return null;
  }

  const date = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fromCalendarDate(letter.unlockOn));

  return (
    <motion.div
      animate={arrivalAnimate}
      className="group/letter mt-6 flex items-center gap-3"
      initial={arrivalInitial}
      transition={arrivalTransition}
    >
      <Mail className="size-4 shrink-0 text-memory" />
      <Link
        className="min-w-0 rounded-sm text-memory text-meta outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/60"
        to={paths.letters.getHref()}
      >
        {t("letterWaitingLine", { date })}
      </Link>
      {/* Faded out until the line is under the pointer: a permanent dismiss
          control next to a line this quiet is louder than the line itself. It
          keeps its box either way, so appearing moves nothing. The hover is
          taken on the whole row rather than on the text alone - the control
          sits at the far end, and one that vanished on the way to it could
          never be reached. */}
      <Button
        aria-label={t("dismiss")}
        className="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out-soft focus-visible:opacity-100 group-focus-within/letter:opacity-100 group-hover/letter:opacity-100"
        onClick={handleDismiss}
        size="icon-sm"
        variant="ghost"
      >
        <X />
      </Button>
    </motion.div>
  );
};
