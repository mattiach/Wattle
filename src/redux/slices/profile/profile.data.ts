import type { Profile } from "./profile.types";

export const defaultProfile: Profile = {
  createdAt: new Date().toISOString(),
  name: "",
};

/**
 * What a name may be.
 *
 * Required, between two and twelve characters. Empty used to mean "no name",
 * which read as a choice but was almost always an unfinished edit - and it left
 * the home screen greeting nobody. A single character is the same mistake one
 * keystroke later.
 *
 * Here rather than on the settings page because onboarding asks the same
 * question, and one rule read from two places cannot drift into two rules.
 * `useNameField` is what reads it.
 */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 12;
