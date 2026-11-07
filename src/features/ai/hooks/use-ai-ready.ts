import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { useAppSelector } from "@/redux/hooks";

import type { AiStatus } from "../interfaces/ai-status";

/**
 * Asks what this machine has, waking an idle runtime once to find out.
 *
 * Which models are on the disk is Ollama's to answer, so a runtime that is
 * installed but not yet talking cannot say whether the chosen model is there.
 * `bootstrap.ts` wakes it without waiting, and the home screen is usually
 * mounted before it replies - so the answer is asked for again rather than
 * read as "nothing installed" for the rest of the session.
 */
const probe = async (model: string): Promise<boolean> => {
  // `ai_status` answers `disabled` without touching the disk while assistance
  // is off, so this only ever probes for a reader who asked for it.
  let status = await invoke<AiStatus>("ai_status");
  if (status.state === "installed") {
    await invoke("ai_start_ollama");
    status = await invoke<AiStatus>("ai_status");
  }
  return (
    status.state === "running" &&
    status.catalog.some((row) => row.id === model && row.installed)
  );
};

/**
 * Whether an assisted suggestion can actually be produced right now.
 *
 * Being switched on and having picked a model says what the reader asked for,
 * not what this machine can do: Ollama may never have been installed, may be
 * installed and idle, and the chosen model may have been removed outside
 * Wattle. Anything that *offers* assistance unprompted - the home screen's
 * nudge, the suggested title - has to know the difference, because an offer
 * that can only fail is worse than no offer.
 *
 * Null while the answer is not known yet, so callers show nothing rather than
 * flashing an offer they may have to take back.
 */
export const useAiReady = (): boolean | null => {
  const enabled = useAppSelector((state) => state.settings.aiEnabled);
  const model = useAppSelector((state) => state.settings.aiModel);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!(enabled && model)) {
      setReady(false);
      return;
    }
    let live = true;
    probe(model)
      .then((next) => {
        if (live) {
          setReady(next);
        }
      })
      .catch(() => {
        if (live) {
          setReady(false);
        }
      });
    return () => {
      live = false;
    };
  }, [enabled, model]);

  return ready;
};
