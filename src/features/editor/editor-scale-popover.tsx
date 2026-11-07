import { ALargeSmall } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

import { EditorScaleField } from "./editor-scale-field";

/**
 * The reading size, beside the entry it is about.
 *
 * The control itself is the one Settings uses, unchanged - the same four
 * samples set at the sizes they stand for, reading and writing the same stored
 * value. Only the way in differs: an entry header is a row of icon buttons with
 * no room for four tiles, so they sit behind one, and Settings shows them
 * outright because that is a page for choosing rather than a page for writing.
 *
 * It stays open while sizes are being tried. The document is behind it and
 * resizes under each press, which is the whole question being asked, and a
 * panel that shut on the first answer would have to be reopened to compare.
 */
export const EditorScalePopover = () => {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={t("editorScale")}
            className="text-muted-foreground"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ALargeSmall />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto gap-3 p-4">
        <PopoverHeader>
          <PopoverTitle>{t("editorScale")}</PopoverTitle>
        </PopoverHeader>
        <EditorScaleField />
      </PopoverContent>
    </Popover>
  );
};
