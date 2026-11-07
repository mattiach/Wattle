import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  saveSettingsThunk,
  setTheme,
} from "@/redux/slices/settings/settings.slice";

import type { ReactNode } from "react";
import type { Settings } from "@/redux/slices/settings/settings.types";

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const theme = useAppSelector((state) => state.settings.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  return <>{children}</>;
};

export const useTheme = () => {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.settings.theme);

  const changeTheme = (nextTheme: Settings["theme"]) => {
    dispatch(setTheme(nextTheme));
    dispatch(saveSettingsThunk());
  };

  return { setTheme: changeTheme, theme };
};
