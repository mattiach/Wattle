import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { FileAttachmentView } from "./file-attachment-view";

export const FileAttachment = Node.create({
  addAttributes() {
    return {
      attachmentId: { default: null },
      mimeType: { default: null },
      path: { default: null },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },

  atom: true,

  draggable: true,

  group: "block",

  name: "fileAttachment",

  parseHTML() {
    return [{ tag: "div[data-type='file-attachment']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "file-attachment" }),
    ];
  },
});
