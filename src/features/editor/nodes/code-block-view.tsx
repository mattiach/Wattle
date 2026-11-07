import type { NodeViewProps } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CODE_LANGUAGES, NO_LANGUAGE } from "./code-languages";

interface CodeBlockAttrs {
  language: string | null;
}

/**
 * A code block that says what it is.
 *
 * The `language` attribute has been in the document all along - `content.rs`
 * has always written it into the Markdown fence and the exported
 * `class="language-…"` - but nothing in the interface ever set it, so it was
 * always empty and the block was always grey. This is the control that fills
 * it, and the colour follows from it.
 *
 * Auto-detection is left on for a block nobody labels, so pasting a snippet
 * still colours; choosing a language is how you correct it when the guess is
 * wrong. That is the only reason the picker exists - it is not a setting.
 *
 * The picker sits where the ✕ on an attachment sits, and appears when that ✕
 * appears. Editor chrome that reveals itself under different rules in different
 * places reads as several editors.
 */
export const CodeBlockView = ({ node, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const { language } = node.attrs as CodeBlockAttrs;
  const current = language ?? NO_LANGUAGE;
  const label =
    CODE_LANGUAGES.find((entry) => entry.id === current)?.label ??
    t("codeLanguagePlain");

  const handleChange = (value: unknown) => {
    updateAttributes({
      language: value === NO_LANGUAGE ? null : (value as string),
    });
  };

  return (
    <NodeViewWrapper as="div" className="group relative">
      {/* `contentEditable={false}` is not optional inside a node view: without
          it ProseMirror treats the menu as part of the document and tries to
          put a caret in it. */}
      <div
        className="absolute top-2 right-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100"
        contentEditable={false}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t("codeLanguage")}
                className="h-7 bg-background/85 px-2 font-sans text-muted-foreground text-xs backdrop-blur-sm hover:text-foreground"
                type="button"
                variant="ghost"
              />
            }
          >
            {label}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <DropdownMenuRadioGroup
              onValueChange={handleChange}
              value={current}
            >
              <DropdownMenuRadioItem value={NO_LANGUAGE}>
                {t("codeLanguagePlain")}
              </DropdownMenuRadioItem>
              {CODE_LANGUAGES.map((entry) => (
                <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                  {entry.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
};
