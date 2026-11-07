import { convertFileSrc } from "@tauri-apps/api/core";
import type { NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useWattleDir } from "../wattle-dir-context";
import { AttachmentFrame } from "./attachment-frame";
import { useMediaResize } from "../hooks/use-media-resize";

interface VideoAttachmentAttrs {
  attachmentId: number | null;
  mimeType: string | null;
  path: string | null;
  /** Set by the same bubble-menu buttons that align an image. */
  textAlign: "left" | "center" | "right" | null;
  width: number | null;
}

/**
 * An attached clip, treated exactly like an attached picture.
 *
 * It used to be a bare `<video>`: no way to size it, no way to remove it
 * without selecting the node and pressing delete. There was never a reason for
 * the two to differ - a clip in an entry is a figure in an entry - so it now
 * shares the frame, the resize gesture and the alignment attribute with the
 * image rather than having near-copies of each.
 */
export const VideoAttachmentView = ({
  node,
  selected,
  updateAttributes,
  deleteNode,
}: NodeViewProps) => {
  const { t } = useTranslation();
  const wattleDir = useWattleDir();
  const { path, attachmentId, textAlign, width } =
    node.attrs as VideoAttachmentAttrs;
  const videoRef = useRef<HTMLVideoElement>(null);
  const { draggingWidth, handleResizeStart } = useMediaResize(
    videoRef,
    (next) => updateAttributes({ width: next })
  );

  if (!(wattleDir && path)) {
    return <NodeViewWrapper as="div" data-attachment-id={attachmentId} />;
  }

  const src = convertFileSrc(`${wattleDir}/${path}`);
  const shown = draggingWidth ?? width;

  return (
    <NodeViewWrapper
      as="div"
      data-attachment-id={attachmentId}
      style={textAlign ? { textAlign } : undefined}
    >
      <AttachmentFrame
        onRemove={deleteNode}
        onResizeStart={handleResizeStart}
        resizeLabel={t("resizeVideo")}
        selected={selected}
      >
        {/* The handle is a sibling button, never bound to the element itself:
            the node is `draggable`, so a mousedown on the video would start a
            native drag of the whole block instead of a resize. */}
        <video
          className="block max-w-full rounded-xl ring-1 ring-hairline"
          controls
          ref={videoRef}
          src={src}
          style={shown ? { width: shown } : undefined}
        >
          <track kind="captions" />
        </video>
      </AttachmentFrame>
    </NodeViewWrapper>
  );
};
