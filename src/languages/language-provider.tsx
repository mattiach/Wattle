import { useEffect } from "react";
import type { ReactNode } from "react";

import { changeAppLanguage } from "@/languages/i18n";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  saveSettingsThunk,
  setLanguage,
} from "@/redux/slices/settings/settings.slice";
import type { Settings } from "@/redux/slices/settings/settings.types";

interface LanguageProviderProps {
  children: ReactNode;
}

export const LanguageProvider = ({ children }: LanguageProviderProps) => {
  const language = useAppSelector((state) => state.settings.language);

  useEffect(() => {
    changeAppLanguage(language);
  }, [language]);

  return <>{children}</>;
};

export const useLanguage = () => {
  const dispatch = useAppDispatch();
  const language = useAppSelector((state) => state.settings.language);

  const changeLanguage = (nextLanguage: Settings["language"]) => {
    dispatch(setLanguage(nextLanguage));
    dispatch(saveSettingsThunk());
  };

  return { language, setLanguage: changeLanguage };
};
