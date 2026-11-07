import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";

import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  saveSettingsThunk,
  setZoomLevel,
} from "@/redux/slices/settings/settings.slice";

import type { ReactNode } from "react";

/** Far enough either way to matter, near enough that the layout still holds. */
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.1;

/** Long enough that holding the shortcut writes once, not fifteen times. */
const PERSIST_DELAY_MS = 600;

const clamp = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));

interface ZoomProviderProps {
  children: ReactNode;
}

/**
 * Ctrl/Cmd + `+`, `-` and `0`, remembered.
 *
 * The web view's own zoom is not readable from script, so it cannot be stored
 * and cannot come back next time - which is the whole point of the request.
 * Wattle keeps its own level instead: written to settings, restored on the next
 * launch, and handed to the web view as *its* zoom.
 *
 * **Not CSS `zoom` on the root.** That scales the document while leaving the
 * viewport measured in unscaled pixels, and everything positioned from a
 * measurement - the tour's spotlight and its card, every Base UI popover,
 * select and dropdown menu, all of which anchor off `getBoundingClientRect` -
 * lands a proportional distance away from what it is pointing at. The web
 * view's own zoom scales the viewport with the page, so a rectangle measured in
 * script is the rectangle on screen at every level.
 */
export const ZoomProvider = ({ children }: ZoomProviderProps) => {
  const dispatch = useAppDispatch();
  const zoomLevel = useAppSelector((state) => state.settings.zoomLevel);

  useEffect(() => {
    // Nothing to fall back to and nothing to report: a web view that refuses
    // to zoom leaves the application at the size it already is.
    getCurrentWebview()
      .setZoom(zoomLevel)
      .catch(() => {
        // Not running under Tauri, or the platform refused.
      });
  }, [zoomLevel]);

  // Held in a ref so the listener is registered once rather than re-registered
  // on every step of a held shortcut.
  const zoomRef = useRef(zoomLevel);
  zoomRef.current = zoomLevel;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = (next: number) => {
      const level = clamp(next);
      if (level === zoomRef.current) {
        return;
      }
      dispatch(setZoomLevel(level));
      // Debounced: holding the shortcut walks through several levels, and only
      // the one it lands on is worth a write.
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => dispatch(saveSettingsThunk()), PERSIST_DELAY_MS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      // `=` is the unshifted key that carries `+` on most layouts, and
      // `NumpadAdd` is the other way people press it.
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        apply(zoomRef.current + ZOOM_STEP);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        apply(zoomRef.current - ZOOM_STEP);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        apply(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [dispatch]);

  return <>{children}</>;
};
