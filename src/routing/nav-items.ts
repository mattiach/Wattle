import { Component } from "lucide-react";

import { CalendarDaysIcon } from "@/components/icons/calendar-days";
import { HomeIcon } from "@/components/icons/home";
import { SettingsIcon } from "@/components/icons/settings";
import { SparklesIcon } from "@/components/icons/sparkles";
import { MailIcon } from "@/components/icons/mail";

import { paths } from "./paths";

import type { ComponentType } from "react";

/**
 * What the bar asks of an icon, which is very little.
 *
 * Lucide's icons and the animated ones both answer to this much. The animated
 * ones take one thing more - a ref carrying the two controls below - and that
 * is picked up in the bar itself, where the hover it belongs to lives.
 */
export type NavIcon = ComponentType<{ className?: string; size?: number }>;

/** Start and stop, which is the whole of an animated icon's interface. */
export interface NavIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface NavItem {
  /**
   * Whether `icon` is one of the animated ones, and so has something to say
   * when the tab is under the pointer. Declared rather than detected: there is
   * no way to ask a component whether it takes a ref.
   */
  animated?: boolean;
  icon: NavIcon;
  /** Key in the translation catalogue; used for the label and the accessible name. */
  labelKey: string;
  to: string;
}

/** Top-level destinations shown in the floating bottom navigation. */
export const navItems: NavItem[] = [
  {
    animated: true,
    icon: HomeIcon,
    labelKey: "allEntries",
    to: paths.app.path,
  },
  {
    animated: true,
    icon: CalendarDaysIcon,
    labelKey: "calendar",
    to: paths.calendar.path,
  },
  {
    animated: true,
    icon: SparklesIcon,
    labelKey: "dailySparks",
    to: paths.sparks.path,
  },
  {
    animated: true,
    icon: MailIcon,
    labelKey: "letters",
    to: paths.letters.path,
  },
  /*   {
    animated: true,
    icon: BotIcon,
    labelKey: "ai",
    to: paths.ai.path,
  }, */
  {
    animated: true,
    icon: SettingsIcon,
    labelKey: "settings",
    to: paths.settings.path,
  },
  // Gated by the same value as the route itself, so the tab can never outlive
  // the page it points at.
  ...(__DEV_TOOLS__
    ? [
        {
          icon: Component,
          labelKey: "backToComponents",
          to: paths.developer.path,
        },
      ]
    : []),
];

/**
 * The destinations this reader actually has.
 *
 * One list, read in one place, so the bottom bar, the header and the highlight
 * can never disagree about what exists - which they would the moment two of
 * them decided separately.
 */
export const useNavItems = (): NavItem[] => navItems;
