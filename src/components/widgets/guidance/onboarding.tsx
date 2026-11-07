import { open } from "@tauri-apps/plugin-dialog";
import { ArchiveRestore, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/languages/language-provider";
import {
  LANGUAGE_CODES,
  LANGUAGE_LABELS,
  LanguageFlag,
} from "@/languages/languages";
import { useNameField } from "@/hooks/use-name-field";
import { defaultBackupDir, runRestore } from "@/lib/backup";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { NAME_MIN_LENGTH } from "@/redux/slices/profile/profile.data";
import {
  saveSettingsThunk,
  setBackupDir,
  setOnboarded,
} from "@/redux/slices/settings/settings.slice";
import type { Settings } from "@/redux/slices/settings/settings.types";
import { paths } from "@/routing/paths";
import { useTheme } from "@/theme/theme-provider";

const STEPS = ["language", "start", "name", "backup", "theme"] as const;
type Step = (typeof STEPS)[number];

/**
 * One of the two doors on the `start` step.
 *
 * A surface rather than a plain button: the choice between a blank journal and
 * one that already exists deserves a sentence each, and this is the same card
 * the rest of the app is built from - hairline, paper, and the accent arriving
 * only on hover.
 */
const OnboardingChoice = ({
  body,
  icon,
  label,
  onClick,
}: {
  body: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  // Stacked inside, because the two sit side by side: at half the column each
  // there is no room for an icon beside a label, and a column of icon, name
  // and sentence is what a card this narrow reads as.
  <button
    className="group flex flex-1 flex-col rounded-xl border border-hairline bg-card p-4 text-left outline-none duration-200 hover:border-wattle/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    onClick={onClick}
    type="button"
  >
    <span className="text-muted-foreground duration-200 group-hover:text-wattle-ink">
      {icon}
    </span>
    <span className="mt-3 text-body-sm text-foreground leading-tight">
      {label}
    </span>
    <span className="mt-1.5 block text-muted-foreground text-sm leading-snug">
      {body}
    </span>
  </button>
);

/**
 * The way in for someone who has been here before.
 *
 * The very command the settings page restores with, so there is one restore in
 * this app and not two. The archive carries the whole of `wattle.db`, which is
 * why this needs no further step and writes no settings of its own: the journal,
 * the name and `onboarded` itself all come back inside it, and the reload into
 * the home screen is what reads them.
 */
const RestoreFromBackup = () => {
  const { t } = useTranslation();
  const [isRestoring, setIsRestoring] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const handleRestore = async () => {
    setHasFailed(false);
    setIsRestoring(true);
    const outcome = await runRestore();
    if (outcome === "restored") {
      // Not `reload()`: a replacement profile is started from Settings, so that
      // is the address the flow is sitting on, and reloading it would open the
      // restored journal on the settings page. A restored journal deserves the
      // same first screen a new one gets. Left busy on purpose while the load
      // happens - an idle button in the meantime invites a second restore.
      window.location.replace(paths.app.getHref());
      return;
    }
    setIsRestoring(false);
    if (outcome === "failed") {
      setHasFailed(true);
    }
  };

  return (
    <div>
      {/* Asked in the app's own dialog rather than the system alert box, and
          asked before the file picker: choosing the archive is then the last
          word on it instead of a second question about the same thing. */}
      <ConfirmDialog
        confirmLabel={t("onboarding.returning.action")}
        confirmVariant="default"
        description={t("onboarding.returning.confirm")}
        onConfirm={handleRestore}
        title={t("onboarding.returning.confirmTitle")}
        trigger={
          <Button
            className="w-full"
            disabled={isRestoring}
            type="button"
            variant="outline"
          />
        }
      >
        <ArchiveRestore />
        {isRestoring ? t("restoring") : t("onboarding.returning.action")}
      </ConfirmDialog>
      {hasFailed ? (
        <p
          aria-live="polite"
          className="mt-3 text-destructive text-sm leading-snug"
        >
          {t("restoreError")}
        </p>
      ) : null}
    </div>
  );
};

/**
 * The name, and one line under it that never moves.
 *
 * The line holds what the field is for, or why what is in it will not do - and
 * it holds one or the other at all times. Settings says it this way already
 * (`SettingsRow`), and it is the only shape that cannot shift the buttons
 * underneath, which the old conditional message did the moment the step
 * opened: an empty name is already an error.
 */
const NameStep = ({ field }: { field: ReturnType<typeof useNameField> }) => {
  const { t } = useTranslation();

  return (
    <div>
      <Input
        aria-invalid={field.error !== undefined}
        aria-label={t("name")}
        maxLength={field.maxLength}
        onChange={field.onChange}
        placeholder={t("namePlaceholder")}
        value={field.value}
      />
      <p
        aria-live="polite"
        className={cn(
          "mt-2 text-sm leading-snug",
          field.error ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {field.error ??
          t("nameDescription", {
            max: field.maxLength,
            min: NAME_MIN_LENGTH,
          })}
      </p>
    </div>
  );
};

/**
 * Setting up a journal, before there is a journal.
 *
 * Rendered *instead of* the application rather than over it, so there is no
 * navigation behind it to reach and nothing to dismiss it onto - the flow is
 * meant to be finished, not escaped. `hydrateStore` runs before first paint, so
 * this decision is made without a flash of the app first.
 *
 * Every step writes through the hook that already owns its setting, which is
 * why the interface changes language and theme while they are being chosen: the
 * preview is the real thing, not a mock of it. Nothing here is a second store.
 * Only the last step writes `onboarded`, so a flow abandoned halfway keeps the
 * answers already given and asks again from the top.
 *
 * The second step forks: someone who already has a Wattle backup does not need
 * to answer four questions and then overwrite every answer with a restore. That
 * fork is asked *after* the language, so the question is legible to the person
 * being asked it.
 */
export const Onboarding = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { language, setLanguage } = useLanguage();
  const { setTheme, theme } = useTheme();
  const navigate = useNavigate();
  const backupDir = useAppSelector((state) => state.settings.backupDir);

  const [stepIndex, setStepIndex] = useState(0);
  // The returning-user path is not a step: it leaves the numbered flow entirely
  // and either ends it - by reloading into a restored journal - or comes back.
  const [isReturning, setIsReturning] = useState(false);
  // The same field the settings page edits later, so the rule that a name is
  // required - and what "too short" means - is written once.
  const nameField = useNameField();

  // The folder step opens with somewhere valid already chosen, so that a
  // cancelled picker never leaves an unskippable step with nothing to accept.
  useEffect(() => {
    if (backupDir) {
      return;
    }
    let cancelled = false;
    defaultBackupDir()
      .then((path) => {
        if (!cancelled) {
          dispatch(setBackupDir(path));
        }
      })
      .catch(() => {
        // No journal folder to suggest. The step still works; it just starts
        // empty and the picker decides.
      });
    return () => {
      cancelled = true;
    };
  }, [backupDir, dispatch]);

  const step: Step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const handleLanguageChange = (value: Settings["language"] | null) => {
    if (value) {
      setLanguage(value);
    }
  };

  const handleChooseFolder = async () => {
    const chosen = await open({
      defaultPath: backupDir || undefined,
      directory: true,
    });
    // Cancelling keeps what is already there rather than clearing it, so the
    // step stays completable.
    if (typeof chosen !== "string") {
      return;
    }
    dispatch(setBackupDir(chosen));
    dispatch(saveSettingsThunk());
  };

  const handleBack = () => setStepIndex((index) => Math.max(0, index - 1));

  const handleStartFresh = () => setStepIndex((index) => index + 1);
  const handleChooseReturning = () => setIsReturning(true);
  // A failed restore does not have to be cleared: leaving unmounts the screen
  // that reported it, and coming back is a fresh attempt.
  const handleLeaveReturning = () => setIsReturning(false);

  const handleNext = () => {
    // The name is written on the way past it, so a flow abandoned later still
    // remembers it.
    if (step === "name") {
      nameField.commit();
    }
    if (!isLast) {
      setStepIndex((index) => index + 1);
      return;
    }
    // The one write that says this profile is set up.
    dispatch(setOnboarded(true));
    dispatch(saveSettingsThunk());
    // Home, always. A first profile is set up at `/app` and lands there anyway,
    // but a *replacement* one is started from Settings - and reloading left
    // that route in the address bar, so finishing the flow used to drop the
    // reader back into the settings page they had just emptied the journal
    // from. The first thing a new journal shows should be the new journal.
    navigate(paths.app.getHref(), { replace: true });
  };

  // What the header is titled after. The returning path borrows the same
  // `onboarding.*` shape as a step, so one key drives both.
  const screen: Step | "returning" = isReturning ? "returning" : step;
  const canGoBack = isReturning || stepIndex > 0;
  const goBack = isReturning ? handleLeaveReturning : handleBack;
  // The two doors are the action on the `start` step, and the restore button is
  // the action on the returning screen. Neither has anything left for "Next".
  const showNext = !(isReturning || step === "start");

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      {/* One height for every step, with the controls pinned to the bottom of
          it. The steps hold different things - a select, two cards, a field,
          two segments - and letting each set its own height made Next and
          Previous jump around the screen between them. Taller content is still
          allowed to grow past it; nothing here is clipped. */}
      <div className="flex min-h-96 w-full max-w-md flex-col">
        {/* The counter belongs to the numbered flow; the returning path is not
            in it, and greets rather than counts. */}
        <p className="text-meta text-muted-foreground tabular-nums">
          {isReturning
            ? t("onboarding.returning.eyebrow")
            : t("onboardingStep", {
                step: stepIndex + 1,
                total: STEPS.length,
              })}
        </p>
        <h1 className="mt-2 font-heading font-medium text-foreground text-title">
          {t(`onboarding.${screen}.title`)}
        </h1>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          {t(`onboarding.${screen}.body`)}
        </p>

        <div className="mt-8">
          {/* The returning path is only ever reachable from the `start` step
              and resets on the way back, so it is the one block that has to
              say it is not the step behind it. */}
          {isReturning ? <RestoreFromBackup /> : null}

          {step === "language" ? (
            <Select
              items={LANGUAGE_LABELS}
              onValueChange={handleLanguageChange}
              value={language}
            >
              <SelectTrigger className="w-full">
                <LanguageFlag code={language} />
                <SelectValue />
              </SelectTrigger>
              {/* Capped and scrollable: sixteen languages is taller than the
                  step it opens over - and opaque, so the step behind it does
                  not show through the list being scrolled. */}
              <SelectContent className="max-h-64 bg-popover">
                {LANGUAGE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    <LanguageFlag code={code} />
                    {LANGUAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {step === "start" && !isReturning ? (
            <div className="flex items-stretch gap-3">
              <OnboardingChoice
                body={t("onboarding.start.freshBody")}
                icon={<PenLine className="size-4" />}
                label={t("onboarding.start.fresh")}
                onClick={handleStartFresh}
              />
              <OnboardingChoice
                body={t("onboarding.start.returningBody")}
                icon={<ArchiveRestore className="size-4" />}
                label={t("onboarding.start.returning")}
                onClick={handleChooseReturning}
              />
            </div>
          ) : null}

          {step === "name" ? <NameStep field={nameField} /> : null}

          {step === "backup" ? (
            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 break-all text-foreground text-sm leading-snug">
                {backupDir || t("backupFolderUnset")}
              </p>
              <Button
                className="shrink-0"
                onClick={handleChooseFolder}
                type="button"
                variant="outline"
              >
                {t("backupFolderAction")}
              </Button>
            </div>
          ) : null}

          {step === "theme" ? (
            <Segmented<Settings["theme"]>
              onValueChange={setTheme}
              options={[
                { label: t("light"), value: "light" },
                { label: t("dark"), value: "dark" },
              ]}
              value={theme}
            />
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-10">
          {canGoBack ? (
            <Button onClick={goBack} type="button" variant="ghost">
              {t("previous")}
            </Button>
          ) : (
            <span />
          )}
          {/* Only the name step is blocked by the name: an empty one is an
              error from the first render, and gating every step on it would
              strand the reader on the language step. */}
          {showNext ? (
            <Button
              disabled={step === "name" && nameField.error !== undefined}
              onClick={handleNext}
              type="button"
            >
              {isLast ? t("onboardingFinish") : t("next")}
            </Button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </main>
  );
};
