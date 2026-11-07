import { X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * The ✕ every attachment wears, wherever it sits.
 *
 * A class string rather than a component, because the file chip needs it in
 * the flow and the two media nodes need it absolutely positioned - same pill,
 * same reveal, different corner. What must not drift is how it looks and when
 * it appears, and that is what lives here.
 */
export const attachmentRemoveClassName =
  "rounded-full bg-background/85 p-1.5 text-foreground opacity-0 shadow-[0_2px_8px_oklch(0_0_0/0.15)] backdrop-blur-sm transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100";

interface AttachmentFrameProps {
  /** The `<img>` or `<video>` itself. */
  children: ReactNode;
  /** Takes the node out of the document. Never the file off the disk. */
  onRemove: () => void;
  /** Absent on media that cannot be resized: no handle is drawn. */
  onResizeStart?: (event: ReactMouseEvent) => void;
  /** What the resize handle is called. Required when there is one. */
  resizeLabel?: string;
  /** The node is selected, which is the other way to reach the handle. */
  selected: boolean;
}

/**
 * The chrome around a piece of attached media.
 *
 * The image had all of this and the video had none of it. Rather than copy it
 * across, it moved here - so a picture and a clip are removed the same way,
 * resized the same way, reveal their controls at the same moment, and cannot
 * stop being alike later.
 *
 * The frame shrink-wraps (`inline-block`) so the ✕ and the handle sit against
 * the media rather than against the column. Alignment is applied by the caller,
 * on the wrapper outside this, for the same reason.
 */
export const AttachmentFrame = ({
  children,
  onRemove,
  onResizeStart,
  resizeLabel,
  selected,
}: AttachmentFrameProps) => {
  const { t } = useTranslation();

  return (
    <span
      className="group relative inline-block"
      // Selecting the media is the other way to reach the handle, so it can be
      // resized whenever, not only while the pointer is over it.
      data-selected={selected}
    >
      {children}
      <button
        aria-label={t("removeAttachment")}
        className={cn("absolute top-2 right-2", attachmentRemoveClassName)}
        // Only the node goes. The attachment itself is reconciled when the
        // entry is closed, so undo can still bring the media back.
        onClick={onRemove}
        type="button"
      >
        <X className="size-3.5" />
      </button>
      {onResizeStart ? (
        <button
          aria-label={resizeLabel}
          className="absolute top-1/2 right-0 h-10 w-1.5 translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full bg-wattle opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 group-data-[selected=true]:opacity-100"
          onMouseDown={onResizeStart}
          type="button"
        />
      ) : null}
    </span>
  );
};
