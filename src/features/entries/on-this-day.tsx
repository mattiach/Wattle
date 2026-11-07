import { convertFileSrc } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { useWattleDir } from "@/features/editor/wattle-dir-context";
import { fromCalendarDate, todayCalendarDate } from "@/lib/dates";
import {
  arrivalAnimate,
  arrivalInitial,
  arrivalTransition,
} from "@/lib/motion";
import { paths } from "@/routing/paths";

import type { ReactNode } from "react";

import type { Memory } from "@/redux/slices/entries/entries.types";

interface MemoryCardProps {
  memory: Memory;
}

const MemoryCard = ({ memory }: MemoryCardProps) => {
  const { i18n, t } = useTranslation();
  const wattleDir = useWattleDir();

  const thumbnail =
    memory.imagePath && wattleDir
      ? convertFileSrc(`${wattleDir}/${memory.imagePath}`)
      : null;

  const date = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fromCalendarDate(memory.entryDate));

  return (
    <Link
      className="group block rounded-xl outline-none"
      to={paths.entries.detail.getHref(memory.id)}
    >
      <Card className="flex items-start gap-4 bg-memory-surface p-5 transition-all duration-200 ease-out-soft group-hover:border-border group-focus-visible:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/60">
        {thumbnail ? (
          // biome-ignore lint/correctness/useImageSize: an attachment's natural dimensions are not stored, and the thumbnail is cropped to a fixed box
          <img
            alt=""
            className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-hairline"
            loading="lazy"
            src={thumbnail}
          />
        ) : null}
        <div className="min-w-0">
          <p className="eyebrow text-wattle-ink">
            {t("yearsAgo", { count: memory.yearsAgo })}
          </p>
          {/* Set in the reading face, one step down and muted: a memory
              recedes rather than announces. */}
          <h3 className="mt-1.5 font-medium font-serif text-body-sm text-foreground leading-snug">
            {memory.title || (
              <span className="text-memory italic">{t("untitled")}</span>
            )}
          </h3>
          {memory.preview ? (
            <p className="mt-1.5 line-clamp-2 font-serif text-memory text-meta leading-relaxed">
              {memory.preview}
            </p>
          ) : null}
          <p className="mt-2 text-[0.75rem] text-memory">{date}</p>
        </div>
      </Card>
    </Link>
  );
};

/**
 * The most memories that may sit on the home screen at once.
 *
 * Beyond this the block stops being an offering and starts being a wall: an
 * anniversary in a journal five years old would otherwise stack five full
 * cards above the timeline before a single line of today's writing.
 */
const MEMORIES_SHOWN_PLAIN = 2;

/**
 * Puts a carousel control back in the flow.
 *
 * The primitive positions its arrows `absolute` and outside the box, which is
 * off the edge of a reading column; these sit in the heading row instead,
 * beside the control that sets the whole block aside.
 */
const CAROUSEL_ARROW = "static my-0";

/**
 * True when every memory falls on the calendar day itself.
 *
 * A memory may stand in from a day either side of the anniversary, and calling
 * that "on this day" would be a small lie in the heading.
 */
const allFallOnToday = (memories: Memory[]) => {
  const monthDay = todayCalendarDate().slice(5);

  return memories.every((memory) => memory.entryDate.slice(5) === monthDay);
};

interface MemoriesHeaderProps {
  /** Controls that belong before the dismiss, when there are any. */
  children?: ReactNode;
  onDismiss: () => void;
  title: string;
}

const MemoriesHeader = ({
  children,
  onDismiss,
  title,
}: MemoriesHeaderProps) => {
  const { t } = useTranslation();

  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 className="eyebrow text-faint">{title}</h2>
      <div className="flex items-center gap-1">
        {children}
        <Button
          aria-label={t("dismiss")}
          className="text-muted-foreground"
          onClick={onDismiss}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
    </div>
  );
};

interface OnThisDayProps {
  memories: Memory[];
  onDismiss: () => void;
}

/**
 * What was written on this day in earlier years.
 *
 * Deliberately quiet: it appears only when there is something to show, it can
 * be set aside with one click, and it can be switched off for good in settings.
 * A journal holds difficult days as well as good ones, so resurfacing has to be
 * something the reader can decline - never a notification, never a modal.
 */
export const OnThisDay = ({ memories, onDismiss }: OnThisDayProps) => {
  const { t } = useTranslation();

  if (memories.length === 0) {
    return null;
  }

  const title = allFallOnToday(memories) ? t("onThisDay") : t("aroundThisTime");

  // One or two stay as they were: a list that short is read at a glance, and
  // putting it behind a control would be asking for a gesture to see what is
  // already visible.
  //
  // Three or more become a carousel. One memory keeps the full width, because
  // a memory that has to be squinted at is not being offered; the sliver of
  // the next card is what says there are others. Deliberately not a count -
  // "1 of 5" turns remembering into a queue to get through.
  const body =
    memories.length >= MEMORIES_SHOWN_PLAIN ? (
      <Carousel opts={{ align: "start" }}>
        <MemoriesHeader onDismiss={onDismiss} title={title}>
          <CarouselPrevious
            aria-label={t("memoryPrevious")}
            className={CAROUSEL_ARROW}
          />
          <CarouselNext
            aria-label={t("memoryNext")}
            className={CAROUSEL_ARROW}
          />
        </MemoriesHeader>
        <CarouselContent>
          {memories.map((memory) => (
            <CarouselItem className="basis-[85%]" key={memory.id}>
              <MemoryCard memory={memory} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    ) : (
      <>
        <MemoriesHeader onDismiss={onDismiss} title={title} />
        <ul className="flex flex-col gap-3">
          {memories.map((memory) => (
            <li key={memory.id}>
              <MemoryCard memory={memory} />
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <motion.section
      animate={arrivalAnimate}
      initial={arrivalInitial}
      transition={arrivalTransition}
    >
      {body}
    </motion.section>
  );
};
