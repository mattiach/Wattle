import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { VideoAttachmentView } from "./video-attachment-view";

export const VideoAttachment = Node.create({
  addAttributes() {
    return {
      attachmentId: { default: null },
      mimeType: { default: null },
      path: { default: null },
      // The width the writer dragged it to, in pixels. `null` is "as wide as
      // it comes". The same attribute an image carries, so the two are sized,
      // stored and exported by the same rules. `textAlign` arrives globally
      // from `TextAlign`, as it does for an image.
      width: { default: null },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoAttachmentView);
  },

  atom: true,

  draggable: true,

  group: "block",

  name: "videoAttachment",

  parseHTML() {
    return [{ tag: "div[data-type='video-attachment']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "video-attachment" }),
    ];
  },
});
