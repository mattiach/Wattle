import { Check } from "lucide-react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fromCalendarDate, todayCalendarDate } from "@/lib/dates";
import { SPARK_COUNTER_THRESHOLD, SPARK_MAX_CHARS } from "@/lib/spark-content";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/redux/hooks";
import { captureSpark } from "@/redux/slices/entries/entries.slice";

interface SparkComposerProps {
  autoFocus?: boolean;
  busy?: boolean;
  /** What the field starts with; editing an existing spark passes its text. */
  initialText?: string;
  /** Offered as a control, and as Escape while nothing has been typed yet. */
  onCancel?: () => void;
  onSubmit: (text: string) => Promise<void> | void;
  /** True for the capture field, which empties itself; false when editing. */
  resetAfterSubmit?: boolean;
  submitLabel: string;
}

/**
 * The field a spark is written in.
 *
 * A plain textarea, not an editor. A spark is one breath of plain text, and an
 * editor on this surface is what made a Spark read as an Entry with fewer
 * features - there is no slash menu, no bubble menu, no attachments and no
 * assistance here, because none of them belong to a thought caught in passing.
 *
 * Upright, not italic: italic is how a spark is read back, not how it is typed.
 */
export const SparkComposer = ({
  autoFocus,
  busy,
  initialText = "",
  onCancel,
  onSubmit,
  resetAfterSubmit,
  submitLabel,
}: SparkComposerProps) => {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);

  // The same technique the entry title uses: measured against its own content
  // on every change, so the sheet grows with the thought instead of scrolling.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height depends on the text even though the effect body reads it from the DOM rather than from the variable
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [text]);

  useEffect(() => {
    if (autoFocus) {
      fieldRef.current?.focus();
    }
  }, [autoFocus]);

  const isEmpty = text.trim() === "";

  const submit = async () => {
    if (isEmpty || busy) {
      return;
    }
    await onSubmit(text.trim());
    if (resetAfterSubmit) {
      setText("");
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    // Escape backs out only while there is nothing to lose. Typed text is
    // never discarded by a single keystroke.
    if (event.key === "Escape" && text === initialText) {
      onCancel?.();
    }
  };

  const handleSubmitClick = () => {
    submit();
  };

  // Quiet until it matters: a counter that ticks from the first character is
  // an audience, not an affordance.
  const showCounter = text.length >= SPARK_COUNTER_THRESHOLD;

  return (
    <div>
      <textarea
        aria-label={t("sparkPlaceholder")}
        className="w-full resize-none overflow-hidden bg-transparent font-serif text-body text-foreground outline-none placeholder:text-placeholder"
        maxLength={SPARK_MAX_CHARS}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t("sparkPlaceholder")}
        ref={fieldRef}
        rows={1}
        value={text}
      />
      <div className="mt-4 flex items-center justify-between gap-3 border-hairline border-t pt-3">
        <p className="text-faint text-meta tabular-nums">
          {showCounter ? (
            <span aria-live="polite">
              {t("sparkCharsLeft", { count: SPARK_MAX_CHARS - text.length })}
            </span>
          ) : (
            t("sparkSaveHint")
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onCancel ? (
            <Button onClick={onCancel} size="sm" type="button" variant="ghost">
              {t("cancel")}
            </Button>
          ) : null}
          <Button
            disabled={isEmpty || busy}
            onClick={handleSubmitClick}
            size="sm"
            type="button"
            variant="default"
          >
            <Check />
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

interface SparkCaptureProps {
  className?: string;
  /** Run once the spark is stored, so the list around it can catch up. */
  onSaved?: () => Promise<void> | void;
}

/**
 * Today's sheet: the date, and the field a spark is written into.
 *
 * Lives beside the composer rather than in either page, because both surfaces
 * that offer a capture field have to offer exactly the same one - the archive
 * should not be a place you can read sparks but not write one, and it should
 * not grow a second, subtly different way of writing them either.
 *
 * Sparks are for today. A past day is read back, not written into; that is
 * what the entry surface is for.
 */
export const SparkCapture = ({ className, onSaved }: SparkCaptureProps) => {
  const { i18n, t } = useTranslation();
  const dispatch = useAppDispatch();
  const today = todayCalendarDate();
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (text: string) => {
    setIsSaving(true);
    try {
      const result = await dispatch(captureSpark({ entryDate: today, text }));
      if (captureSpark.fulfilled.match(result)) {
        await onSaved?.();
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className={cn("p-5", className)}>
      <p className="eyebrow text-faint">
        {new Intl.DateTimeFormat(i18n.language, {
          day: "numeric",
          month: "long",
          weekday: "long",
        }).format(fromCalendarDate(today))}
      </p>
      <div className="mt-3" data-tour-step-id="sparks-capture">
        <SparkComposer
          busy={isSaving}
          onSubmit={handleSubmit}
          resetAfterSubmit
          submitLabel={t("saveThought")}
        />
      </div>
    </Card>
  );
};
