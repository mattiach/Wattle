import { openPath } from "@tauri-apps/plugin-opener";
import type { NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { Download, File, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { downloadAttachment } from "@/features/entries/functions/export";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";

import { useAttachmentOwner } from "../attachment-owner-context";
import { useWattleDir } from "../wattle-dir-context";
import { attachmentRemoveClassName } from "./attachment-frame";

interface FileAttachmentAttrs {
  attachmentId: number | null;
  mimeType: string | null;
  path: string | null;
}

/** Both trailing controls, so they cannot drift apart from each other. */
const chipControlClassName =
  "shrink-0 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100";

export const FileAttachmentView = ({ node, deleteNode }: NodeViewProps) => {
  const { t } = useTranslation();
  const wattleDir = useWattleDir();
  const { path, attachmentId } = node.attrs as FileAttachmentAttrs;
  // Both are read unconditionally - a hook cannot be skipped - and the owner
  // wins when there is one. With no provider above it this is an entry, and
  // the entries slice answers exactly as it always has.
  const owner = useAttachmentOwner();
  const entryAttachments = useAppSelector(
    (state) => state.entries.activeEntryAttachments
  );
  const attachment = (owner?.attachments ?? entryAttachments).find(
    (item) => item.id === attachmentId
  );
  const filename = attachment?.filename ?? "file";

  const handleOpen = () => {
    if (wattleDir && path) {
      openPath(`${wattleDir}/${path}`);
    }
  };

  // Opening hands the file to whatever the system opens it with; this hands it
  // back to the reader, at a path they choose. Two different wants, and the
  // second had no way to be answered short of going into Wattle's own storage.
  const handleDownload = () => {
    if (attachmentId !== null) {
      (owner?.download ?? downloadAttachment)(attachmentId, filename);
    }
  };

  return (
    <NodeViewWrapper as="span" data-attachment-id={attachmentId}>
      {/* The chip used to *be* the open button, which left the other controls
          nowhere legal to go: a button cannot contain a button, and a click on
          either would have opened the file on its way out. So the chip is the
          surface and the three actions are siblings inside it. */}
      <span className="group inline-flex max-w-full items-center gap-1 rounded-lg border border-hairline bg-card py-1.5 pr-1.5 pl-3 align-middle text-[0.875rem] transition-colors duration-150 focus-within:border-border hover:border-border hover:bg-accent/60">
        <button
          className="inline-flex min-w-0 items-center gap-2"
          onClick={handleOpen}
          type="button"
        >
          <File className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-wattle-ink" />
          <span className="truncate">{filename}</span>
        </button>
        {/* Always in the flow, only ever faded: controls that appeared on hover
            would widen the chip under the pointer that summoned them. */}
        <button
          aria-label={t("downloadAttachment")}
          className={cn(chipControlClassName, "hover:text-foreground")}
          onClick={handleDownload}
          type="button"
        >
          <Download className="size-3.5" />
        </button>
        <button
          aria-label={t("removeAttachment")}
          className={cn(
            "shrink-0",
            attachmentRemoveClassName,
            // Flat against the chip rather than the raised pill the media
            // nodes wear: there it floats over a picture, here it sits on a
            // surface that is already a control - and recedes to match the
            // control beside it until it is hovered.
            "bg-transparent text-muted-foreground shadow-none backdrop-blur-none"
          )}
          onClick={deleteNode}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </NodeViewWrapper>
  );
};
