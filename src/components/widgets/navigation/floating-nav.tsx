import { AnimatePresence, motion } from "motion/react";
import type { ComponentType, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { instantTransition, springTransition } from "@/lib/motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";
import { useNavItems } from "@/routing/nav-items";
import { useNavLayout } from "@/routing/hooks/use-nav-layout";
import { useNavPill } from "@/routing/hooks/use-nav-pill";

import type { NavIconHandle, NavItem } from "@/routing/nav-items";

/**
 * The label sits in flow immediately (that is what lets the pill measure its
 * destination), so it is faded in on a short delay - by then the pill has all
 * but arrived and the text appears inside it rather than beside it.
 */
const labelTransition = {
  layout: springTransition,
  opacity: { delay: 0.1, duration: 0.16, ease: [0.22, 1, 0.36, 1] },
} as const;

/** Leaving is immediate: no delay, so the tab never collapses around live text. */
const labelExit = {
  opacity: 0,
  transition: { duration: 0.1 },
} as const;

/** Fully round, set inline so Motion can keep the radius true while it scales. */
const pillRadius = { borderRadius: 9999 };

/**
 * Long translations truncate instead of pushing the bar past the viewport.
 * Sized to hold the longest current label ("Tutte le voci") with room to spare.
 */
const labelClassName =
  "relative max-w-36 truncate pr-0.5 pl-2 font-medium text-[0.8125rem] leading-none";

/**
 * True once the first paint is behind us.
 *
 * The bar has to arrive already lit on the current route. Until this flips,
 * every transition is instant, so nothing slides or drops into place on load;
 * afterwards the pill glides horizontally between destinations as usual.
 */
const useSettled = () => {
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  return settled;
};

interface FloatingNavItemProps {
  /** True while this item is the one the highlight is parked on. */
  carriesPill: boolean;
  item: NavItem;
  /**
   * Whether the active item may carry its label. False on a narrow window,
   * where seven destinations leave a label a few pixels - and a label truncated
   * to one character is worse than no label at all, because it still takes the
   * room and no longer says anything.
   */
  labelled: boolean;
  transition: typeof springTransition | typeof instantTransition;
}

const FloatingNavItem = ({
  carriesPill,
  item,
  labelled,
  transition,
}: FloatingNavItemProps) => {
  const { t } = useTranslation();
  const { icon: Icon, labelKey, to } = item;
  const label = t(labelKey);
  const iconHandle = useRef<NavIconHandle>(null);
  // The one cast in this file, and it is contained: `NavIcon` is what both
  // kinds of icon have in common, and the ref is what only the animated ones
  // take. `item.animated` is what says which one this is.
  const AnimatedIcon = Icon as ComponentType<{
    className?: string;
    ref?: RefObject<NavIconHandle | null>;
  }>;
  const iconClassName = (isActive: boolean) =>
    cn(
      "size-5 transition-colors duration-200 ease-out-soft",
      isActive && "text-wattle-ink"
    );

  // Driven from the link rather than from the glyph: the tab is a 44px square
  // and the icon is twenty of them in the middle, so an icon left to watch its
  // own hover only answers when the pointer lands dead centre.
  const handleMouseEnter = () => iconHandle.current?.startAnimation();
  const handleMouseLeave = () => iconHandle.current?.stopAnimation();

  // The accessible name is on the link either way, so nothing is lost to a
  // screen reader when the label goes; the tooltip is what gives it back to
  // someone looking at the bar.
  const link = (
    <NavLink
      aria-label={label}
      className="group block rounded-full outline-none"
      end
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      to={to}
    >
      {({ isActive }) => (
        // h-11 + px-3 + a 20px icon makes the collapsed item an exact square,
        // so the icon sits on the same pixel whether or not the label is out.
        <motion.span
          className={cn(
            "relative flex h-11 items-center rounded-full px-3 text-muted-foreground transition-colors duration-200 ease-out-soft active:translate-y-px group-hover:text-foreground group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
            isActive && "text-foreground"
          )}
          initial={false}
          transition={transition}
        >
          {/* Rendered by whichever item the highlight is parked on, which
                is not always the active one - see `useNavPill`. It never
                unmounts, so Motion always has a previous box to travel from
                and the movement is always horizontal. It only fades while no
                destination matches the route. */}
          {carriesPill ? (
            <motion.span
              animate={{ opacity: isActive ? 1 : 0 }}
              className="absolute inset-0 bg-accent"
              initial={false}
              layoutId="floating-nav-pill"
              style={pillRadius}
              transition={transition}
            />
          ) : null}
          <motion.span
            className="relative flex shrink-0"
            initial={false}
            layout="position"
            transition={transition}
          >
            {item.animated ? (
              <AnimatedIcon
                className={iconClassName(isActive)}
                ref={iconHandle}
              />
            ) : (
              <Icon aria-hidden="true" className={iconClassName(isActive)} />
            )}
          </motion.span>
          {/* popLayout drops the outgoing label out of flow immediately, so
                the old tab collapses while its label fades over the top. */}
          <AnimatePresence initial={false} mode="popLayout">
            {isActive && labelled ? (
              <motion.span
                animate={{ opacity: 1 }}
                className={labelClassName}
                exit={labelExit}
                initial={{ opacity: 0 }}
                layout="position"
                transition={labelTransition}
              >
                {label}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </motion.span>
      )}
    </NavLink>
  );

  return (
    <li>
      {labelled ? (
        link
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span className="block" />}>
            {link}
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
};

/**
 * Floating bottom navigation: the current route expands into icon + label
 * while the other destinations stay collapsed to their icon.
 */
export const FloatingNav = () => {
  const { t } = useTranslation();
  const navigation = useAppSelector((state) => state.settings.navigation);
  const settled = useSettled();
  const transition = settled ? springTransition : instantTransition;
  const items = useNavItems();
  const { pillTo } = useNavPill(items);
  const { headerNav, labelled } = useNavLayout();

  // "Header" means the header, but only while the header can actually carry
  // the destinations. On a narrow window it cannot, and the bar takes over
  // rather than leaving the reader with no navigation at all.
  if (navigation === "header" && headerNav) {
    return null;
  }

  return (
    // `MotionConfig reducedMotion="user"` now lives at the application root, so
    // this bar inherits it along with everything else that moves.
    //
    // `motion.nav` + `layoutScroll` is what keeps the pill's travel horizontal,
    // and it is not decoration. Motion measures every layout animation in *page*
    // coordinates: it takes the viewport box and adds the document scroll, unless
    // some ancestor in its projection tree is a scroll root. A plain `<nav>` is
    // invisible to that tree, so this bar - pinned to the viewport and never
    // actually moving - was measured 400px lower when the page happened to be
    // scrolled 400px down. Navigate from a long page to a short one, the browser
    // clamps the scroll, and the difference between the two measurements becomes
    // a vertical slide the pill was never meant to make. Hence "sometimes, from
    // below". `layoutScroll` makes Motion measure this node's scroll, and because
    // it computes to `position: fixed` it registers as a scroll root, so
    // everything inside is measured against the viewport and the only delta left
    // between two destinations is the horizontal one.
    <motion.nav
      aria-label={t("primaryNav")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      layoutScroll
    >
      {/* The bar carries `layout` because its own box changes with the
          active label; without it the surface would snap while the pill glides. */}
      <motion.ul
        // Glass, within reason. The blur is recomputed on every frame the bar
        // resizes, so the radius stays at `lg` rather than `xl` - the
        // saturation boost and the highlight along the top edge do most of the
        // work anyway, and neither costs a repaint.
        className="glass-bar pointer-events-auto relative flex max-w-full items-center gap-1 border-1.5 border-black/40 p-1.5 shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-linear-to-b before:from-white/25 before:to-transparent before:opacity-60"
        data-tour-step-id="app-nav"
        initial={false}
        layout
        style={pillRadius}
        transition={transition}
      >
        {items.map((item) => (
          <FloatingNavItem
            carriesPill={item.to === pillTo}
            item={item}
            key={item.to}
            labelled={labelled}
            transition={transition}
          />
        ))}
      </motion.ul>
    </motion.nav>
  );
};
