import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ReactNode } from "react";
import { useCallback } from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<Value extends string> {
  /**
   * A node rather than a string: a segment is usually a word, but it can be
   * the thing itself - the reading sizes are chosen from four samples set at
   * the sizes they stand for.
   */
  label: ReactNode;
  value: Value;
}

interface SegmentedProps<Value extends string> {
  className?: string;
  /** Holds the whole group, for when the choice is not the user's to make yet. */
  disabled?: boolean;
  /** For a segment that holds more than one line. The single-line shape is the default. */
  itemClassName?: string;
  onValueChange: (value: Value) => void;
  options: SegmentedOption<Value>[];
  value: Value;
}

function Segmented<Value extends string>({
  className,
  disabled,
  itemClassName,
  onValueChange,
  options,
  value,
}: SegmentedProps<Value>) {
  const handleValueChange = useCallback(
    (groupValue: Value[]) => {
      const nextValue = groupValue.at(0);
      if (nextValue) {
        onValueChange(nextValue);
      }
    },
    [onValueChange]
  );

  return (
    <ToggleGroup
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 data-disabled:opacity-50",
        className
      )}
      data-slot="segmented"
      disabled={disabled}
      onValueChange={handleValueChange}
      value={[value]}
    >
      {options.map((option) => (
        <Toggle
          className={cn(
            "inline-flex h-7 select-none items-center justify-center rounded-[calc(var(--radius-lg)-0.25rem)] px-3 font-medium text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-[0_1px_2px_oklch(0_0_0/0.06)]",
            itemClassName
          )}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export { Segmented };
