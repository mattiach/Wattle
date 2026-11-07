/**
 * Where a letter to your future self might start.
 *
 * The same shape and the same discipline as `writing-nudges.ts`: **subjects,
 * not sentences.** The `theme` is a noun phrase handed to the model, which
 * writes the actual question in the reader's own language - which is why there
 * is nothing here to translate.
 *
 * The difference from a nudge is the distance. A nudge asks about today; these
 * ask about something a person years from now would be glad was answered, and
 * `commands::ai::build_letter_prompt` is where that difference is actually
 * enforced.
 *
 * **The labels are the fallback, not decoration.** With assistance switched off
 * - which is the default and always will be - the model is never asked
 * anything, and these seven labels are the whole of the feature. It has to work
 * that way round: a letter must be writable by someone who has never turned
 * assistance on.
 *
 * The one rule a direction has to keep is the nudge file's rule: **ask, never
 * assume.** "A difficult or uncertain season" is something anyone can decline
 * to have had. "The difficult season you are in" is the application telling
 * someone about their own life.
 */

export interface LetterPrompt {
  /** Stored in `letters.prompt_id`. Stable, and never shown. */
  id: string;
  /** Key in the catalogue, for the button and for the composer's heading. */
  labelKey: string;
  /** The subject, in English, for the model. English because every instruction
   * in `commands::ai` is written in it, and the answer's field name is what
   * carries the reader's language back. */
  theme: string;
}
