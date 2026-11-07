import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";

const AUTOSAVE_DELAY_MS = 1500;

export const useAutosave = (save: () => Promise<unknown>) => {
  const saveRef = useRef(save);
  saveRef.current = save;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isDirtyRef.current) {
      return;
    }
    isDirtyRef.current = false;
    await saveRef.current();
  }, []);

  const scheduleSave = useCallback(() => {
    isDirtyRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      isDirtyRef.current = false;
      saveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    const handleBlur = () => {
      flush();
    };
    window.addEventListener("blur", handleBlur);

    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await flush();
      await appWindow.destroy();
    });

    return () => {
      window.removeEventListener("blur", handleBlur);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [flush]);

  // Wrapped rather than returned directly: React treats whatever an effect
  // returns as its cleanup, and `flush` returns a promise - which React would
  // never await and TypeScript will not accept. The call is the same; only the
  // ignored return value stops travelling.
  useEffect(
    () => () => {
      flush();
    },
    [flush]
  );

  return { flush, scheduleSave };
};
