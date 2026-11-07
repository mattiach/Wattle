import { Calendar as CalendarIcon, Download, Trash2 } from "lucide-react";
import type { ComponentType, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DurationPicker } from "@/features/letters/duration-picker";
import type { EntrySummary } from "@/redux/slices/entries/entries.types";
import { paths } from "@/routing/paths";

import { ConfirmDialog } from "../confirm-dialog";
import { DateField } from "../date-field";
import { EmptyState } from "../empty-state";
import { MonthGrid } from "@/features/calendar/month-grid";
import { PageHeader } from "../layout/page-header";
import { EntryResultRow } from "../search-results";
import { SparkCard } from "@/features/sparks/spark-card";
import { SparkComposer } from "@/features/sparks/spark-composer";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Card } from "../ui/card";
import { CalendarDaysIcon } from "../icons/calendar-days";
import { HomeIcon } from "../icons/home";
import { SettingsIcon } from "../icons/settings";
import { SparklesIcon } from "../icons/sparkles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import { Segmented } from "../ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { TourProvider, useTour } from "../ui/tour";

/** The previews are inert; confirming here only closes the dialog. */
const noop = () => undefined;

/**
 * A day in the middle of a month, so a grid drawn around it has neighbours on
 * both sides. Fixed rather than today's date: a gallery that looks different
 * every morning is harder to read a change out of.
 */
const SAMPLE_DAY = "2026-08-16";

/**
 * The markers SQLite wraps a search hit in, which `Snippet` splits on. Written
 * out here so the row can be shown as a search result rather than only as a
 * browsed one @ the highlight is half of what that row does.
 */
const HIT_OPEN = "\u0002";
const HIT_CLOSE = "\u0003";

/**
 * One row of each kind, made up.
 *
 * Nothing here is fetched: the list components take a summary and render it,
 * which is exactly the thing worth showing. Ids are negative so a stray click
 * lands on a route that resolves to nothing rather than on somebody's entry.
 */
const sampleEntry = (t: (key: string) => string): EntrySummary => ({
  createdAt: `${SAMPLE_DAY}T09:12:00Z`,
  entryDate: SAMPLE_DAY,
  id: -1,
  kind: "entry",
  preview: t("components.sampleEntryBody"),
  snippet: null,
  title: t("components.sampleEntryTitle"),
  updatedAt: `${SAMPLE_DAY}T09:40:00Z`,
  wordCount: 214,
});

const sampleSpark = (t: (key: string) => string): EntrySummary => ({
  ...sampleEntry(t),
  id: -2,
  kind: "spark",
  preview: t("components.sampleSpark"),
  title: "",
  wordCount: 12,
});

/**
 * A labelled shelf inside one component's card, so variants, sizes and states
 * are told apart rather than run together in a single row of controls.
 */
const Shelf = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="flex flex-col gap-2">
    <p className="eyebrow text-faint">{label}</p>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

/**
 * Variant and size names are the component's own API, so they are shown
 * verbatim rather than translated - reading `destructiveGhost` here is the
 * point. Everything written as prose goes through the catalogues.
 */
const ButtonShowcase = () => {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-col gap-5">
      <Shelf label={t("components.variants")}>
        <Button>default</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="tertiary">tertiary</Button>
        <Button variant="outline">outline</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="link">link</Button>
        <Button variant="destructive">destructive</Button>
        <Button variant="destructiveGhost">destructiveGhost</Button>
      </Shelf>
      <Shelf label={t("components.sizes")}>
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button size="default">default</Button>
        <Button size="lg">lg</Button>
        <Button aria-label="icon-sm" size="icon-sm" variant="ghost">
          <Trash2 />
        </Button>
        <Button aria-label="icon" size="icon" variant="outline">
          <Download />
        </Button>
      </Shelf>
      <Shelf label={t("components.states")}>
        <Button disabled>disabled</Button>
        <Button variant="outline">
          <Download />
          {t("components.withIcon")}
        </Button>
      </Shelf>
    </div>
  );
};

const CardShowcase = () => {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-sm p-5">
      <p className="font-heading font-medium text-[1.05rem] text-foreground">
        {t("components.cardTitle")}
      </p>
      <p className="mt-1.5 text-body-sm text-muted-foreground leading-relaxed">
        {t("components.cardBody")}
      </p>
    </Card>
  );
};

const InputShowcase = () => {
  const { t } = useTranslation();

  return (
    <>
      <Input
        aria-label={t("name")}
        className="h-9 w-56"
        placeholder={t("namePlaceholder")}
      />
      <Input
        aria-label={t("components.disabled")}
        className="h-9 w-56"
        disabled
        placeholder={t("components.disabled")}
      />
    </>
  );
};

const SegmentedShowcase = () => {
  const { t } = useTranslation();
  const [value, setValue] = useState("light");

  return (
    <Segmented
      onValueChange={setValue}
      options={[
        { label: t("light"), value: "light" },
        { label: t("dark"), value: "dark" },
      ]}
      value={value}
    />
  );
};

