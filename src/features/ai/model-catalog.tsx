import { Check, Download, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface CatalogEntry {
  contextTokens: number;
  descriptionKey: string;
  displayName: string;
  downloadBytes: number;
  /** Whether this machine has the memory to run it comfortably. `null` means
   * Wattle could not tell, which is not the same as "no" and shows nothing. */
  fits: boolean | null;
  id: string;
  installed: boolean;
  pullCommand: string;
  recommended: boolean;
}

/**
 * One row of the list, whether Wattle ships the model or the reader installed
 * it themselves.
 *
 * Flattening the two into one shape is the point: "also installed" used to be
 * a paragraph of names with nothing to do about them, which is the worst place
 * to leave a reader - told what is on their disk and not offered the one
 * action they might want.
 */
interface ModelRow {
  description: string;
  displayName: string;
  /** Null for a model Wattle does not ship, whose size it does not know, and
   * whenever this machine's memory could not be read. */
  fits: boolean | null;
  id: string;
  installed: boolean;
  recommended: boolean;
  /** Absent for a model Wattle does not ship: its size is Ollama's to know. */
  sizeLabel: string | null;
  unmanaged: boolean;
}

interface Busy {
  id: string;
  kind: "installing" | "removing";
  percent: number;
}

interface ModelCatalogProps {
  activeModel: string;
  busy: Busy | null;
  /** False while the panel is setting the runtime up. Not tied to the runtime
   *  answering: asking for a model is what makes it answer. */
  canManage: boolean;
  catalog: CatalogEntry[];
  onCancelPull: () => void;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  unmanaged: string[];
}

/**
 * Every model, on one page, each in a card of its own.
 *
 * It used to be five rows at a time behind a pager, which was inherited from
 * the dialog this list lived in and made no sense once it stopped living
 * there: eight or nine models are a short list, and a pager turned reading
 * them into clicking through them - while holding itself disabled during a
 * download, so the one model that was doing something could be on a page the
 * reader was not allowed to leave.
 *
 * The paging also forced every row into a fixed height, which is what cut the
 * descriptions off mid-sentence. A row is now as tall as what it has to say,
 * and what it has to say is the whole sentence: these descriptions are how
 * someone chooses between six models, so truncating them removed the only
 * thing on the row that was load-bearing.
 */
export const ModelCatalog = ({
  activeModel,
  busy,
  catalog,
  canManage,
  onCancelPull,
  onInstall,
  onRemove,
}: // `unmanaged` is still passed and still typed: the rows it feeds are
// commented out below rather than gone, so it is left out of here only
// because nothing reads it while they are.
ModelCatalogProps) => {
  const { t } = useTranslation();

  const rows = useMemo<ModelRow[]>(
    () => [
      // The one Wattle picked for this machine leads the list. Judging it was
      // already done - in Rust, against the memory this computer actually has -
      // and leaving that answer in the middle of a column of eight made the
      // reader do the choosing anyway.
      ...[...catalog]
        .sort((a, b) => Number(b.recommended) - Number(a.recommended))
        .map((entry) => ({
          description: t(entry.descriptionKey),
          displayName: entry.displayName,
          fits: entry.fits,
          id: entry.id,
          installed: entry.installed,
          recommended: entry.recommended,
          sizeLabel: `${(entry.downloadBytes / BYTES_PER_GB).toFixed(1)} GB`,
          unmanaged: false,
        })),
      /*
        This will display unmanaged models. Keep it hidden for now
          ...unmanaged.map((id) => ({
          description: t("aiUnmanagedDescription"),
          displayName: id,
          // Its size is Ollama's to know, so there is nothing to judge.
          fits: null,
          id,
          installed: true,
          recommended: false,
          sizeLabel: null,
          unmanaged: true,
        })),
       */
    ],
    [catalog, t]
  );

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <ModelListRow
          activeModel={activeModel}
          busy={busy}
          canManage={canManage}
          key={row.id}
          onCancelPull={onCancelPull}
          onInstall={onInstall}
          onRemove={onRemove}
          row={row}
        />
      ))}
    </ul>
  );
};

interface ModelListRowProps {
  activeModel: string;
  busy: Busy | null;
  canManage: boolean;
  onCancelPull: () => void;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  row: ModelRow;
}

