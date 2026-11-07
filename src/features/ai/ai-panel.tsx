import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/layout/settings-section";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  saveSettingsThunk,
  setAiEnabled,
  setAiModel,
  setAiPulling,
} from "@/redux/slices/settings/settings.slice";

import type { AiFailure } from "./interfaces/ai-errors";
import type { AiStatus } from "./interfaces/ai-status";
import { toAiFailure } from "./functions/ai-errors";
import type { CatalogEntry } from "./model-catalog";
import { ModelCatalog } from "./model-catalog";

interface PullProgress {
  completed: number;
  status: string;
  total: number;
}

interface InstallProgress {
  /** The last frame of a run - finished, failed or cancelled. */
  done: boolean;
  status: string;
}

/** Which model row, if any, is mid-operation. */
interface Busy {
  id: string;
  kind: "installing" | "removing";
  percent: number;
}

/** What the panel is doing about the runtime, as opposed to about a model. */
type RuntimeTask = "idle" | "starting" | "installing";

/** A boolean, spelled as a choice so it matches the other settings controls. */
type ToggleChoice = "on" | "off";

/** The same box every control in the settings column stands in. */
const SEGMENTED_CONTROL = "w-44 p-1 *:flex-1";

/** The frame Rust sends once a download is over, however it ended. */
const PULL_FINISHED = "done";

/**
 * The assistant, as a section of Settings.
 *
 * **The runtime is plumbing, not a decision.** Ollama used to have a section of
 * its own, with its own install and start buttons, which asked the reader to
 * learn a second product's name and lifecycle before they could download a
 * model. It is now arranged for behind whichever thing they actually pressed,
 * and the two presses do not ask for the same amount. The switch shows the list
 * and wakes a runtime that is already on the disk. The download button is the
 * one that may fetch one - one click, and the installing, starting and pulling
 * happen behind it, in that order.
 *
 * State lives here rather than in the store: the status and the catalog are
 * read in this one place and nowhere else. What the rest of the app needs -
 * whether AI is on, which model is active, and whether a download is running -
 * is in the settings slice.
 *
 * **What is running is asked, never remembered.** A download and an install
 * both outlive this panel: they run in Rust, and the reader is free to go and
 * write something while one is in flight. So every mount begins by asking what
 * is still going on rather than assuming nothing is, and every end arrives as
 * an event rather than only as the return of the call that started it - the
 * panel that gets the answer is often not the panel that asked the question.
 */
