/**
 * What went wrong, in the reader's language.
 *
 * The Rust side answers with a code (`ai:noModel`), optionally followed by
 * detail - Ollama's own words about a failure. Before this, those Rust
 * sentences reached users verbatim: English, developer voice, untranslated.
 * Now the code chooses a translated sentence and the detail stays available as
 * detail, which is where a daemon's own wording belongs.
 */

export interface AiFailure {
  /** Verbatim, when there is anything worth keeping. Never the message. */
  detail: string | null;
  /** i18n key for the sentence to show. */
  messageKey: string;
  /** Cancelling is not a failure; the caller decides whether to say anything. */
  wasCancelled: boolean;
}
