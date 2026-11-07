import type { EntriesState } from "./entries.types";

export const defaultEntriesState: EntriesState = {
  activeEntry: null,
  activeEntryAttachments: [],
  activeEntryStatus: "idle",
  hasMore: false,
  list: [],
  listStatus: "idle",
  matchCount: null,
  memories: [],
  memoriesDismissed: false,
  query: "",
  sparkEcho: null,
  sparkEchoDismissed: false,
};
