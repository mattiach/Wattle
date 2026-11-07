/**
 * Similarity, asked for.
 *
 * The shapes these commands answer with are in `interfaces/memories.ts`.
 */

import { invoke } from "@tauri-apps/api/core";

import type { RelatedMemories } from "../interfaces/memories";

/**
 * The entry a memory would be looked for from, or nothing.
 *
 * Nothing means the journal does not yet reach back far enough for anything in
 * it to qualify - so the control is not drawn at all, rather than drawn over a
 * question that can only be answered "no". Costs one query and no model.
 */
export const fetchMemoryAnchor = () => invoke<number | null>("memory_anchor");

/**
 * One to three older entries about the same thing as this one.
 *
 * `exclude` is what has already been offered on this page, so asking again
 * offers something else rather than the same thing louder. It is held in the
 * component and forgotten when the page is left - nothing about what was shown
 * is ever written down.
 */
export const fetchRelatedMemories = (entryId: number, exclude: number[] = []) =>
  invoke<RelatedMemories>("related_memories", { entryId, exclude });

/**
 * Reads one entry for likeness, on its way out of the editor.
 *
 * Fire and forget, and it means it: Rust answers `false` - no request made -
 * whenever assistance is off, no model is installed, Ollama is not answering,
 * or the entry already has a current vector. Nothing here is worth a message to
 * someone who has just closed an entry, so the caller does not wait for it and
 * does not look at what comes back.
 */
export const indexEntry = (entryId: number) =>
  invoke<boolean>("index_entry", { entryId });
