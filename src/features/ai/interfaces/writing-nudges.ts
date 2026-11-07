/**
 * What the assistant may invite someone to write about.
 *
 * **Subjects, not sentences.** Nothing here is ever shown to a reader - each
 * theme is a noun phrase handed to the model, which writes the actual
 * invitation in the reader's own language. That is what keeps the same theme
 * from arriving in the same words twice, and it is why this file holds no
 * translations: there is nothing here to translate.
 *
 * The one rule a theme has to keep: **ask, never assume.** "Something beautiful
 * they saw today" is a question anyone can answer, including with "nothing".
 * "The beautiful thing they saw today" is the application telling someone how
 * their day went, which is the failure this whole surface is built to avoid.
 */

import type { PartOfDay } from "@/lib/dates";

export interface WritingNudge {
  /** Stable, and never shown. It is the memory of "not this one again". */
  id: string;
  /**
   * The subject, in English, for the model. English because that is the
   * language every instruction in `commands::ai` is written in, and the field
   * name in the answer's grammar is what carries the reader's language back.
   */
  theme: string;
  /** When it makes sense to ask. `"any"` holds at every hour. */
  when: PartOfDay | "any";
}
