import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { SettingsSection } from "@/components/layout/settings-section";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuFieldTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { AiPanel } from "@/features/ai/ai-panel";
import { EditorScaleField } from "@/features/editor/editor-scale-field";
import { exportJournal } from "@/features/entries/functions/export";
import { useLanguage } from "@/languages/language-provider";
import {
  LANGUAGE_CODES,
  LANGUAGE_LABELS,
  LanguageFlag,
} from "@/languages/languages";
import { useNameField } from "@/hooks/use-name-field";
import { runBackup, runRestore } from "@/lib/backup";
import { journalDir, moveJournalDir } from "@/lib/journal-dir";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
} from "@/redux/slices/profile/profile.data";
import {
  resetSettings,
  resetTours,
  saveSettingsThunk,
  setEntryLock,
  setLayoutWidth,
  setNavigation,
  setOnThisDay,
  setPalette,
  setSparkEcho,
} from "@/redux/slices/settings/settings.slice";
import type { Settings } from "@/redux/slices/settings/settings.types";
import { paths } from "@/routing/paths";
import { knownPalette, PALETTES, provisionalName } from "@/theme/palettes";
import { useTheme } from "@/theme/theme-provider";

/** A boolean, spelled as a choice so it matches the other settings controls. */
type ToggleChoice = "on" | "off";

/**
 * Every control in this page is the same box, so the column lines up.
 *
 * Not just the pickers: a row of buttons each as wide as its own label made
 * the right edge of the page a ragged line, and a settings page is read down
 * that edge. Buttons take `size="lg"` alongside it, which is the 36px the
 * pickers and the name field already stand at.
 */
const CONTROL_WIDTH = "w-44";

/**
 * The segmented control, stretched into the same box: the group fills the
 * width and its two halves split it, rather than shrinking to "On"/"Off".
 *
 * `p-1` rather than a height: the padding is on the group itself, so
 * `tailwind-merge` resolves it against the component's own `p-0.5` and the
 * 28px segments inside add up to the same 36px the pickers stand at - no
 * cascade race with the segment's own height.
 */
const SEGMENTED_CONTROL = `${CONTROL_WIDTH} p-1 *:flex-1`;

type BackupStatus = "idle" | "success" | "error";
type RestoreStatus = "idle" | "restoring" | "error";
/** What the "back up now" button inside the new-profile dialog last did. */
type BackupNowState = "idle" | "working" | "saved" | "failed";

/**
 * The "why", one step behind the label.
 *
 * A row says what a setting does in a line; some of them also have a *how*
 * worth knowing - what the echo actually picks, what a backup does and does
 * not carry - and that belongs behind a deliberate hover, not in a paragraph
 * every reader has to scroll past.
 */
const SettingsHint = ({ hint, label }: { hint: string; label: string }) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          aria-label={label}
          className="rounded-full text-faint outline-none duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          type="button"
        />
      }
    >
      <Info className="size-3.5" />
    </TooltipTrigger>
    <TooltipContent className="max-w-72 leading-relaxed">{hint}</TooltipContent>
  </Tooltip>
);

/**
 * A palette, as itself.
 *
 * The dots carry `data-wattle-palette` and paint with the ordinary utilities,
 * so they are coloured by the very rule the application uses rather than by a
 * copy of the values - a preview here cannot drift from the result. It is also
 * why the blocks in `globals.css` are not `:root`-scoped.
 *
 * Four dots, in the order the eye meets them on a page: the paper, a card on
 * it, the ink, and the accent.
 */
const PALETTE_TONES = [
  "bg-background",
  "bg-card",
  "bg-foreground",
  "bg-wattle",
];

const PaletteDots = ({ palette }: { palette: Settings["palette"] }) => (
  <span
    className="flex shrink-0 items-center -space-x-1"
    data-wattle-palette={palette}
  >
    {PALETTE_TONES.map((tone) => (
      <span
        className={cn("size-3.5 rounded-full ring-1 ring-foreground/15", tone)}
        key={tone}
      />
    ))}
  </span>
);

interface PalettePickerProps {
  onChange: (palette: Settings["palette"]) => void;
  value: Settings["palette"];
}

