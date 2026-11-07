import type { Editor, Range } from "@tiptap/core";
import i18nextInstance from "i18next";
import {
  CheckSquare,
  Code,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Video,
} from "lucide-react";
import type { ComponentType } from "react";

export type AttachmentKind = "image" | "video" | "file";

export type SlashCommandCategory = "basic" | "lists" | "blocks" | "media";

export interface SlashCommandItem {
  action: (editor: Editor, range: Range) => void;
  category: SlashCommandCategory;
  description: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
  title: string;
}

const applyBlock = (
  editor: Editor,
  range: Range,
  run: (editor: Editor) => void
) => {
  editor.chain().focus().deleteRange(range).run();
  run(editor);
};

export const createSlashCommandItems = (
  onRequestAttachment: (kind: AttachmentKind) => void
): SlashCommandItem[] => {
  const t = i18nextInstance.t.bind(i18nextInstance);

  return [
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().setParagraph().run()),
      category: "basic",
      description: t("slash.text.description"),
      icon: Pilcrow,
      keywords: ["paragraph", "text", "testo"],
      title: t("slash.text.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) =>
          e.chain().toggleHeading({ level: 1 }).run()
        ),
      category: "basic",
      description: t("slash.heading1.description"),
      icon: Heading1,
      keywords: ["heading1", "h1", "title", "titolo"],
      title: t("slash.heading1.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) =>
          e.chain().toggleHeading({ level: 2 }).run()
        ),
      category: "basic",
      description: t("slash.heading2.description"),
      icon: Heading2,
      keywords: ["heading2", "h2", "subtitle", "sottotitolo"],
      title: t("slash.heading2.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) =>
          e.chain().toggleHeading({ level: 3 }).run()
        ),
      category: "basic",
      description: t("slash.heading3.description"),
      icon: Heading3,
      keywords: ["heading3", "h3"],
      title: t("slash.heading3.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().toggleBulletList().run()),
      category: "lists",
      description: t("slash.bulletList.description"),
      icon: List,
      keywords: ["bullet", "unordered", "ul", "elenco", "punti"],
      title: t("slash.bulletList.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().toggleOrderedList().run()),
      category: "lists",
      description: t("slash.orderedList.description"),
      icon: ListOrdered,
      keywords: ["numbered", "ordered", "ol", "numerato"],
      title: t("slash.orderedList.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().toggleTaskList().run()),
      category: "lists",
      description: t("slash.taskList.description"),
      icon: CheckSquare,
      keywords: ["todo", "task", "checkbox", "attività", "spunta"],
      title: t("slash.taskList.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().toggleBlockquote().run()),
      category: "blocks",
      description: t("slash.quote.description"),
      icon: Quote,
      keywords: ["blockquote", "citation", "citazione"],
      title: t("slash.quote.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().toggleCodeBlock().run()),
      category: "blocks",
      description: t("slash.code.description"),
      icon: Code,
      keywords: ["codeblock", "snippet", "pre", "codice"],
      title: t("slash.code.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, (e) => e.chain().setHorizontalRule().run()),
      category: "blocks",
      description: t("slash.divider.description"),
      icon: Minus,
      keywords: ["hr", "divider", "separator", "rule", "separatore", "linea"],
      title: t("slash.divider.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, () => onRequestAttachment("image")),
      category: "media",
      description: t("slash.image.description"),
      icon: Image,
      keywords: ["picture", "photo", "attachment", "immagine", "foto"],
      title: t("slash.image.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, () => onRequestAttachment("video")),
      category: "media",
      description: t("slash.video.description"),
      icon: Video,
      keywords: ["movie", "clip", "attachment", "filmato"],
      title: t("slash.video.title"),
    },
    {
      action: (editor, range) =>
        applyBlock(editor, range, () => onRequestAttachment("file")),
      category: "media",
      description: t("slash.file.description"),
      icon: FileUp,
      keywords: ["document", "pdf", "attachment", "documento", "allegato"],
      title: t("slash.file.title"),
    },
  ];
};

export const filterSlashCommandItems = (
  items: SlashCommandItem[],
  query: string
): SlashCommandItem[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === "") {
    return items;
  }
  return items.filter((item) => {
    const haystack = [item.title, ...item.keywords].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
};