const SelectShowcase = () => {
  const { t } = useTranslation();
  const [value, setValue] = useState<string | null>("both");
  const labels: Record<string, string> = {
    both: t("navigationBoth"),
    bottom: t("navigationBottom"),
    header: t("navigationHeader"),
  };

  return (
    <Select items={labels} onValueChange={setValue} value={value}>
      <SelectTrigger className="w-36" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="bottom">{labels.bottom}</SelectItem>
        <SelectItem value="header">{labels.header}</SelectItem>
        <SelectItem value="both">{labels.both}</SelectItem>
      </SelectContent>
    </Select>
  );
};

const DialogShowcase = () => {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        {t("components.openDialog")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("components.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("components.dialogBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
};

const ConfirmDialogShowcase = () => {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      confirmLabel={t("delete")}
      description={t("deleteEntryConfirm")}
      onConfirm={noop}
      title={t("deleteEntry")}
      trigger={<Button variant="outline" />}
    >
      {t("components.askConfirmation")}
    </ConfirmDialog>
  );
};

const DropdownMenuShowcase = () => {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {t("exportAction")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>{t("downloadHtml")}</DropdownMenuItem>
        <DropdownMenuItem>{t("delete")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const TooltipShowcase = () => {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        {t("components.hoverMe")}
      </TooltipTrigger>
      <TooltipContent>{t("components.tooltipBody")}</TooltipContent>
    </Tooltip>
  );
};

const DateFieldShowcase = () => {
  const [value, setValue] = useState("2026-08-16");
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <CalendarIcon className="size-4 text-muted-foreground" />
      <DateField
        aria-label={t("entryDate")}
        className="eyebrow"
        onChange={setValue}
        value={value}
      />
    </div>
  );
};

const EmptyStateShowcase = () => {
  const { t } = useTranslation();

  return (
    <EmptyState
      action={<Button variant="outline">{t("retry")}</Button>}
      body={t("emptyBody")}
      className="w-full"
      title={t("emptyTitle")}
    />
  );
};

const PopoverShowcase = () => {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        {t("components.openPopover")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{t("components.popoverTitle")}</PopoverTitle>
          <PopoverDescription>{t("components.popoverBody")}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
};

/**
 * The month picker behind `DateField`, shown open.
 *
 * Worth a shelf of its own: it is the one primitive here that is not this
 * project's own code but `react-day-picker` dressed in it, so what its parts
 * are called is not obvious from the outside.
 */
const CalendarShowcase = () => {
  const [selected, setSelected] = useState<Date | undefined>(
    new Date(SAMPLE_DAY)
  );

  return (
    <Calendar
      captionLayout="dropdown"
      className="rounded-xl border border-hairline"
      defaultMonth={new Date(SAMPLE_DAY)}
      mode="single"
      onSelect={setSelected}
      selected={selected}
    />
  );
};

/** Start and stop: the whole interface an animated icon has. */
interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * One animated icon, played from the control that holds it.
 *
 * The same arrangement the navigation bar uses, and for the same reason: the
 * icon is twenty pixels in the middle of a much larger hover target, so the
 * button decides when it plays rather than the glyph.
 */
const AnimatedIconButton = ({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{
    className?: string;
    ref?: RefObject<IconHandle | null>;
  }>;
  label: string;
}) => {
  const handle = useRef<IconHandle>(null);
  const play = () => handle.current?.startAnimation();
  const stop = () => handle.current?.stopAnimation();

  return (
    <Button
      aria-label={label}
      onMouseEnter={play}
      onMouseLeave={stop}
      size="icon"
      type="button"
      variant="outline"
    >
      <Icon className="size-4" ref={handle} />
    </Button>
  );
};

const AnimatedIconShowcase = () => {
  const { t } = useTranslation();

  return (
    <Shelf label={t("components.hoverMe")}>
      <AnimatedIconButton icon={HomeIcon} label="home" />
      <AnimatedIconButton icon={CalendarDaysIcon} label="calendar-days" />
      <AnimatedIconButton icon={SparklesIcon} label="sparkles" />
      <AnimatedIconButton icon={SettingsIcon} label="settings" />
    </Shelf>
  );
};

/** Inside its own provider, so starting it here cannot disturb a real tour. */
const TourDemoButton = () => {
  const { start } = useTour();
  const { t } = useTranslation();
  const handleStart = () => start("components");

  return (
    <Button
      data-tour-step-id="components-tour"
      onClick={handleStart}
      type="button"
      variant="outline"
    >
      {t("components.startTour")}
    </Button>
  );
};

const TourShowcase = () => {
  const { t } = useTranslation();
  const stepLabel = (current: number, total: number) =>
    t("tourStep", { current, total });

  return (
    <TourProvider
      closeLabel={t("tourClose")}
      stepLabel={stepLabel}
      tours={[
        {
          id: "components",
          steps: [
            {
              content: t("components.tourBody"),
              id: "components-tour",
              nextLabel: t("tourDone"),
              previousLabel: t("previous"),
              title: t("components.tourTitle"),
            },
          ],
        },
      ]}
    >
      <TourDemoButton />
    </TourProvider>
  );
};

/**
 * The masthead every screen opens with, wearing everything it can carry: a way
 * back, a title, a subtitle, a description and one control on the right.
 */
const PageHeaderShowcase = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full">
      <PageHeader
        actions={
          <Button size="sm" variant="outline">
            <Download />
            {t("exportAction")}
          </Button>
        }
        backLabel={t("components.title")}
        backTo={paths.developer.getHref()}
        description={t("components.pageDescription")}
        subtitle={t("components.pageSubtitle")}
        title={t("components.pageTitle")}
      />
    </div>
  );
};

/** A month with two days written on, one of them picked. */
const MonthGridShowcase = () => {
  const [selected, setSelected] = useState<string | null>(SAMPLE_DAY);

  return (
    <div className="w-full max-w-sm">
      <MonthGrid
        counts={{
          "2026-08-04": { entries: 1, sparks: 0 },
          "2026-08-11": { entries: 0, sparks: 2 },
          [SAMPLE_DAY]: { entries: 2, sparks: 1 },
        }}
        month={7}
        onSelect={setSelected}
        selected={selected}
        today={SAMPLE_DAY}
        year={2026}
      />
    </div>
  );
};

/**
 * The row every list in the application is built from: the home timeline, a
 * search result and a calendar day are all this, with the date rail beside it.
 *
 * Three at once, because what the row does is decide how to draw itself from
 * the summary it was handed: an entry with a search hit in it, the same shape
 * with nothing highlighted, and a spark under `uniform` - the mode the
 * calendar's day uses, where every kind wears one card and says which it is.
 */
const EntryResultRowShowcase = () => {
  const { t } = useTranslation();
  const entry = sampleEntry(t);

  return (
    <ul className="flex w-full flex-col gap-4">
      <EntryResultRow
        entry={{
          ...entry,
          snippet: `${t("components.sampleEntryOpening")} ${HIT_OPEN}${t("components.sampleEntryHit")}${HIT_CLOSE}.`,
        }}
      />
      <EntryResultRow entry={entry} onDelete={noop} />
      <EntryResultRow entry={sampleSpark(t)} uniform />
    </ul>
  );
};

const SparkCardShowcase = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm">
      <SparkCard onDelete={noop} spark={sampleSpark(t)} />
    </div>
  );
};

