import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { exitSuggestion } from "@tiptap/suggestion";

import {
  createSlashCommandItems,
  filterSlashCommandItems,
} from "./slash-command-items";
import { SlashCommandMenu } from "./slash-command-menu";

import type { SlashCommandMenuHandle } from "./slash-command-menu";
import type { AttachmentKind, SlashCommandItem } from "./slash-command-items";

/**
 * The items this menu offers, over whichever document model it is used with.
 *
 * With no way to ask for a file, the three media items are not built at all
 * rather than built and hidden: a menu entry that inserts a node the schema
 * does not have is a crash waiting for someone to type a slash.
 */
const buildItems = (
  onRequestAttachment?: (kind: AttachmentKind) => void
): SlashCommandItem[] => {
  if (!onRequestAttachment) {
    return createSlashCommandItems(noAttachments).filter(
      (item) => item.category !== "media"
    );
  }
  return createSlashCommandItems(onRequestAttachment);
};

/** Never called: the items that would have called it are filtered out above. */
const noAttachments = (_kind: AttachmentKind): void => undefined;

/**
 * The slash menu, over whichever surface it is being used on.
 *
 * `onRequestAttachment` is absent only on a read-only editor, which has no
 * caret to insert anything at. Every writing surface - an entry, a spark, a
 * letter still in draft - passes one and gets the whole menu.
 */

export const createSlashCommandExtension = (
  onRequestAttachment?: (kind: AttachmentKind) => void
) =>
  Extension.create({
    addProseMirrorPlugins() {
      return [
        Suggestion({
          char: "/",
          command: ({ editor, range, props }) => {
            props.action(editor, range);
          },
          editor: this.editor,
          items: ({ query }) =>
            filterSlashCommandItems(buildItems(onRequestAttachment), query),
          render: () => {
            let component: ReactRenderer<SlashCommandMenuHandle> | null = null;
            let unmount: (() => void) | null = null;

            return {
              onExit: () => {
                unmount?.();
                component?.destroy();
                component = null;
                unmount = null;
              },
              onKeyDown: ({ view, event }) => {
                if (event.key === "Escape") {
                  exitSuggestion(view);
                  return true;
                }
                return component?.ref?.onKeyDown(event) ?? false;
              },
              onStart: (props) => {
                component = new ReactRenderer(SlashCommandMenu, {
                  editor: props.editor,
                  props,
                });
                unmount = props.mount(component.element);
              },
              onUpdate: (props) => {
                component?.updateProps(props);
              },
            };
          },
        }),
      ];
    },
    name: "slashCommand",
  });
