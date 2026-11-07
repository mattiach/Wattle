import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Segmented } from "@/components/ui/segmented";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  saveSettingsThunk,
  setEditorScale,
} from "@/redux/slices/settings/settings.slice";
import type { EditorScale } from "@/redux/slices/settings/settings.types";

import {
  EDITOR_SCALE_LABEL_KEYS,
  EDITOR_SCALE_SAMPLE_CLASSES,
  EDITOR_SCALES,
} from "./functions/editor-scale";

/**
 * The reading size, chosen from the sizes themselves.
 *
 * A list of names names the four; this shows them. Each segment is set in
 * Literata at the size it stands for, so the difference between "large" and
 * "largest" is the difference on the page rather than the difference between
 * two words - which is the one thing a reader looking for this setting is
 * trying to judge.
 *
 * Built on `Segmented` rather than on a group of its own: the toggle
 * semantics, the roving focus, the focus ring and the pressed treatment are
 * already there and already right, and a second implementation of them is a
 * second thing to keep accessible. Only the shape of a segment differs.
 *
 * **The only one of these there is.** Settings shows it outright; the entry
 * header puts it behind a button in `EditorScalePopover`, which renders this
 * and nothing else. There is one control, one list of sizes and one write.
 */
export const EditorScaleField = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const editorScale = useAppSelector((state) => state.settings.editorScale);

  const handleValueChange = useCallback(
    (next: EditorScale) => {
      dispatch(setEditorScale(next));
      dispatch(saveSettingsThunk());
    },
    [dispatch]
  );

  const options = EDITOR_SCALES.map((scale) => ({
    label: (
      <>
        <span
          aria-hidden="true"
          className={`editor-scale-sample ${EDITOR_SCALE_SAMPLE_CLASSES[scale]}`}
        >
          Aa
        </span>
        <span className="text-[0.65rem] leading-none">
          {t(EDITOR_SCALE_LABEL_KEYS[scale])}
        </span>
      </>
    ),
    value: scale,
  }));

  return (
    <Segmented<EditorScale>
      className="w-56 p-1 *:flex-1"
      itemClassName="h-auto flex-col justify-end gap-1.5 px-0 py-2"
      onValueChange={handleValueChange}
      options={options}
      value={editorScale}
    />
  );
};
