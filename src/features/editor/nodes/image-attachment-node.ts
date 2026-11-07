import TiptapImage from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ImageAttachmentView } from "./image-attachment-view";

export const ImageAttachment = TiptapImage.extend({
  addAttributes() {
    return {
      attachmentId: { default: null },
      mimeType: { default: null },
      path: { default: null },
      width: { default: null },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageAttachmentView);
  },

  name: "imageAttachment",
});
