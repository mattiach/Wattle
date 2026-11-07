import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";

import { textToDoc } from "@/lib/spark-content";

import { defaultEntriesState } from "./entries.data";

import type { JSONContent } from "@tiptap/core";

import type {
  AttachmentDto,
  EntryDetail,
  EntryKind,
  EntrySummary,
  Memory,
  SparkEcho,
} from "./entries.types";

/**
 * An entry as the list receives it. `preview` and `wordCount` are derived by the
 * backend on write, so a page of rows costs no document parsing here and the
 * documents themselves stay off the wire.
 */
interface EntrySummaryWireDto {
  createdAt: string;
  entryDate: string;
  id: number;
  kind: EntryKind;
  preview: string;
  title: string;
  updatedAt: string;
  wordCount: number;
}

interface EntryWireDto extends EntrySummaryWireDto {
  content: string;
}

/** Node types that carry no meaning on their own when left blank. */
const BLANK_NODE_TYPES = new Set(["doc", "paragraph", "text"]);

/**
 * True when nothing was written: no title, no text, and no node that exists for
 * its own sake (an image, a list, a quote). Creating an entry inserts a row
 * straight away, so blank ones have to be recognised and discarded.
 */
export const isEntryEmpty = (title: string, content: JSONContent): boolean => {
  if (title.trim()) {
    return false;
  }
  const hasSubstance = (node: JSONContent): boolean => {
    if (node.text?.trim()) {
      return true;
    }
    if (node.type && !BLANK_NODE_TYPES.has(node.type)) {
      return true;
    }
    return (node.content ?? []).some(hasSubstance);
  };
  return !hasSubstance(content);
};

const toEntryDetail = (dto: EntryWireDto): EntryDetail => ({
  ...dto,
  content: JSON.parse(dto.content) as JSONContent,
  snippet: null,
});

/** One screenful and a bit, so the sentinel is reached by scrolling, not on load. */
export const ENTRIES_PAGE_SIZE = 20;

interface FetchEntriesArgs {
  /** Number of entries already loaded; 0 starts the list over. */
  offset?: number;
  query?: string;
}

export const fetchEntries = createAsyncThunk(
  "entries/fetchEntries",
  async ({ offset = 0, query = "" }: FetchEntriesArgs = {}) => {
    // Browsing shows entries only, so the timeline is not buried under
    // one-liners; searching asks for every kind, so nothing a person wrote can
    // become unreachable just because of where they wrote it.
    const kind = query === "" ? "entry" : "";
    // The wire shape already is an `EntrySummary`; nothing to map.
    const entries = await invoke<EntrySummary[]>("list_entries", {
      kind,
      limit: ENTRIES_PAGE_SIZE,
      offset,
      query,
    });
    // The total only matters for a search, and only when the list starts over:
    // later pages are appended to a count that already covers them.
    const matchCount =
      offset === 0 && query !== ""
        ? await invoke<number>("count_entries", { kind, query })
        : null;
    return { entries, matchCount, offset, query };
  }
);

export const createEntry = createAsyncThunk(
  "entries/createEntry",
  async (entryDate: string) => {
    const dto = await invoke<EntryWireDto>("create_entry", { entryDate });
    return toEntryDetail(dto);
  }
);

/**
 * The same creation, on the lighter surface. A separate thunk rather than an
 * argument, so the two callers each read as what they are.
 */
export const createSpark = createAsyncThunk(
  "entries/createSpark",
  async (entryDate: string) => {
    const dto = await invoke<EntryWireDto>("create_entry", {
      entryDate,
      kind: "spark",
    });
    return toEntryDetail(dto);
  }
);

export const fetchEntry = createAsyncThunk(
  "entries/fetchEntry",
  async (id: number) => {
    const dto = await invoke<EntryWireDto>("get_entry", { id });
    return toEntryDetail(dto);
  }
);

