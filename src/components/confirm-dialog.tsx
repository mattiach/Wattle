import type { VariantProps } from "class-variance-authority";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  /** Content of the trigger, e.g. its icon or label. */
  children: ReactNode;
  confirmLabel: string;
  /**
   * How the confirming button is painted. Destructive by default, because most
   * things worth confirming take something away - but not all of them do, and a
   * red button in front of a harmless act teaches the reader to ignore red.
   */
  confirmVariant?: VariantProps<typeof buttonVariants>["variant"];
  description: string;
  onConfirm: () => void;
  title: string;
  /** The control that opens the dialog; rendered as the trigger itself. */
  trigger: ReactElement;
}

/**
 * In-app replacement for the native confirm dialog. Uncontrolled on purpose:
 * the trigger owns the open state, so callers keep no dialog state of their own.
 */
export const ConfirmDialog = ({
  children,
  confirmLabel,
  confirmVariant = "destructive",
  description,
  onConfirm,
  title,
  trigger,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t("cancel")}
          </DialogClose>
          <DialogClose
            render={<Button onClick={onConfirm} variant={confirmVariant} />}
          >
            {confirmLabel}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
