import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/redux/hooks";
import { AiRewritePopover } from "./ai-rewrite-popover";
import { TEXT_ALIGNMENTS } from "./interfaces/text-align";

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { ChangeEvent, ComponentType, FormEvent } from "react";
import type { RewriteSelection } from "./ai-rewrite-popover";
import type { TextAlignment } from "./interfaces/text-align";

interface EditorBubbleMenuProps {
  editor: TiptapEditor;
}

const menuClassName =
  "flex items-center gap-0.5 rounded-xl bg-popover p-2 shadow-float duration-150 animate-in fade-in zoom-in-95 z-100";

interface MarkButtonProps {
  icon: ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  onClick: () => void;
}

const MarkButton = ({
  icon: Icon,
  isActive,
  label,
  onClick,
}: MarkButtonProps) => (
  <Button
    aria-label={label}
    aria-pressed={isActive}
    className={isActive ? "text-wattle-ink" : "text-muted-foreground"}
    onClick={onClick}
    size="icon-sm"
    variant="ghost"
  >
    <Icon />
  </Button>
);

export const EditorBubbleMenu = ({ editor }: EditorBubbleMenuProps) => {
  const { t } = useTranslation();
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [rewriting, setRewriting] = useState<RewriteSelection | null>(null);

  // The button does not exist unless there is something behind it: assistance
  // on, and a model actually chosen. With either missing the rewrite path is
  // unreachable from the interface as well as refused in Rust.
  const canRewrite = useAppSelector(
    (state) => state.settings.aiEnabled && state.settings.aiModel !== ""
  );

  // Captured now, while the selection is still the one the writer made.
  const startRewrite = useCallback(() => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (text.trim() === "") {
      return;
    }
    setRewriting({ from, text, to });
  }, [editor]);

  // Mod+J asks for a rewrite of whatever is selected. Free in both StarterKit
  // and the slash menu's own Arrow/Enter/Tab handling, so nothing is taken
  // away from the editor to add it - and it does nothing at all while
  // assistance is off.
  useEffect(() => {
    if (!canRewrite) {
      return;
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        startRewrite();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [canRewrite, startRewrite]);

  const stopRewriting = () => setRewriting(null);

  const toggleBold = () => editor.chain().focus().toggleBold().run();
  const toggleItalic = () => editor.chain().focus().toggleItalic().run();
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run();
  const toggleStrike = () => editor.chain().focus().toggleStrike().run();
  const toggleCode = () => editor.chain().focus().toggleCode().run();
  const toggleHeading1 = () =>
    editor.chain().focus().toggleHeading({ level: 1 }).run();
  const toggleHeading2 = () =>
    editor.chain().focus().toggleHeading({ level: 2 }).run();

  // Alignment is a node attribute, so it is written straight onto whichever of
  // the alignable block types the selection sits in - a picture and a clip
  // among them, which is why aligning either needs no control of its own.
  const setAlignment = (alignment: TextAlignment) => {
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", { textAlign: alignment })
      .updateAttributes("heading", { textAlign: alignment })
      .updateAttributes("imageAttachment", { textAlign: alignment })
      .updateAttributes("videoAttachment", { textAlign: alignment })
      .run();
  };

  const alignLeft = () => setAlignment("left");
  const alignCenter = () => setAlignment("center");
  const alignRight = () => setAlignment("right");

  const currentAlign =
    editor.getAttributes("imageAttachment").textAlign ??
    editor.getAttributes("videoAttachment").textAlign ??
    editor.getAttributes("paragraph").textAlign ??
    editor.getAttributes("heading").textAlign;
  // Blocks start with no alignment set, which renders as left.
  const activeAlignment =
    TEXT_ALIGNMENTS.find((alignment) => alignment === currentAlign) ?? "left";

  const startEditingLink = () => {
    setLinkValue(
      (editor.getAttributes("link").href as string | undefined) ?? ""
    );
    setIsEditingLink(true);
  };

  const handleLinkValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    setLinkValue(event.target.value);
  };

  const focusLinkField = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  const handleLinkSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (linkValue === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkValue })
        .run();
    }
    setIsEditingLink(false);
  };

  if (rewriting) {
    return (
      <BubbleMenu className={menuClassName} editor={editor}>
        <AiRewritePopover
          editor={editor}
          onClose={stopRewriting}
          selection={rewriting}
        />
      </BubbleMenu>
    );
  }

  if (isEditingLink) {
    return (
      <BubbleMenu className={menuClassName} editor={editor}>
        <form className="flex items-center gap-1" onSubmit={handleLinkSubmit}>
          <input
            className="w-56 bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-placeholder"
            onChange={handleLinkValueChange}
            placeholder="https://…"
            ref={focusLinkField}
            value={linkValue}
          />
          <Button size="icon-sm" type="submit" variant="ghost">
            <Check />
          </Button>
        </form>
      </BubbleMenu>
    );
  }

  return (
    <BubbleMenu className={menuClassName} editor={editor}>
      <MarkButton
        icon={Bold}
        isActive={editor.isActive("bold")}
        label={t("bold")}
        onClick={toggleBold}
      />
      <MarkButton
        icon={Italic}
        isActive={editor.isActive("italic")}
        label={t("italic")}
        onClick={toggleItalic}
      />
      <MarkButton
        icon={UnderlineIcon}
        isActive={editor.isActive("underline")}
        label={t("underline")}
        onClick={toggleUnderline}
      />
      <MarkButton
        icon={Strikethrough}
        isActive={editor.isActive("strike")}
        label={t("strikethrough")}
        onClick={toggleStrike}
      />
      <MarkButton
        icon={Code}
        isActive={editor.isActive("code")}
        label={t("code")}
        onClick={toggleCode}
      />
      <span className="mx-0.5 h-5 w-px bg-hairline" />
      <MarkButton
        icon={Heading1}
        isActive={editor.isActive("heading", { level: 1 })}
        label={t("heading1")}
        onClick={toggleHeading1}
      />
      <MarkButton
        icon={Heading2}
        isActive={editor.isActive("heading", { level: 2 })}
        label={t("heading2")}
        onClick={toggleHeading2}
      />
      <span className="mx-0.5 h-5 w-px bg-hairline" />
      <MarkButton
        icon={AlignLeft}
        isActive={activeAlignment === "left"}
        label={t("alignLeft")}
        onClick={alignLeft}
      />
      <MarkButton
        icon={AlignCenter}
        isActive={activeAlignment === "center"}
        label={t("alignCenter")}
        onClick={alignCenter}
      />
      <MarkButton
        icon={AlignRight}
        isActive={activeAlignment === "right"}
        label={t("alignRight")}
        onClick={alignRight}
      />
      <span className="mx-0.5 h-5 w-px bg-hairline" />
      <MarkButton
        icon={LinkIcon}
        isActive={editor.isActive("link")}
        label={t("link")}
        onClick={startEditingLink}
      />
      {canRewrite ? (
        <>
          <span className="mx-0.5 h-5 w-px bg-hairline" />
          {/* The one control in this bar that is not the journal talking, so
              it is the one control that does not wear the journal's accent. */}
          <Button
            aria-keyshortcuts="Control+J"
            aria-label={t("aiRewrite")}
            className="text-assist-ink"
            onClick={startRewrite}
            size="icon-sm"
            variant="ghost"
          >
            <Sparkles />
          </Button>
        </>
      ) : null}
    </BubbleMenu>
  );
};
