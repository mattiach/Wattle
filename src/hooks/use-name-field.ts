import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
} from "@/redux/slices/profile/profile.data";
import {
  saveProfileThunk,
  setName,
} from "@/redux/slices/profile/profile.slice";

/**
 * Which rule the current text breaks, as a translation key.
 *
 * Keys rather than sentences: this decides *what* is wrong, and the words for
 * it belong to whichever language is loaded. The upper bound is not here
 * because the field enforces it - `maxLength` means an over-long name cannot be
 * typed, so there is no state to report.
 */
const errorKeyFor = (trimmed: string): string | undefined => {
  if (trimmed.length === 0) {
    return "nameRequired";
  }
  return trimmed.length < NAME_MIN_LENGTH ? "nameTooShort" : undefined;
};

/**
 * The profile name, wherever it is being edited.
 *
 * Onboarding asks for it and the settings page changes it later; both need the
 * same field, the same bounds and the same refusal, so all three live here
 * once. A page decides only where the message goes - under the input, or in
 * place of a row's description.
 *
 * `commit` is the whole of the guarantee that a stored name is always valid: it
 * writes only what passes, so an emptied or half-typed field is a *draft* that
 * is shown, marked wrong, and never persisted. Leaving the page therefore keeps
 * the last accepted name rather than the abandoned edit - and the effect below
 * puts that name back in the field on the way in.
 */
export const useNameField = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const storedName = useAppSelector((state) => state.profile.name);
  const [value, setValue] = useState(storedName);

  // Late hydration and a reset both arrive after this hook has already
  // rendered, so the field follows the store rather than snapshotting it once.
  useEffect(() => {
    setValue(storedName);
  }, [storedName]);

  const trimmed = value.trim();
  const errorKey = errorKeyFor(trimmed);
  const error = errorKey
    ? t(errorKey, { max: NAME_MAX_LENGTH, min: NAME_MIN_LENGTH })
    : undefined;

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  };

  const commit = () => {
    if (error || trimmed === storedName) {
      return;
    }
    dispatch(setName(trimmed));
    dispatch(saveProfileThunk());
  };

  return { commit, error, maxLength: NAME_MAX_LENGTH, onChange, value };
};
