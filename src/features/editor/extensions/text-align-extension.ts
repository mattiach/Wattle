import { Extension } from "@tiptap/core";

/**
 * A figure aligns the same way a paragraph does, by the same attribute and the
 * same bubble-menu buttons - so there is no second alignment concept to learn,
 * and no second one to maintain. A clip is a figure: it is here for the same
 * reason a picture is.
 */
const ALIGNABLE_TYPES = [
  "paragraph",
  "heading",
  "imageAttachment",
  "videoAttachment",
];

/**
 * Adds a `textAlign` attribute to block nodes.
 *
 * Only the attribute: the bubble menu applies it with `updateAttributes`, so
 * there are no custom commands and none of the module augmentation they would
 * need. That keeps this a dozen lines instead of another Tiptap dependency.
 */
export const TextAlign = Extension.create({
  addGlobalAttributes() {
    return [
      {
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.style.textAlign || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.textAlign
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
        types: ALIGNABLE_TYPES,
      },
    ];
  },
  name: "textAlign",
});