export const saveEntry = createAsyncThunk(
  "entries/saveEntry",
  async ({
    id,
    title,
    content,
    entryDate,
  }: {
    id: number;
    title: string;
    content: JSONContent;
    entryDate: string;
  }) => {
    const dto = await invoke<EntryWireDto>("update_entry", {
      content: JSON.stringify(content),
      entryDate,
      id,
      title,
    });
    return toEntryDetail(dto);
  }
);

/**
 * A spark written and stored in one gesture.
 *
 * Creation and the first save are one action because a spark is one breath of
 * plain text: there is no draft to leave lying around, and the row exists only
 * once there is something in it. Both surfaces offering the capture field call
 * this, so neither can drift from the other on what a new spark is.
 */
export const captureSpark = createAsyncThunk(
  "entries/captureSpark",
  async (
    { entryDate, text }: { entryDate: string; text: string },
    { dispatch }
  ) => {
    const created = await dispatch(createSpark(entryDate));
    if (!createSpark.fulfilled.match(created)) {
      throw new Error("the spark could not be created");
    }
    await dispatch(
      saveEntry({
        content: textToDoc(text),
        entryDate,
        id: created.payload.id,
        title: "",
      })
    );
    return created.payload.id;
  }
);

export const removeEntry = createAsyncThunk(
  "entries/removeEntry",
  async (id: number) => {
    await invoke("delete_entry", { id });
    return id;
  }
);

export const fetchAttachments = createAsyncThunk(
  "entries/fetchAttachments",
  (entryId: number) => invoke<AttachmentDto[]>("list_attachments", { entryId })
);

export const addAttachment = createAsyncThunk(
  "entries/addAttachment",
  ({ entryId, sourcePath }: { entryId: number; sourcePath: string }) =>
    invoke<AttachmentDto>("add_attachment", { entryId, sourcePath })
);

export const removeAttachment = createAsyncThunk(
  "entries/removeAttachment",
  async (id: number) => {
    await invoke("delete_attachment", { id });
    return id;
  }
);

/**
 * What was written on this day in earlier years.
 *
 * `today` is passed in rather than read from SQLite, whose clock is UTC: the
 * day being remembered has to be the user's day, not one shifted by an offset.
 */
export const fetchOnThisDay = createAsyncThunk(
  "entries/fetchOnThisDay",
  (today: string) => invoke<Memory[]>("on_this_day", { today })
);

/**
 * The one older spark that comes back today.
 *
 * Same reason `today` is passed in: the day the rotation turns on has to be
 * the user's day, not SQLite's UTC one. Reading it changes nothing - the
 * selection is derived from the date and the candidate set, so no row is
 * marked as seen and no write happens inside a read.
 */
export const fetchSparkEcho = createAsyncThunk(
  "entries/fetchSparkEcho",
  (today: string) => invoke<SparkEcho | null>("spark_echo", { today })
);

/**
 * Brings an entry's attachments back in line with its document, once the
 * document has stopped changing.
 *
 * Deliberately not on save: a node removed with Backspace never reaches a React
 * handler, and a node removed and then restored with undo must keep its file.
 * Waiting until the entry is closed answers both, and the entry's stored
 * document is the authority on what is still in use.
 */
export const reconcileAttachments = createAsyncThunk(
  "entries/reconcileAttachments",
  (entryId: number) =>
    invoke<number>("reconcile_entry_attachments", { entryId })
);