const SparkComposerShowcase = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-md">
      <SparkComposer onSubmit={noop} submitLabel={t("saveThought")} />
    </div>
  );
};

/**
 * The span a letter is sealed for. Presets that resolve to a date the moment
 * they are pressed, and a calendar behind "another day" for anything else.
 */
const DurationPickerShowcase = () => {
  const [value, setValue] = useState("");

  return (
    <div className="w-full">
      <DurationPicker onChange={setValue} value={value} />
    </div>
  );
};

/**
 * The reusable pieces, and the handful of feature components worth reading.
 *
 * The primitives come first, in the order a screen is usually assembled from
 * them. After them are the pieces that are not primitives but are used across
 * enough of the application to be worth seeing in isolation - a masthead, a
 * month, the row every list is made of, the two surfaces a spark lives on and
 * the span a letter is sealed for. Each is handed made-up data here, which is
 * exactly how they are written: they render what they are given and fetch
 * nothing themselves.
 *
 * What is still left out is anything that goes and gets its own data or owns a
 * piece of the shell - the AI panel, the navigation bars, the letter cards.
 * Alone they show nothing but their loading state.
 */
export const registry: { component: ComponentType; name: string }[] = [
  { component: ButtonShowcase, name: "Button" },
  { component: InputShowcase, name: "Input" },
  { component: SegmentedShowcase, name: "Segmented" },
  { component: SelectShowcase, name: "Select" },
  { component: DateFieldShowcase, name: "DateField" },
  { component: CardShowcase, name: "Card" },
  { component: EmptyStateShowcase, name: "EmptyState" },
  { component: TooltipShowcase, name: "Tooltip" },
  { component: DropdownMenuShowcase, name: "DropdownMenu" },
  { component: DialogShowcase, name: "Dialog" },
  { component: ConfirmDialogShowcase, name: "ConfirmDialog" },
  { component: PopoverShowcase, name: "Popover" },
  { component: CalendarShowcase, name: "Calendar" },
  { component: AnimatedIconShowcase, name: "Animated icons" },
  { component: TourShowcase, name: "Tour" },
  { component: PageHeaderShowcase, name: "PageHeader" },
  { component: MonthGridShowcase, name: "MonthGrid" },
  { component: EntryResultRowShowcase, name: "EntryResultRow" },
  { component: SparkCardShowcase, name: "SparkCard" },
  { component: SparkComposerShowcase, name: "SparkComposer" },
  { component: DurationPickerShowcase, name: "DurationPicker" },
];
