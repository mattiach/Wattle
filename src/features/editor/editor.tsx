import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { MouseEvent as ReactMouseEvent, Ref } from "react";
import { useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";

import { createEditorExtensions } from "./extensions/editor-extensions";
import { EditorBubbleMenu } from "./editor-bubble-menu";
import type { AttachmentKind } from "./slash-command/slash-command-items";
import { createSlashCommandExtension } from "./slash-command/slash-command-extension";

export interface AttachmentInsertAttrs {
  attachmentId: number;
  mimeType: string;
  path: string;
}

export interface EditorHandle {
  focus: () => void;
  insertAttachment: (
    kind: "image" | "video" | "file",
    attrs: AttachmentInsertAttrs
  ) => void;
}

interface EditorProps {
  content: JSONContent;
  /** False while the entry is locked: the document is read, not written. */
  editable?: boolean;
  /**
   * How the writer is asked for a file. Absent on a read-only surface, which
   * has nothing to ask for - the attachment nodes stay in the document model
   * either way, because a letter that has been opened has to *render* the
   * pictures it was written with.
   */
  onRequestAttachment?: (kind: AttachmentKind) => void;
  /** Left off by a read-only surface, which has no updates to report. */
  onUpdate?: (content: JSONContent) => void;
  /** What the empty document says instead of the usual invitation. Set only by
   * a writing nudge the reader accepted - it is a *placeholder*, so it is never
   * part of the document and never survives the first keystroke. */
  placeholder?: string;
  ref?: Ref<EditorHandle>;
}

const ATTACHMENT_NODE_TYPES = {
  file: "fileAttachment",
  image: "imageAttachment",
  video: "videoAttachment",
} as const;

export const Editor = ({
  content,
  editable = true,
  onRequestAttachment,
  onUpdate,
  placeholder,
  ref,
}: EditorProps) => {
  const { t } = useTranslation();

  const onRequestAttachmentRef = useRef(onRequestAttachment);
  onRequestAttachmentRef.current = onRequestAttachment;
  // Read once, at creation: a surface that offers attachments does not stop
  // offering them halfway through a session, and the slash menu is built once.
  const canAttach = useRef(onRequestAttachment !== undefined).current;

  const editor = useEditor({
    content,
    editable,
    // **No spelling underlines.** A journal is written in whichever language
    // the thought arrived in, with names, dialect and invented words in it, and
    // the web view checks it against one dictionary - which turned most of a
    // page red and said nothing true. The browser has no per-language answer to
    // give here, so the honest setting is off. `false` as a string because this
    // is a DOM attribute, not a React prop.
    editorProps: { attributes: { spellcheck: "false" } },
    extensions: [
      ...createEditorExtensions(placeholder ?? t("entryContentPlaceholder")),
      createSlashCommandExtension(
        canAttach ? (kind) => onRequestAttachmentRef.current?.(kind) : undefined
      ),
    ],
    onUpdate: ({ editor: currentEditor }) => {
      onUpdate?.(currentEditor.getJSON());
    },
  });

  // Locking and unlocking has to reach an editor that is already built, so the
  // prop is applied on change as well as at creation.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Tiptap builds its view on a detached element, which `EditorContent` only
  // puts in the document afterwards - so the `autofocus` option focuses a node
  // that is not in the page yet. Child effects run first, so by the time this
  // one fires the view is mounted and the caret actually lands.
  //
  // Not while locked: a read-only entry should open as something to read, with
  // no caret sitting in the middle of it.
  useEffect(() => {
    if (editable) {
      editor?.commands.focus("start", { scrollIntoView: false });
    }
  }, [editor, editable]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.chain().focus().run();
      },
      insertAttachment: (kind, attrs) => {
        editor
          ?.chain()
          .focus()
          .insertContent({ attrs, type: ATTACHMENT_NODE_TYPES[kind] })
          .run();
      },
    }),
    [editor]
  );

  // Clicking the empty space under the document puts the caret at the end,
  // the way a page of paper behaves.
  const handleTrailingClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editable && event.target === event.currentTarget) {
      editor?.chain().focus("end").run();
    }
  };

  if (!editor) {
    return null;
  }

  return (
    <>
      {/* No formatting bar over a document that cannot be formatted. */}
      {editable ? <EditorBubbleMenu editor={editor} /> : null}
      <EditorContent editor={editor} />
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: purely a larger click target for the caret; the editor itself is keyboard accessible */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same */}
      <div className="min-h-[22vh] w-full" onClick={handleTrailingClick} />
    </>
  );
};
