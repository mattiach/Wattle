import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useState } from "react";

/** Narrow enough to be a thumbnail, wide enough to still be a picture. */
const MIN_WIDTH_PX = 80;

/**
 * Dragging a piece of media to a new width.
 *
 * Written once for the image and now shared with the video, because the two
 * were never going to be resized differently - and a second copy of this is a
 * second place for the transaction discipline below to be got wrong.
 *
 * **One transaction for the whole drag.** The width lives in React state while
 * the handle is moving and is committed only on mouseup. Writing every
 * mousemove into the document would put one history entry - and one autosave -
 * per pixel of travel, so a single undo would step back one twitch of a drag
 * instead of the drag. A click that never moved writes nothing at all.
 *
 * `element` is what actually gets measured, so the caller passes the `<img>` or
 * the `<video>` rather than the frame around it: the frame shrink-wraps, and
 * measuring it would compound its own padding into every drag.
 */
export const useMediaResize = (
  element: RefObject<HTMLElement | null>,
  commit: (width: number) => void
) => {
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);

  const handleResizeStart = (event: ReactMouseEvent) => {
    // Also what stops the node's own `draggable` from turning the gesture into
    // a native drag of the whole block.
    event.preventDefault();
    const media = element.current;
    if (!media) {
      return;
    }

    const startX = event.clientX;
    const startWidth = media.getBoundingClientRect().width;
    // Never wider than the column it is read in, so a stored width cannot
    // outgrow the page it ends up on - in the editor or in an export.
    const maxWidth =
      media.closest(".ProseMirror")?.clientWidth ?? Number.POSITIVE_INFINITY;

    let nextWidth = Math.round(startWidth);
    let moved = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moved = true;
      nextWidth = Math.round(
        Math.min(
          maxWidth,
          Math.max(MIN_WIDTH_PX, startWidth + (moveEvent.clientX - startX))
        )
      );
      setDraggingWidth(nextWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      setDraggingWidth(null);
      if (moved) {
        commit(nextWidth);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return { draggingWidth, handleResizeStart };
};