const entriesSlice = createSlice({
  extraReducers: (builder) => {
    builder
      .addCase(fetchEntries.pending, (state) => {
        state.listStatus = "loading";
      })
      .addCase(fetchEntries.fulfilled, (state, action) => {
        const { entries, matchCount, offset, query } = action.payload;
        if (offset === 0) {
          state.list = entries;
          state.matchCount = matchCount;
        } else {
          state.list.push(...entries);
        }
        state.hasMore = entries.length === ENTRIES_PAGE_SIZE;
        state.query = query;
        state.listStatus = "loaded";
      })
      .addCase(fetchEntries.rejected, (state, action) => {
        // A *first* page that fails is a failed read, and the screen has to say
        // so. A later page that fails is one page missing from a list that is
        // already on screen: blanking forty entries and replacing them with
        // "could not be read" is the one thing this screen must never do, since
        // it is indistinguishable from an empty journal. What is loaded stays,
        // and `hasMore` goes false so the sentinel stops asking rather than
        // retrying against a backend that is not answering.
        if ((action.meta.arg?.offset ?? 0) === 0) {
          state.listStatus = "error";
          return;
        }
        state.listStatus = "loaded";
        state.hasMore = false;
      })
      .addCase(createEntry.pending, (state) => {
        state.activeEntryStatus = "loading";
        state.activeEntryAttachments = [];
      })
      .addCase(createEntry.fulfilled, (state, action) => {
        state.activeEntry = action.payload;
        state.activeEntryStatus = "loaded";
      })
      .addCase(createEntry.rejected, (state) => {
        state.activeEntryStatus = "error";
      })
      .addCase(fetchEntry.pending, (state) => {
        state.activeEntryStatus = "loading";
        state.activeEntryAttachments = [];
      })
      .addCase(fetchEntry.fulfilled, (state, action) => {
        state.activeEntry = action.payload;
        state.activeEntryStatus = "loaded";
      })
      .addCase(fetchEntry.rejected, (state) => {
        state.activeEntryStatus = "error";
      })
      .addCase(saveEntry.pending, (state) => {
        state.activeEntryStatus = "saving";
      })
      .addCase(saveEntry.fulfilled, (state, action) => {
        state.activeEntry = action.payload;
        state.activeEntryStatus = "loaded";
      })
      .addCase(saveEntry.rejected, (state) => {
        state.activeEntryStatus = "error";
      })
      .addCase(removeEntry.fulfilled, (state, action) => {
        state.list = state.list.filter((entry) => entry.id !== action.payload);
        // A deleted spark must not keep echoing until the next reload.
        if (state.sparkEcho?.id === action.payload) {
          state.sparkEcho = null;
        }
        if (state.activeEntry?.id === action.payload) {
          state.activeEntry = null;
          state.activeEntryStatus = "idle";
          state.activeEntryAttachments = [];
        }
      })
      .addCase(fetchOnThisDay.fulfilled, (state, action) => {
        state.memories = action.payload;
      })
      .addCase(fetchOnThisDay.rejected, (state) => {
        // Resurfacing is a gift, never an obligation: if it cannot be read,
        // the home screen simply carries on without it.
        state.memories = [];
      })
      .addCase(fetchSparkEcho.fulfilled, (state, action) => {
        state.sparkEcho = action.payload;
      })
      .addCase(fetchSparkEcho.rejected, (state) => {
        state.sparkEcho = null;
      })
      .addCase(fetchAttachments.fulfilled, (state, action) => {
        state.activeEntryAttachments = action.payload;
      })
      .addCase(addAttachment.fulfilled, (state, action) => {
        state.activeEntryAttachments.push(action.payload);
      })
      .addCase(removeAttachment.fulfilled, (state, action) => {
        state.activeEntryAttachments = state.activeEntryAttachments.filter(
          (attachment) => attachment.id !== action.payload
        );
      });
  },
  initialState: defaultEntriesState,
  name: "entries",
  reducers: {
    clearActiveEntry: (state) => {
      state.activeEntry = null;
      state.activeEntryStatus = "idle";
      state.activeEntryAttachments = [];
    },
    /** Set aside for this run of the app; not remembered between them. */
    dismissMemories: (state) => {
      state.memoriesDismissed = true;
    },
    /** Same again, and deliberately separate: two blocks, two refusals. */
    dismissSparkEcho: (state) => {
      state.sparkEchoDismissed = true;
    },
  },
});

export const { clearActiveEntry, dismissMemories, dismissSparkEcho } =
  entriesSlice.actions;

export default entriesSlice.reducer;
