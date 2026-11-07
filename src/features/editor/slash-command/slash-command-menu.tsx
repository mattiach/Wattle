import type { Ref } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import type { SlashCommandItem } from "./slash-command-items";

export interface SlashCommandMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashCommandMenuProps {
  command: (item: SlashCommandItem) => void;
  items: SlashCommandItem[];
  ref?: Ref<SlashCommandMenuHandle>;
}

const menuClassName =
  "w-[19rem] overflow-hidden rounded-xl border border-hairline bg-popover p-1 shadow-float duration-150 animate-in fade-in zoom-in-95";

export const SlashCommandMenu = ({
  command,
  items,
  ref,
}: SlashCommandMenuProps) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previousItems, setPreviousItems] = useState(items);
  const listRef = useRef<HTMLDivElement>(null);

  if (items !== previousItems) {
    setPreviousItems(items);
    setSelectedIndex(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event) => {
        if (items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((index) => (index + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (index) => (index - 1 + items.length) % items.length
          );
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selectedIndex];
          if (item) {
            command(item);
          }
          return true;
        }
        return false;
      },
    }),
    [items, selectedIndex, command]
  );

  if (items.length === 0) {
    return (
      <div className={menuClassName}>
        <p className="px-3 py-2.5 text-muted-foreground text-sm">
          {t("slashNoResults")}
        </p>
      </div>
    );
  }

  return (
    <div className={menuClassName}>
      <div
        className="max-h-[19rem] overflow-y-auto overscroll-contain"
        ref={listRef}
      >
        {items.map((item, index) => (
          <div key={item.title}>
            {items[index - 1]?.category === item.category ? null : (
              <p className="eyebrow px-2.5 pt-2.5 pb-1 text-faint">
                {t(`slashCategory.${item.category}`)}
              </p>
            )}
            <SlashCommandMenuItem
              index={index}
              isSelected={index === selectedIndex}
              item={item}
              onHover={setSelectedIndex}
              onSelect={command}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

interface SlashCommandMenuItemProps {
  index: number;
  isSelected: boolean;
  item: SlashCommandItem;
  onHover: (index: number) => void;
  onSelect: (item: SlashCommandItem) => void;
}

const SlashCommandMenuItem = ({
  index,
  isSelected,
  item,
  onHover,
  onSelect,
}: SlashCommandMenuItemProps) => {
  const Icon = item.icon;

  const handleHover = () => {
    onHover(index);
  };

  const handleSelect = () => {
    onSelect(item);
  };

  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100",
        isSelected && "bg-accent"
      )}
      data-index={index}
      onClick={handleSelect}
      onMouseEnter={handleHover}
      type="button"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-card transition-colors duration-100",
          isSelected && "border-wattle/40 text-wattle-ink"
        )}
      >
        <Icon className="size-[0.95rem]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-[0.875rem] text-foreground leading-tight">
          {item.title}
        </span>
        <span className="truncate text-[0.75rem] text-muted-foreground leading-tight">
          {item.description}
        </span>
      </span>
    </button>
  );
};
