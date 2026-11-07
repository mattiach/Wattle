import { Lock, Mail, MailOpen, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { paths } from "@/routing/paths";
import { listLetters } from "@/features/letters/functions/letters";
import { fromCalendarDate } from "@/lib/dates";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";
import type { LetterSummary } from "@/features/letters/interfaces/letters";

/**
 * A sealed letter's row: a date, a length, and nothing else.
 *
 * There is no link on it, because there is nowhere to go. There is no
 * countdown, because a letter with a timer on it is a letter that nags, and no
 * count of how many are waiting, because that is a number presented as
 * progress. What it says is the one true thing it can say without saying
 * anything private: this opens on that day, and it is this long.
 */
const WaitingRow = ({ letter }: { letter: LetterSummary }) => {
  const { i18n, t } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fromCalendarDate(letter.unlockOn));

  return (
    <Card className="flex items-center gap-4 bg-memory-surface p-5">
      <Lock className="size-4 shrink-0 text-memory" />
      <div className="min-w-0">
        <p className="font-sans text-body-sm text-foreground leading-snug">
          {t("letterOpensOnDate", { date })}
        </p>
        <p className="mt-1 text-memory text-meta">
          {t("letterWrittenAndLength", {
            count: letter.wordCount,
            date: new Intl.DateTimeFormat(i18n.language, {
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(fromCalendarDate(letter.writtenOn)),
          })}
        </p>
      </div>
    </Card>
  );
};

interface ReadableRowProps {
  /** True for one whose day has come but which has not been read yet. */
  arrived: boolean;
  letter: LetterSummary;
}

const ReadableRow = ({ arrived, letter }: ReadableRowProps) => {
  const { i18n, t } = useTranslation();
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(fromCalendarDate(value));

  return (
    <Link
      className="group block rounded-xl outline-none"
      to={paths.letters.detail.getHref(letter.id)}
    >
      <Card
        className={cn(
          "flex items-center gap-4 p-5 transition-all duration-200 ease-out-soft group-hover:border-border group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60",
          arrived ? "bg-memory-surface" : ""
        )}
      >
        <MailOpen
          className={cn(
            "size-4 shrink-0",
            arrived ? "text-wattle-ink" : "text-memory"
          )}
        />
        <div className="min-w-0">
          <p className="font-sans text-body-sm text-foreground leading-snug">
            {arrived
              ? t("letterHasArrived")
              : t("letterWrittenOn", { date: date(letter.writtenOn) })}
          </p>
          <p className="mt-1 text-memory text-meta">
            {arrived
              ? t("letterWrittenAndLength", {
                  count: letter.wordCount,
                  date: date(letter.writtenOn),
                })
              : t("letterOpenedOn", {
                  date: date(letter.openedAt.slice(0, 10)),
                })}
          </p>
        </div>
      </Card>
    </Link>
  );
};

const Section = ({
  children,
  title,
  tourStepId,
}: {
  children: ReactNode;
  title: string;
  /** Anchors a guided-tour step to a section that may not be here yet. */
  tourStepId?: string;
}) => (
  <section className="mt-10" data-tour-step-id={tourStepId}>
    <h2 className="eyebrow mb-3 text-faint">{title}</h2>
    <ul className="flex flex-col gap-3">{children}</ul>
  </section>
);

/**
 * Every letter, in the four states a letter can be in.
 *
 * The order is the order they matter in: one that has arrived and not been read
 * outranks everything; then the draft, because it is the only one that can
 * still be changed; then what is waiting; then what has been read.
 *
 * The action in the header says "write" or "continue" and never both, because
 * the composer offers one draft at a time.
 */
export const LettersPage = () => {
  const { t } = useTranslation();
  const [letters, setLetters] = useState<LetterSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLetters().then((fetched) => {
      if (!cancelled) {
        setLetters(fetched);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = letters ?? [];
  const draft = all.find((letter) => letter.status === "draft") ?? null;
  const arrived = all.filter(
    (letter) => letter.available && letter.openedAt === ""
  );
  const waiting = all.filter(
    (letter) => letter.status === "sealed" && !letter.available
  );
  const opened = all.filter((letter) => letter.openedAt !== "");

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <PageHeader
        actions={
          <Button
            data-tour-step-id="letters-write"
            nativeButton={false}
            render={<Link to={paths.letters.compose.getHref()} />}
          >
            <PenLine />
            {draft ? t("letterContinueDraft") : t("letterWrite")}
          </Button>
        }
        description={t("lettersDescription")}
        title={t("letters")}
        titleTourId="letters-what"
      />

      {letters && all.length === 0 ? (
        <EmptyState
          body={t("lettersEmptyBody")}
          className="mt-24"
          title={t("lettersEmptyTitle")}
        />
      ) : null}

      <PageIntro delay={0.05}>
        {arrived.length > 0 ? (
          <Section title={t("letterArrivedHeading")}>
            {arrived.map((letter) => (
              <li key={letter.id}>
                <ReadableRow arrived letter={letter} />
              </li>
            ))}
          </Section>
        ) : null}

        {draft ? (
          <Section title={t("letterDraftHeading")}>
            <li>
              <Link
                className="group block rounded-xl outline-none"
                to={paths.letters.compose.getHref()}
              >
                <Card className="flex items-center gap-4 border-dashed p-5 transition-all duration-200 ease-out-soft group-hover:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
                  <Mail className="size-4 shrink-0 text-muted-foreground" />
                  <p className="font-sans text-body-sm text-foreground leading-snug">
                    {t("letterDraftRow", { count: draft.wordCount })}
                  </p>
                </Card>
              </Link>
            </li>
          </Section>
        ) : null}

        {waiting.length > 0 ? (
          <Section
            title={t("letterWaitingHeading")}
            tourStepId="letters-waiting"
          >
            {waiting.map((letter) => (
              <li key={letter.id}>
                <WaitingRow letter={letter} />
              </li>
            ))}
          </Section>
        ) : null}

        {opened.length > 0 ? (
          <Section title={t("letterOpenedHeading")}>
            {opened.map((letter) => (
              <li key={letter.id}>
                <ReadableRow arrived={false} letter={letter} />
              </li>
            ))}
          </Section>
        ) : null}
      </PageIntro>
    </main>
  );
};
