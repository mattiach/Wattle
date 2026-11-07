/**
 * One question to start a letter from, or nothing at all.
 *
 * The whole of the AI in this feature, and it is deliberately the smallest
 * thing a model can be asked for. It writes a **question**, never a line of the
 * letter - the ceiling `ai_writing_nudge` already set, kept.
 *
 * Nothing it returns is stored: not in `letters.content`, not in `prompt_id`,
 * not anywhere. It is shown beside the editor while the direction stands and it
 * is gone when the direction changes. What *is* stored is the id of the
 * direction, which is a template in this repository.
 *
 * **It fails silently.** No Ollama, a daemon that will not answer, a request
 * that times out - the static directions stay on screen and nothing is said.
 * That is not error-swallowing: a letter must be writable with assistance
 * switched off, so a failure here is a normal state and not an incident.
 *
 * The composer does say when assistance is *unavailable* - off, or with no
 * model chosen - because that is a state the reader can do something about,
 * and silence there was read as the feature being broken rather than absent.
 * That notice is about the setting, not about this call: everything above
 * still fails without a word.
 */

import { invoke } from "@tauri-apps/api/core";

import { findLetterPrompt } from "./letter-prompts";

export const askLetterQuestion = async (
  promptId: string,
  language: string
): Promise<string> => {
  const prompt = findLetterPrompt(promptId);
  if (!prompt) {
    return "";
  }
  try {
    // A theme, never an instruction. What is actually asked of the model, and
    // every rule the answer has to keep, is built in `commands::ai` where a
    // caller cannot reach it.
    return await invoke<string>("ai_letter_prompt", {
      language,
      theme: prompt.theme,
    });
  } catch {
    return "";
  }
};
