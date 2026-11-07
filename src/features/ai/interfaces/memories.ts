/**
 * What similarity answers with, on this side of the wire.
 *
 * Thin: the floor, the cooldown and the ceiling on how
 * many memories may appear all live in Rust, where a caller cannot argue with
 * them. This names the shapes; `functions/memories.ts` invokes the commands.
 */

export interface RelatedMemory {
  entryDate: string;
  id: number;
  kind: "entry" | "spark";
  preview: string;
  /** Between 0 and 1. Never shown - a percentage would invite arguing with it. */
  similarity: number;
  title: string;
}

/**
 * Why a search came back with nothing - three facts, not one.
 *
 * "Nothing is close enough" is untrue of a young journal whose entries are all
 * about the same thing: they are close enough, they are simply not far enough
 * apart yet. Told apart in Rust so the interface can say the true one.
 *
 * "Never indexed" used to be a fourth, and is not a reason any more: an
 * unindexed journal is compared by its words instead of by its meaning, so
 * there is always an answer.
 */
export type NothingFound = "tooRecent" | "notAlike" | "exhausted";

export interface RelatedMemories {
  memories: RelatedMemory[];
  /** Set only when `memories` is empty, and then always. */
  nothing: NothingFound | null;
}