/** A menu rather than a row of swatches: each theme is named as well as shown. */
const PalettePicker = ({ onChange, value }: PalettePickerProps) => {
  const { t } = useTranslation();
  // A name in the database that no longer answers to anything is not the
  // picker's to display: the stylesheet already falls back to the default, and
  // this is what makes the control agree with the screen.
  const chosen = knownPalette(value);

  const handleValueChange = (next: unknown) => {
    onChange(next as Settings["palette"]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuFieldTrigger className={CONTROL_WIDTH} size="sm">
        <span className="flex min-w-0 items-center gap-2">
          <PaletteDots palette={chosen} />
          <span className="truncate">
            {t(`paletteName.${chosen}`, {
              defaultValue: provisionalName(chosen),
            })}
          </span>
        </span>
      </DropdownMenuFieldTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          onValueChange={handleValueChange}
          value={chosen}
        >
          {PALETTES.map((palette) => (
            <DropdownMenuRadioItem key={palette} value={palette}>
              <PaletteDots palette={palette} />
              {t(`paletteName.${palette}`, {
                defaultValue: provisionalName(palette),
              })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface SettingsRowProps {
  control: ReactNode;
  description?: string;
  /** Replaces the description while the value is not acceptable. */
  error?: string;
  /** Extra explanation, shown behind an info control rather than inline. */
  hint?: string;
  label: string;
}

const SettingsRow = ({
  control,
  description,
  error,
  hint,
  label,
}: SettingsRowProps) => (
  <div className="flex items-center justify-between gap-6 px-5 py-4">
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-body-sm text-foreground leading-tight">{label}</p>
        {hint ? <SettingsHint hint={hint} label={label} /> : null}
      </div>
      {error || description ? (
        <p
          className={cn(
            "mt-1 text-sm leading-snug",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? description}
        </p>
      ) : null}
    </div>
    <div className="shrink-0">{control}</div>
  </div>
);

interface NewProfileDialogProps {
  backupDir: string;
  disabled: boolean;
  onConfirm: () => void;
}

/**
 * The gate in front of emptying a journal.
 *
 * Not `ConfirmDialog`: that one is uncontrolled by design - the trigger owns the
 * open state - and this needs two stages and a state of its own. Widening a
 * shared component used by three other callers, for this one, would be the
 * worse trade, so it is built from the same primitives instead.
 *
 * The first stage exists only when no backup folder has been configured. Wattle
 * then has no reason to believe a backup of this journal exists anywhere, and
 * says so before showing the button that deletes it. With a folder set the
 * dialog opens at the confirmation - but still offers to take a backup now,
 * because knowing *where* backups go is not the same as having one.
 */
const NewProfileDialog = ({
  backupDir,
  disabled,
  onConfirm,
}: NewProfileDialogProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<"warn" | "confirm">("confirm");
  const [backupState, setBackupState] = useState<BackupNowState>("idle");

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // No configured folder is the case that has to be said out loud first.
      setStage(backupDir ? "confirm" : "warn");
      setBackupState("idle");
    }
    setIsOpen(next);
  };

  const handleContinueAnyway = () => setStage("confirm");

  const handleBackupNow = async () => {
    setBackupState("working");
    // The same `runBackup` the Data section uses, and it asks where to save
    // here too. This copy is the one thing standing between the reader and an
    // emptied journal, so the one moment worth being certain it landed
    // somewhere deliberate is this one.
    const outcome = await runBackup(backupDir);
    if (outcome === "cancelled") {
      setBackupState("idle");
      return;
    }
    // A backup that did not happen must never advance the flow: that would be
    // the reassurance without the safety.
    if (outcome === "failed") {
      setBackupState("failed");
      return;
    }
    setBackupState("saved");
    if (stage === "warn") {
      setStage("confirm");
    }
  };

  const handleConfirm = () => {
    setIsOpen(false);
    onConfirm();
  };

  const isWarning = stage === "warn";

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogTrigger
        render={
          <Button
            className={CONTROL_WIDTH}
            disabled={disabled}
            size="lg"
            type="button"
            variant="destructive"
          />
        }
      >
        {t("newProfileAction")}
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {isWarning
              ? t("newProfileNoBackupTitle")
              : t("newProfileConfirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {isWarning
              ? t("newProfileNoBackupBody")
              : t("newProfileConfirmBody")}
          </DialogDescription>
          {backupDir && !isWarning ? (
            <p className="text-muted-foreground text-sm leading-snug">
              {t("newProfileBackupFolder", { folder: backupDir })}
            </p>
          ) : null}
          {backupState === "failed" || backupState === "saved" ? (
            <p
              aria-live="polite"
              className={cn(
                "text-sm leading-snug",
                backupState === "failed"
                  ? "text-destructive"
                  : "text-wattle-ink"
              )}
            >
              {backupState === "failed"
                ? t("backupError")
                : t("newProfileBackupSaved")}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t("cancel")}
          </DialogClose>
          <Button
            disabled={backupState === "working"}
            onClick={handleBackupNow}
            type="button"
            variant="outline"
          >
            {backupState === "working"
              ? t("newProfileBackingUp")
              : t("newProfileBackupNow")}
          </Button>
          {isWarning ? (
            // Least prominent of the three, deliberately: it is the one that
            // walks past the warning.
            <Button
              onClick={handleContinueAnyway}
              type="button"
              variant="ghost"
            >
              {t("newProfileContinueAnyway")}
            </Button>
          ) : (
            <Button onClick={handleConfirm} type="button" variant="destructive">
              {t("newProfileConfirmAction")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const SettingsPage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const navigation = useAppSelector((state) => state.settings.navigation);
  const palette = useAppSelector((state) => state.settings.palette);
  const layoutWidth = useAppSelector((state) => state.settings.layoutWidth);
  const entryLock = useAppSelector((state) => state.settings.entryLock);
  const onThisDay = useAppSelector((state) => state.settings.onThisDay);
  const sparkEcho = useAppSelector((state) => state.settings.sparkEcho);
  // The AI screen owns the download; this page only has to know one is running,
  // because emptying a journal while gigabytes are arriving is not a moment to
  // hand someone a button for. Session-only state, never saved.
  const aiPulling = useAppSelector((state) => state.settings.aiPulling);
  const backupDir = useAppSelector((state) => state.settings.backupDir);
  const { setTheme, theme } = useTheme();
  const { language, setLanguage } = useLanguage();

  // Base UI hands back `null` for a cleared select; this one is never clearable.
  const handleNavigationChange = (value: Settings["navigation"] | null) => {
    if (!value) {
      return;
    }
    dispatch(setNavigation(value));
    dispatch(saveSettingsThunk());
  };

  // Base UI hands back `null` for a cleared select; this one is never clearable.
  const handleLanguageChange = (value: Settings["language"] | null) => {
    if (value) {
      setLanguage(value);
    }
  };

  // Base UI hands back `null` for a cleared select; this one is never clearable.
  const handleLayoutWidthChange = (value: Settings["layoutWidth"] | null) => {
    if (!value) {
      return;
    }
    dispatch(setLayoutWidth(value));
    dispatch(saveSettingsThunk());
  };

  const handlePaletteChange = (value: Settings["palette"]) => {
    dispatch(setPalette(value));
    dispatch(saveSettingsThunk());
  };

  const handleEntryLockChange = (value: ToggleChoice) => {
    dispatch(setEntryLock(value === "on"));
    dispatch(saveSettingsThunk());
  };

  const handleOnThisDayChange = (value: ToggleChoice) => {
    dispatch(setOnThisDay(value === "on"));
    dispatch(saveSettingsThunk());
  };

  // Its own switch, deliberately: turning off memories must not silence the
  // echo, and turning off the echo must not silence memories.
  const handleSparkEchoChange = (value: ToggleChoice) => {
    dispatch(setSparkEcho(value === "on"));
    dispatch(saveSettingsThunk());
  };

  const navigationLabels: Record<Settings["navigation"], string> = {
    both: t("navigationBoth"),
    bottom: t("navigationBottom"),
    header: t("navigationHeader"),
  };

  const layoutWidthLabels: Record<Settings["layoutWidth"], string> = {
    compact: t("layoutWidthCompact"),
    default: t("layoutWidthDefault"),
    wide: t("layoutWidthWide"),
  };

  const [backupStatus, setBackupStatus] = useState<BackupStatus>("idle");
  const [newProfileFailed, setNewProfileFailed] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>("idle");

  // The same field onboarding asks for, with the same bounds and the same
  // refusal. Emptying it is allowed as an edit and never as a saved name: the
  // row goes red and `commit` declines, so leaving this page keeps the name
  // that was last accepted.
  const nameField = useNameField();

  const handleReset = () => {
    dispatch(resetSettings());
    dispatch(saveSettingsThunk());
  };

  // Straight to the home screen, because a tour is only ever offered by the
  // page it belongs to - staying here would show the settings tour and nothing
  // else, which is not what "show me the tour again" asks for.
  const handleReplayTours = () => {
    dispatch(resetTours());
    dispatch(saveSettingsThunk());
    navigate(paths.app.path);
  };

  // Reload rather than unpicking the store by hand - the same move `restore`
  // makes, and for the same reason: every slice has to come back from what is
  // now on disk. `hydrateStore` then reads `onboarded === false` and the
  // first-run flow takes over.
  const handleNewProfile = async () => {
    try {
      await invoke("reset_profile");
      window.location.reload();
    } catch {
      setNewProfileFailed(true);
    }
  };

  const handleExportHtml = () => exportJournal();

  // Rust refuses to export a journal with nothing in it, so the button says so
  // before it is pressed rather than after. Counted here rather than read off
  // `entries.list`, which holds whatever the last browse or search loaded and
  // is empty on this page for reasons that have nothing to do with the journal.
  // The same count `export_journal_html` itself takes: every kind, no filter.
  const [hasEntries, setHasEntries] = useState(true);

  useEffect(() => {
    let cancelled = false;
    invoke<number>("count_entries", { kind: "", query: "" })
      .then((written) => {
        if (!cancelled) {
          setHasEntries(written > 0);
        }
      })
      // A count that will not come back is not a reason to lock the export:
      // let it run and report whatever Rust says.
      .catch(() => {
        if (!cancelled) {
          setHasEntries(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Where the journal is, read from Rust rather than assembled here: it is
  // movable, and only Rust knows where it ended up.
  const [journalPath, setJournalPath] = useState("");
  const [journalFailed, setJournalFailed] = useState(false);

  useEffect(() => {
    journalDir()
      .then(setJournalPath)
      .catch(() => setJournalPath(""));
  }, []);

  // Confirmed before the picker opens, the same way restoring is: the dialog is
  // uncontrolled, so by the time this runs the answer is already yes and
  // choosing the folder is the only thing left.
  //
  // And it ends the same way a restore does, for the same reason: the journal
  // under the application is now a different one on disk, so the window is
  // reloaded rather than each slice being talked back into agreement. A failure
  // means nothing was touched and the journal is still open where it was.
  const handleMoveJournal = async () => {
    const chosen = await open({
      defaultPath: journalPath || undefined,
      directory: true,
    });
    if (typeof chosen !== "string") {
      return;
    }
    setJournalFailed(false);
    try {
      await moveJournalDir(chosen);
    } catch {
      setJournalFailed(true);
      return;
    }
    window.location.reload();
  };

  const handleBackup = async () => {
    const outcome = await runBackup(backupDir);
    if (outcome === "cancelled") {
      return;
    }
    setBackupStatus(outcome === "saved" ? "success" : "error");
  };

  const getBackupDescription = () => {
    if (backupStatus === "error") {
      return t("backupError");
    }
    if (backupStatus === "success") {
      return t("backupSuccess");
    }
    return t("backupDescription");
  };

  // Confirmed before it runs, in the app's own dialog: `ConfirmDialog` wraps
  // the trigger, so by the time this is called the answer is already yes and
  // the file picker is the only thing left to show.
  const handleRestore = async () => {
    const outcome = await runRestore();
    if (outcome === "cancelled") {
      return;
    }
    if (outcome === "failed") {
      setRestoreStatus("error");
      return;
    }
    setRestoreStatus("restoring");
    window.location.reload();
  };

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <PageHeader description={t("settingsSubtitle")} title={t("settings")} />

      <PageIntro className="mt-8 flex flex-col gap-10" delay={0.05}>
        <SettingsSection
          title={t("profileSection")}
          tourStepId="settings-profile"
        >
          <SettingsRow
            control={
              <Input
                aria-invalid={Boolean(nameField.error)}
                aria-label={t("name")}
                className={cn("h-9", CONTROL_WIDTH)}
                maxLength={nameField.maxLength}
                onBlur={nameField.commit}
                onChange={nameField.onChange}
                placeholder={t("namePlaceholder")}
                value={nameField.value}
              />
            }
            description={t("nameDescription", {
              max: NAME_MAX_LENGTH,
              min: NAME_MIN_LENGTH,
            })}
            error={nameField.error}
            hint={t("nameHint")}
            label={t("name")}
          />
        </SettingsSection>

        <SettingsSection
          title={t("appearanceSection")}
          tourStepId="settings-appearance"
        >
          {/* First in the section, and the reason the row under it is named
              what it is: this is the whole surface, that is which of its two
              faces you are reading. */}
          <SettingsRow
            control={
              <PalettePicker onChange={handlePaletteChange} value={palette} />
            }
            description={t("paletteDescription")}
            hint={t("paletteHint")}
            label={t("palette")}
          />
          <SettingsRow
            control={
              <Segmented<Settings["theme"]>
                className={SEGMENTED_CONTROL}
                onValueChange={setTheme}
                options={[
                  { label: t("light"), value: "light" },
                  { label: t("dark"), value: "dark" },
                ]}
                value={theme}
              />
            }
            description={t("themeDescription")}
            hint={t("themeHint")}
            label={t("theme")}
          />
          <SettingsRow
            control={
              <Select
                items={navigationLabels}
                onValueChange={handleNavigationChange}
                value={navigation}
              >
                <SelectTrigger className={CONTROL_WIDTH} size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom">
                    {navigationLabels.bottom}
                  </SelectItem>
                  <SelectItem value="header">
                    {navigationLabels.header}
                  </SelectItem>
                  <SelectItem value="both">{navigationLabels.both}</SelectItem>
                </SelectContent>
              </Select>
            }
            description={t("navigationDescription")}
            hint={t("navigationHint")}
            label={t("navigation")}
          />
          {/* A select rather than segments: three options of uneven length made
              this the one control in the column that did not line up, and the
              widths are a list that can grow. */}
          <SettingsRow
            control={
              <Select
                items={layoutWidthLabels}
                onValueChange={handleLayoutWidthChange}
                value={layoutWidth}
              >
                <SelectTrigger className={CONTROL_WIDTH} size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">
                    {layoutWidthLabels.compact}
                  </SelectItem>
                  <SelectItem value="default">
                    {layoutWidthLabels.default}
                  </SelectItem>
                  <SelectItem value="wide">{layoutWidthLabels.wide}</SelectItem>
                </SelectContent>
              </Select>
            }
            description={t("layoutWidthDescription")}
            hint={t("layoutWidthHint")}
            label={t("layoutWidth")}
          />
          {/* A select rather than a pair of segments: the catalogue grows, and
              a segmented control stops working the moment there are more than
              a handful of languages. */}
          <SettingsRow
            control={
              <Select
                items={LANGUAGE_LABELS}
                onValueChange={handleLanguageChange}
                value={language}
              >
                <SelectTrigger className={CONTROL_WIDTH} size="sm">
                  {/* Beside the value rather than inside it: `SelectValue`
                      renders a label from `items`, and a flag is not one. */}
                  <LanguageFlag code={language} />
                  <SelectValue />
                </SelectTrigger>
                {/* The one list here long enough to fill the window: capped so
                    it stays a menu and scrolls, rather than becoming a column
                    the length of the screen. Opaque rather than the usual
                    glass, because the page showing through a list that is
                    being scrolled reads as a smear - which is also why the
                    scroll arrows have always painted `bg-popover`. */}
                <SelectContent className="max-h-64 bg-popover">
                  {LANGUAGE_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      <LanguageFlag code={code} />
                      {LANGUAGE_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            description={t("languageDescription")}
            hint={t("languageHint")}
            label={t("language")}
          />
        </SettingsSection>

        <SettingsSection
          description={t("writingSectionDescription")}
          title={t("writingSection")}
        >
          <SettingsRow
            control={
              <Segmented<ToggleChoice>
                className={SEGMENTED_CONTROL}
                onValueChange={handleEntryLockChange}
                options={[
                  { label: t("on"), value: "on" },
                  { label: t("off"), value: "off" },
                ]}
                value={entryLock ? "on" : "off"}
              />
            }
            description={t("entryLockDescription")}
            hint={t("entryLockHint")}
            label={t("entryLock")}
          />
          {/* The same setting the entry header carries, shown here as the four
              sizes themselves rather than as their names. One setting, offered
              where it is noticed and where it is looked for. */}
          <SettingsRow
            control={<EditorScaleField />}
            description={t("editorScaleDescription")}
            hint={t("editorScaleHint")}
            label={t("editorScale")}
          />
          {/* Last in the section, because it is about writing that is no longer
              here. Not in Data: a backup is a copy of the journal, and this is
              the journal - the pages in it are one click from being back. */}
          <SettingsRow
            control={
              <Button
                className={CONTROL_WIDTH}
                nativeButton={false}
                render={<Link to={paths.settings.trash.getHref()} />}
                size="lg"
                variant="outline"
              >
                {t("trashAction")}
              </Button>
            }
            description={t("trashDescription")}
            hint={t("trashHint")}
            label={t("trash")}
          />
        </SettingsSection>

        {/* The assistant, after writing and before memories: it is a thing that
            happens to writing, and it used to be a destination in the bar - a
            top-level tab for one optional switch, which is more prominence than
            an off-by-default feature earns. Two sections rather than one, and
            the second only while the switch is on: the panel owns both, because
            turning assistance off unmounts the models list, and a switch that
            unmounts something has to stand beside it. */}
        <AiPanel />

        {/* Two resurfacings, two switches, and each explains what it actually
            does: an anniversary is not the same idea as a thought coming back
            round, and neither should silence the other by accident. */}
        <SettingsSection
          description={t("memoriesSectionDescription")}
          title={t("memoriesSection")}
        >
          <SettingsRow
            control={
              <Segmented<ToggleChoice>
                className={SEGMENTED_CONTROL}
                onValueChange={handleOnThisDayChange}
                options={[
                  { label: t("on"), value: "on" },
                  { label: t("off"), value: "off" },
                ]}
                value={onThisDay ? "on" : "off"}
              />
            }
            description={t("onThisDayDescription")}
            hint={t("onThisDayHint")}
            label={t("onThisDay")}
          />
          <SettingsRow
            control={
              <Segmented<ToggleChoice>
                className={SEGMENTED_CONTROL}
                onValueChange={handleSparkEchoChange}
                options={[
                  { label: t("on"), value: "on" },
                  { label: t("off"), value: "off" },
                ]}
                value={sparkEcho ? "on" : "off"}
              />
            }
            description={t("sparkEchoDescription")}
            hint={t("sparkEchoHint")}
            label={t("sparkEchoSetting")}
          />
        </SettingsSection>

        <SettingsSection
          description={t("dataSectionDescription")}
          title={t("dataSection")}
          tourStepId="settings-data"
        >
          {/* First, because it is the only row here about the journal itself
              rather than about copies of it. There was no setting for this at
              all, and "backup folder" underneath was read as though there were:
              this is where the journal lives, and that one is where its
              archives are written. Both hints now say which is which. */}
          <SettingsRow
            control={
              <ConfirmDialog
                confirmLabel={t("journalFolderAction")}
                confirmVariant="default"
                description={t("journalFolderConfirm")}
                onConfirm={handleMoveJournal}
                title={t("journalFolder")}
                trigger={
                  <Button
                    className={CONTROL_WIDTH}
                    size="lg"
                    type="button"
                    variant="outline"
                  />
                }
              >
                {t("journalFolderAction")}
              </ConfirmDialog>
            }
            description={journalFailed ? t("journalFolderError") : journalPath}
            hint={t("journalFolderHint")}
            label={t("journalFolder")}
          />
          <SettingsRow
            control={
              <Button
                className={CONTROL_WIDTH}
                onClick={handleBackup}
                size="lg"
                type="button"
                variant="outline"
              >
                {t("backupAction")}
              </Button>
            }
            description={getBackupDescription()}
            hint={t("backupHint")}
            label={t("backup")}
          />
          {/* A backup is for Wattle; this is for everything else. The one
              fidelity loss is named here rather than discovered later in the
              exported files. */}
          <SettingsRow
            control={
              <Button
                className={CONTROL_WIDTH}
                disabled={!hasEntries}
                onClick={handleExportHtml}
                size="lg"
                type="button"
                variant="outline"
              >
                {t("exportAction")}
              </Button>
            }
            description={hasEntries ? t("exportDescription") : t("exportEmpty")}
            label={t("export")}
          />
          <SettingsRow
            control={
              <ConfirmDialog
                confirmLabel={t("restoreAction")}
                description={t("restoreConfirm")}
                onConfirm={handleRestore}
                title={t("restore")}
                // Not red: red is kept for the one action that ends with an
                // empty journal. Restoring and resetting both ask before they
                // run, and their dialog carries the warning.
                trigger={
                  <Button
                    className={CONTROL_WIDTH}
                    disabled={restoreStatus === "restoring"}
                    size="lg"
                    type="button"
                    variant="outline"
                  />
                }
              >
                {restoreStatus === "restoring"
                  ? t("restoring")
                  : t("restoreAction")}
              </ConfirmDialog>
            }
            description={
              restoreStatus === "error"
                ? t("restoreError")
                : t("restoreDescription")
            }
            hint={t("restoreHint")}
            label={t("restore")}
          />
        </SettingsSection>

        {/* Everything that undoes something, in one place and in order of what
            it costs: preferences, then the tours, then the journal itself. */}
        <SettingsSection title={t("resetSection")} tourStepId="settings-reset">
          {/* Preferences only. Your name is not in this slice, and assistance
              is left exactly as it was: turning it on was a decision about what
              may run on this machine, and a "reset preferences" button has no
              business reversing it. */}
          <SettingsRow
            control={
              <ConfirmDialog
                confirmLabel={t("resetAction")}
                description={t("resetConfirm")}
                onConfirm={handleReset}
                title={t("reset")}
                trigger={
                  <Button
                    className={CONTROL_WIDTH}
                    size="lg"
                    type="button"
                    variant="outline"
                  />
                }
              >
                {t("resetAction")}
              </ConfirmDialog>
            }
            description={t("resetDescription")}
            hint={t("resetHint")}
            label={t("reset")}
          />
          {/* Home, because that is where the first tour is: forgetting they
              were seen has nothing to show for it on this page. */}
          <SettingsRow
            control={
              <Button
                className={CONTROL_WIDTH}
                onClick={handleReplayTours}
                size="lg"
                type="button"
                variant="outline"
              >
                {t("replayToursAction")}
              </Button>
            }
            description={t("replayToursDescription")}
            hint={t("replayToursHint")}
            label={t("replayTours")}
          />
          {/* Last, and the only one here that takes the writing with it. Not a
              second profile: this empties the one that is here. The wording
              says so, and the dialog says it again before anything goes. */}
          <SettingsRow
            control={
              <NewProfileDialog
                backupDir={backupDir}
                disabled={aiPulling}
                onConfirm={handleNewProfile}
              />
            }
            description={
              newProfileFailed
                ? t("newProfileError")
                : t("newProfileDescription")
            }
            hint={t("newProfileHint")}
            label={t("newProfile")}
          />
        </SettingsSection>
      </PageIntro>
    </main>
  );
};
