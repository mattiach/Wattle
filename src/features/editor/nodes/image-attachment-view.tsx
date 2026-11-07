import { convertFileSrc } from "@tauri-apps/api/core";
import type { NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useWattleDir } from "../wattle-dir-context";
import { AttachmentFrame } from "./attachment-frame";
import { useMediaResize } from "../hooks/use-media-resize";

interface ImageAttachmentAttrs {
  attachmentId: number | null;
  mimeType: string | null;
  path: string | null;
  /** Set by the same bubble-menu buttons that align a paragraph. */
  textAlign: "left" | "center" | "right" | null;
  width: number | null;
}

export const ImageAttachmentView = ({
  node,
  selected,
  updateAttributes,
  deleteNode,
}: NodeViewProps) => {
  const { t } = useTranslation();
  const wattleDir = useWattleDir();
  const { path, attachmentId, textAlign, width } =
    node.attrs as ImageAttachmentAttrs;
  const imageRef = useRef<HTMLImageElement>(null);
  const { draggingWidth, handleResizeStart } = useMediaResize(
    imageRef,
    (next) => updateAttributes({ width: next })
  );

  if (!(wattleDir && path)) {
    return <NodeViewWrapper as="div" data-attachment-id={attachmentId} />;
  }

  const src = convertFileSrc(`${wattleDir}/${path}`);
  const shown = draggingWidth ?? width;

  return (
    // The outer block carries the alignment; the frame inside it stays
    // shrink-wrapped around the image, which is what keeps the ✕ and the resize
    // handle positioned against the picture rather than against the column.
    <NodeViewWrapper
      as="div"
      data-attachment-id={attachmentId}
      style={textAlign ? { textAlign } : undefined}
    >
      <AttachmentFrame
        onRemove={deleteNode}
        onResizeStart={handleResizeStart}
        resizeLabel={t("resizeImage")}
        selected={selected}
      >
        {/* biome-ignore lint/correctness/useImageSize: attachment images have unknown natural dimensions ahead of load; width/height aren't part of the persisted attachment schema */}
        <img
          alt=""
          className="block max-w-full rounded-xl ring-1 ring-hairline transition-shadow duration-200 group-hover:shadow-[0_4px_24px_oklch(0_0_0/0.1)]"
          ref={imageRef}
          src={src}
          style={shown ? { width: shown } : undefined}
        />
      </AttachmentFrame>
    </NodeViewWrapper>
  );
};
