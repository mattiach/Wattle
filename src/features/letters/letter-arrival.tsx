import { MailOpen } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fromCalendarDate } from "@/lib/dates";
import {
  arrivalAnimate,
  arrivalInitial,
  arrivalTransition,
} from "@/lib/motion";
import { paths } from "@/routing/paths";

import { letterStatus } from "./functions/letters";

import type { LetterSummary } from "./interfaces/letters";

interface LetterArrivalProps {
  /** False during a search, or after a failed read of the timeline. */
  browsing: boolean;
}

/**
 * A letter whose day has come.
 *
 * **The one thing on the home screen that outranks the timeline**, and the one
 * thing there that cannot be set aside. Every other block on this screen is
 * dismissible because it is an offer; this is not an offer, it is something
 * that arrived, and it stays until it is actually opened - across sessions,
 * across restarts. A letter dismissed by an absent-minded click is a letter
 * that may never be found again.
 *
 * Nothing runs to make this appear. The letter's row is untouched from the day
 * it was sealed; availability is worked out from its date at the moment this
 * asks, which is why the card can turn up on a day the application was never
 * opened and still be right.
 *
 * The copy is careful about one thing. "A letter from your past self has
 * arrived" is true. "A gift from the past" is not - ten years is long enough
 * that the author may not exist in any meaningful sense, and the letter may not
 * be a kind one. That is the feature working, not failing, and nothing here
 * should promise warmth.
 */
export const LetterArrival = ({ browsing }: LetterArrivalProps) => {
  const { i18n, t } = useTranslation();
  const [letters, setLetters] = useState<LetterSummary[]>([]);

  useEffect(() => {
    if (!browsing) {
      return;
    }
    let cancelled = false;
    letterStatus()
      .then((status) => {
        if (!cancelled) {
          setLetters(status.arrived);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLetters([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [browsing]);

  if (!browsing || letters.length === 0) {
    return null;
  }

  const written = (letter: LetterSummary) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(fromCalendarDate(letter.writtenOn));

  return (
    <motion.section
      animate={arrivalAnimate}
      className="mt-10 flex flex-col gap-3"
      initial={arrivalInitial}
      transition={arrivalTransition}
    >
      {letters.map((letter) => (
        <Card
          className="flex items-center gap-4 bg-memory-surface p-5"
          key={letter.id}
        >
          <MailOpen className="size-4 shrink-0 text-wattle-ink" />
          <div className="min-w-0">
            <p className="font-sans text-body-sm text-foreground leading-snug">
              {t("letterArrivedTitle")}
            </p>
            <p className="mt-1 font-sans text-memory text-meta leading-snug">
              {t("letterWrittenAndLength", {
                count: letter.wordCount,
                date: written(letter),
              })}
            </p>
          </div>
          <Button
            className="ml-auto shrink-0"
            nativeButton={false}
            render={<Link to={paths.letters.detail.getHref(letter.id)} />}
            variant="outline"
          >
            {t("letterOpenIt")}
          </Button>
        </Card>
      ))}
    </motion.section>
  );
};
