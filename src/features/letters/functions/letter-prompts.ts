/**
 * Where a letter to your future self might start.
 *
 * The directions themselves, and the lookup the composer reaches for. The rules
 * they have to keep are written beside `LetterPrompt` in
 * `interfaces/letter-prompts.ts`.
 */

import type { LetterPrompt } from "../interfaces/letter-prompts";

export const LETTER_PROMPTS: LetterPrompt[] = [
  {
    id: "goals",
    labelKey: "letterPromptGoals",
    theme: "what they are trying to reach, and why it matters to them now",
  },
  {
    id: "chapter",
    labelKey: "letterPromptChapter",
    theme: "a beginning they are standing at, and what it feels like from here",
  },
  {
    id: "hard",
    labelKey: "letterPromptHard",
    theme: "a difficult or uncertain season, without asking them to resolve it",
  },
  {
    id: "remember",
    labelKey: "letterPromptRemember",
    theme: "something they do not want to forget, however small",
  },
  {
    // The most valuable thing to read in ten years is the texture of an
    // ordinary day, not an ambition. Ambitions are remembered; Tuesdays are not.
    id: "ordinary",
    labelKey: "letterPromptOrdinary",
    theme: "what today was actually like, in the detail nobody usually records",
  },
  {
    // The strongest recall trigger there is over long spans, and the one thing
    // a person is least able to reconstruct afterwards.
    id: "person",
    labelKey: "letterPromptPerson",
    theme: "someone who matters to them now, and what they are like",
  },
  {
    id: "free",
    labelKey: "letterPromptFree",
    theme: "anything at all, with no subject given",
  },
];

export const findLetterPrompt = (id: string): LetterPrompt | null =>
  LETTER_PROMPTS.find((prompt) => prompt.id === id) ?? null;
