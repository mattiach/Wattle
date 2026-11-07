/** The alignments a block may be given. The bubble menu draws one button per
 * entry, in this order. */
export const TEXT_ALIGNMENTS = ["left", "center", "right"] as const;

export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];
