import type { Extensions } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { CodeBlockView } from "../nodes/code-block-view";
import { lowlight } from "../nodes/code-languages";
import { FileAttachment } from "../nodes/file-attachment-node";
import { ImageAttachment } from "../nodes/image-attachment-node";
import { VideoAttachment } from "../nodes/video-attachment-node";
import { TextAlign } from "./text-align-extension";

/**
 * The plain code block StarterKit ships, swapped for the one that colours.
 *
 * Same node, same name, same `language` attribute, so nothing already written
 * has to be migrated and both exporters keep working untouched - the only
 * difference is that the text now arrives with a grammar applied to it, and
 * that a writer can say which grammar.
 */
const CodeBlock = CodeBlockLowlight.configure({ lowlight }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

export const createEditorExtensions = (placeholder: string): Extensions => [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false },
  }),
  CodeBlock,
  TaskList,
  TaskItem.configure({ nested: true }),
  TextAlign,
  Placeholder.configure({ placeholder }),
  ImageAttachment,
  VideoAttachment,
  FileAttachment,
];