export const AiPanel = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const aiEnabled = useAppSelector((state) => state.settings.aiEnabled);
  const activeModel = useAppSelector((state) => state.settings.aiModel);
  // A download keeps running in Rust when this screen is left, so the flag is
  // in the store rather than in the panel - read here, and by the control that
  // empties the journal.
  const aiPulling = useAppSelector((state) => state.settings.aiPulling);

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [task, setTask] = useState<RuntimeTask>("idle");
  // Either a translated key with optional detail, or a sentence this panel
  // already owns (a start or install that did not take).
  const [failure, setFailure] = useState<AiFailure | string | null>(null);

  // Probed when the panel opens, never at boot and never in the background.
  // While assistance is off Rust answers `disabled` without touching the disk.
  const refresh = useCallback(async () => {
    try {
      const next = await invoke<AiStatus>("ai_status");
      setStatus(next);

      // Work already in flight is picked back up rather than hidden. The row it
      // belongs to shows its progress again and, with it, the button that stops
      // it - which is the part that matters: a download nobody can see is also
      // a download nobody can cancel. The percentage restarts at zero and is
      // corrected by the next frame, a fraction of a second later.
      setBusy((current) => {
        if (next.pulling) {
          return current?.id === next.pulling
            ? current
            : { id: next.pulling, kind: "installing", percent: 0 };
        }
        return current?.kind === "installing" ? null : current;
      });
      dispatch(setAiPulling(Boolean(next.pulling)));
      setTask((current) => {
        if (next.installing) {
          return "installing";
        }
        return current === "installing" ? "idle" : current;
      });

      return next;
    } catch {
      setStatus(null);
      return null;
    }
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Asked again when the window comes back: someone who installed a model in a
  // terminal should not have to reopen settings to be believed. Still never a
  // poll, and still nothing while the panel is closed - it is not mounted.
  useEffect(() => {
    const handleFocus = () => {
      refresh();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  useEffect(() => {
    const pulls = listen<PullProgress>("ai://pull-progress", (event) => {
      const { completed, status: line, total } = event.payload;
      // However it ended - finished, failed, cancelled - the row stops being
      // busy here rather than where it started, because that call belongs to a
      // panel that may have been unmounted since.
      if (line === PULL_FINISHED) {
        setBusy((current) => (current?.kind === "installing" ? null : current));
        dispatch(setAiPulling(false));
        refresh();
        return;
      }
      setBusy((current) =>
        current?.kind === "installing"
          ? {
              ...current,
              percent: total > 0 ? Math.round((completed / total) * 100) : 0,
            }
          : current
      );
    });
    // None of the installer's own words reach the reader any more - the setup
    // is one line of "getting ready" whatever it is doing - but a frame is
    // still proof a run is going on, which is what keeps a panel mounted
    // mid-install showing that rather than nothing.
    const installs = listen<InstallProgress>(
      "ai://install-progress",
      (event) => {
        if (event.payload.done) {
          setTask("idle");
          refresh();
          return;
        }
        setTask("installing");
      }
    );
    return () => {
      pulls.then((stop) => stop());
      installs.then((stop) => stop());
    };
  }, [dispatch, refresh]);

  /**
   * A runtime that answers, arranged for rather than asked about.
   *
   * Started if it has to be, installed only when `mayInstall` says so, and
   * silent about both: the reader pressed "on" or "download this model", and
   * this is the part of it they were never going to care about. Returns whether
   * it ended up answering, so a caller can stop rather than fail a step later.
   *
   * **Fetching a runtime belongs to the download, not to the switch.** Turning
   * assistance on shows the models and wakes a runtime already on the disk;
   * putting something on a disk is a bigger thing than showing a list, and it
   * is asked for by the one button whose whole purpose is a download.
   */
  const ensureRuntime = async (mayInstall: boolean): Promise<boolean> => {
    const current = await refresh();
    if (current?.state === "running") {
      return true;
    }

    try {
      if (current?.state === "notInstalled") {
        if (!mayInstall) {
          // Nothing here yet, and nothing was asked for. The list is shown as
          // it is, and the first download will do the fetching.
          return false;
        }
        setTask("installing");
        const installed = await invoke<boolean>("ai_install_ollama");
        if (!installed) {
          setFailure(t("ollamaInstallFailed"));
          setTask("idle");
          return false;
        }
      }
      setTask("starting");
      const answering = await invoke<boolean>("ai_start_ollama");
      if (!answering) {
        setFailure(t("ollamaStartFailed"));
      }
      setTask("idle");
      await refresh();
      return answering;
    } catch (error) {
      setFailure(toAiFailure(error));
      setTask("idle");
      await refresh();
      return false;
    }
  };

  // On shows the models and wakes a runtime that is already here. It installs
  // nothing: the switch is a decision about this screen, and a reader who only
  // wanted to see what is on offer has not asked for anything to be downloaded.
  const handleAiChange = async (value: ToggleChoice) => {
    const on = value === "on";
    setFailure(null);
    dispatch(setAiEnabled(on));
    await dispatch(saveSettingsThunk());
    if (on) {
      await ensureRuntime(false);
      return;
    }
    setStatus(null);
  };

  const handleModelChange = (value: string | null) => {
    dispatch(setAiModel(value ?? ""));
    dispatch(saveSettingsThunk());
  };

  // The flag is raised and lowered around the pull itself rather than derived
  // from this component's lifetime. A download keeps running in Rust after the
  // screen is left, and `dispatch` is a store call rather than a `setState`, so
  // this function finishes and lowers the flag whether or not the panel is
  // still mounted - which is what stops it from being stuck up for ever.
  const handleInstallModel = async (id: string) => {
    setFailure(null);
    // The whole workflow, from one press: a runtime is fetched if this machine
    // has not got one and started if it is not answering, and only then is the
    // model asked for. This is the button that may install.
    if (!(await ensureRuntime(true))) {
      return;
    }
    setBusy({ id, kind: "installing", percent: 0 });
    dispatch(setAiPulling(true));
    try {
      await invoke("ai_pull_model", { id });
    } catch (error) {
      setFailure(toAiFailure(error));
    }
    dispatch(setAiPulling(false));
    setBusy(null);
    await refresh();
  };

  const handleCancelPull = async () => {
    await invoke("ai_cancel_pull");
  };

  const handleRemoveModel = async (id: string) => {
    setFailure(null);
    setBusy({ id, kind: "removing", percent: 0 });
    try {
      await invoke("ai_delete_model", { id });
      if (activeModel === id) {
        dispatch(setAiModel(""));
      }
    } catch (error) {
      setFailure(toAiFailure(error));
    }
    setBusy(null);
    await refresh();
  };

  const isRunning = status?.state === "running";
  // Writers only - which every catalogue row now is. The embedding model that
  // similarity is measured with is not offered by Wattle at all: someone who
  // has it installed sees it among the unmanaged rows, which are never
  // candidates for the active model.
  const installedModels =
    status?.catalog.filter((entry) => entry.installed) ?? [];
  const isWorking = task !== "idle";
  // One model is not a choice. Naming it in a picker with nothing to pick from
  // asks the reader to confirm the only thing that could be true - so it is
  // made active below and the row is left out until a second model arrives.
  const onlyModel = installedModels.length === 1 ? installedModels[0].id : null;
  const hasChoice = isRunning && installedModels.length > 1;

  useEffect(() => {
    if (onlyModel && activeModel !== onlyModel) {
      dispatch(setAiModel(onlyModel));
      dispatch(saveSettingsThunk());
    }
  }, [activeModel, dispatch, onlyModel]);

  return (
    <SettingsSection
      description={t("aiSectionDescription")}
      title={t("aiSection")}
    >
      <AssistantSwitch
        enabled={aiEnabled}
        locked={aiPulling || isWorking}
        onChange={handleAiChange}
      />
      <SetupNotice failure={failure} working={isWorking} />

      {/* Nothing below this line exists - or probes anything - while the switch
            is off. */}
      {aiEnabled ? (
        <>
          {/* Only appears once there is a model that could be the active one. */}
          {hasChoice ? (
            <ActiveModelRow
              activeModel={activeModel}
              installed={installedModels}
              onChange={handleModelChange}
            />
          ) : null}

          <div className="px-5 py-4">
            {isRunning && installedModels.length === 0 ? (
              <p className="mb-4 text-muted-foreground text-xs leading-relaxed">
                {t("aiNoModelsYet")}
              </p>
            ) : null}

            {/* A model can be asked for whatever the runtime is doing, because
                  asking for one is what sets the runtime up. Only this panel's
                  own work holds the buttons. */}
            <ModelCatalog
              activeModel={activeModel}
              busy={busy}
              canManage={!isWorking}
              catalog={status?.catalog ?? []}
              onCancelPull={handleCancelPull}
              onInstall={handleInstallModel}
              onRemove={handleRemoveModel}
              unmanaged={status?.unmanaged ?? []}
            />
          </div>
        </>
      ) : null}
    </SettingsSection>
  );
};

interface AssistantSwitchProps {
  enabled: boolean;
  /** Held while a download or a setup is in flight: neither survives being
   *  switched off half way through. */
  locked: boolean;
  onChange: (value: ToggleChoice) => void;
}

/** The one decision this section is about. */
const AssistantSwitch = ({
  enabled,
  locked,
  onChange,
}: AssistantSwitchProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-body-sm text-foreground leading-tight">{t("ai")}</p>
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
          {enabled ? t("aiOnDescription") : t("aiDescription")}
        </p>
      </div>
      <div className="shrink-0">
        <Segmented<ToggleChoice>
          className={SEGMENTED_CONTROL}
          disabled={locked}
          onValueChange={onChange}
          options={[
            { label: t("on"), value: "on" },
            { label: t("off"), value: "off" },
          ]}
          value={enabled ? "on" : "off"}
        />
      </div>
    </div>
  );
};

interface SetupNoticeProps {
  failure: AiFailure | string | null;
  working: boolean;
}

/**
 * What the setup is doing, and what it failed to do.
 *
 * One line for the whole of it, and no vocabulary out of it: whether Wattle is
 * fetching a runtime or waking one already on the disk is not a difference the
 * reader can act on. The section that used to stand here - the runtime's own
 * name, its version, and buttons to install and to start it - is gone for the
 * same reason. It was a step, and a step is not a setting.
 */
const SetupNotice = ({ failure, working }: SetupNoticeProps) => {
  const { t } = useTranslation();

  if (working) {
    return (
      <div aria-live="polite" className="px-5 py-4" role="status">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("aiPreparing")}
        </p>
        {/* Indeterminate, because the setup gives no number that could
            honestly fill a determinate bar. */}
        <div className="mt-3 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-assist" />
        </div>
      </div>
    );
  }

  if (!failure) {
    return null;
  }

  const isSentence = typeof failure === "string";

  return (
    <div aria-live="polite" className="px-5 py-4" role="status">
      <p className="text-destructive text-sm leading-relaxed">
        {isSentence ? failure : t(failure.messageKey)}
      </p>
      {isSentence || !failure.detail ? null : (
        <p className="wrap-break-word mt-1 text-meta text-muted-foreground">
          {failure.detail}
        </p>
      )}
    </div>
  );
};

interface ActiveModelRowProps {
  activeModel: string;
  installed: CatalogEntry[];
  onChange: (value: string | null) => void;
}

/** Which of the installed models the rewrite button will use. */
const ActiveModelRow = ({
  activeModel,
  installed,
  onChange,
}: ActiveModelRowProps) => {
  const { t } = useTranslation();
  const labels = Object.fromEntries(
    installed.map((entry) => [entry.id, entry.displayName])
  );

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-body-sm text-foreground leading-tight">
          {t("aiActiveModel")}
        </p>
        {/* Assistance is on but nothing is chosen yet: said here, where the
            choice is, rather than as a nag in the editor. */}
        {activeModel === "" ? (
          <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
            {t("aiNoModelChosenHint")}
          </p>
        ) : null}
      </div>
      {/* Empty means nothing chosen, which Base UI spells as null - that is
          what lets the placeholder show instead of a blank label. */}
      <Select
        items={labels}
        onValueChange={onChange}
        value={activeModel || null}
      >
        <SelectTrigger className="w-44 shrink-0" size="sm">
          <SelectValue placeholder={t("aiNoModel")} />
        </SelectTrigger>
        <SelectContent>
          {installed.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
