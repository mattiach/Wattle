import { useCallback } from "react";

import { useAppDispatch } from "@/redux/hooks";
import {
  addAttachment,
  fetchAttachments,
} from "@/redux/slices/entries/entries.slice";

export const useAttachments = (entryId: number) => {
  const dispatch = useAppDispatch();

  /**
   * Attachment rows are per-entry, so opening an entry has to load its own -
   * otherwise a file attachment reopened later has no filename to show.
   */
  const loadAttachments = useCallback(() => {
    dispatch(fetchAttachments(entryId));
  }, [dispatch, entryId]);

  const attach = useCallback(
    (sourcePath: string) => dispatch(addAttachment({ entryId, sourcePath })),
    [dispatch, entryId]
  );

  return { attach, loadAttachments };
};