const ModelListRow = ({
  activeModel,
  busy,
  canManage,
  onCancelPull,
  onInstall,
  onRemove,
  row,
}: ModelListRowProps) => {
  const { t } = useTranslation();
  const isBusy = busy?.id === row.id;
  const isActive = activeModel === row.id;

  const install = () => onInstall(row.id);
  const remove = () => onRemove(row.id);

  return (
    <li
      className={cn(
        "rounded-lg border border-hairline px-4 py-3.5 duration-150",
        // Two rows are worth finding without reading: the one in use, and -
        // until something is in use - the one this machine was measured for.
        isActive && "border-wattle/40 bg-wattle/[0.07]",
        row.recommended && !isActive && "border-assist/45 bg-assist/6",
        !(isActive || row.installed || row.recommended) && "bg-background/40"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body-sm text-foreground leading-tight">
            <span className="truncate font-medium">{row.displayName}</span>
            {row.sizeLabel ? (
              <span className="text-meta text-muted-foreground tabular-nums">
                {row.sizeLabel}
              </span>
            ) : null}
            {row.recommended ? (
              <Badge tone="assist">
                <Sparkles className="size-3" />
                {t("aiRecommended")}
              </Badge>
            ) : null}
            {row.unmanaged ? (
              <Badge tone="muted">{t("aiUnmanaged")}</Badge>
            ) : null}
            {/* Only ever a warning. The install button below is untouched by
                it, and `null` - a machine Wattle could not read - shows nothing
                at all rather than guessing. */}
            {row.fits === false ? (
              <Badge title={t("aiMayNotFitHint")} tone="muted">
                {t("aiMayNotFit")}
              </Badge>
            ) : null}
            {isActive ? (
              <Badge tone="wattle">
                <Check className="size-3" />
                {t("aiActive")}
              </Badge>
            ) : null}
          </p>
          {/* Said in words as well as in colour: a badge reading "Recommended"
              does not say recommended *for what*, and the answer - this
              computer's own memory - is the whole reason the row is first. */}
          {row.recommended ? (
            <p className="mt-1.5 text-assist-ink text-sm leading-relaxed">
              {t("aiRecommendedHint")}
            </p>
          ) : null}
          {/* Whole, and wrapping. This sentence is how a reader chooses. */}
          <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
            {row.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isBusy ? (
            <Button
              onClick={onCancelPull}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("cancel")}
            </Button>
          ) : (
            <ModelAction
              // Models can only be managed by an Ollama that is answering, and
              // never while another row is mid-operation.
              disabled={!canManage || busy !== null}
              displayName={row.displayName}
              installed={row.installed}
              onInstall={install}
              onRemove={remove}
            />
          )}
        </div>
      </div>

      {/* A determinate bar, because a pull reports real byte counts. Under the
          whole row rather than beside the text: a download is the row's state,
          not one more thing in its description. */}
      {isBusy && busy?.kind === "installing" ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-assist transition-[width] duration-200 ease-out-soft"
              style={{ width: `${busy.percent}%` }}
            />
          </div>
          <span className="shrink-0 text-meta text-muted-foreground tabular-nums">
            {t("aiInstalling", { percent: busy.percent })}
          </span>
        </div>
      ) : null}
    </li>
  );
};

const BADGE_TONES = {
  assist: "bg-assist/15 font-medium text-assist-ink",
  muted: "bg-muted text-muted-foreground",
  wattle: "bg-wattle/20 text-foreground",
} as const;

const Badge = ({
  children,
  title,
  tone,
}: {
  children: React.ReactNode;
  /** The longer sentence behind a terse label, where there is one. */
  title?: string;
  tone: keyof typeof BADGE_TONES;
}) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] leading-none",
      BADGE_TONES[tone]
    )}
    title={title}
  >
    {children}
  </span>
);

interface ModelActionProps {
  disabled: boolean;
  displayName: string;
  installed: boolean;
  onInstall: () => void;
  onRemove: () => void;
}

/** Install, or remove behind a confirmation. Never both, never automatic. */
const ModelAction = ({
  disabled,
  displayName,
  installed,
  onInstall,
  onRemove,
}: ModelActionProps) => {
  const { t } = useTranslation();

  if (!installed) {
    return (
      <Button
        disabled={disabled}
        onClick={onInstall}
        size="sm"
        type="button"
        variant="outline"
      >
        <Download />
        {t("aiInstall")}
      </Button>
    );
  }

  return (
    <ConfirmDialog
      confirmLabel={t("aiRemove")}
      description={t("aiRemoveConfirm", { name: displayName })}
      onConfirm={onRemove}
      title={t("aiRemove")}
      trigger={<Button disabled={disabled} size="sm" variant="destructive" />}
    >
      {t("aiRemove")}
    </ConfirmDialog>
  );
};
