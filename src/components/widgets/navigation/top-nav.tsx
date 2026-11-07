import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { AppBar } from "@/components/layout/app-bar";
import { Wordmark } from "@/components/layout/wordmark";
import { instantTransition, springTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useNavItems } from "@/routing/nav-items";
import { paths } from "@/routing/paths";
import { useNavLayout } from "@/routing/hooks/use-nav-layout";
import { useNavPill } from "@/routing/hooks/use-nav-pill";

// The wordmark on the left already goes home, so that destination would only be
// a duplicate link in the bar.
const useHeaderItems = () =>
  useNavItems().filter((item) => item.to !== paths.app.path);

interface TopNavItemProps {
  /** True while this item is the one the highlight is parked on. */
  carriesPill: boolean;
  label: string;
  to: string;
  transition: typeof springTransition | typeof instantTransition;
}

const TopNavItem = ({
  carriesPill,
  label,
  to,
  transition,
}: TopNavItemProps) => (
  <li>
    <NavLink
      className="group relative block rounded-lg outline-none"
      end
      to={to}
    >
      {({ isActive }) => (
        <span
          className={cn(
            "relative flex h-7 items-center rounded-lg px-2.5 font-medium text-[0.8rem] text-muted-foreground transition-colors duration-200 ease-out-soft group-hover:text-foreground group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
            isActive && "text-foreground"
          )}
        >
          {/* The same sticky pill as the floating bar, on its own `layoutId`
              so the two can be on screen together without fighting over one
              animation. It never unmounts - the header has even more routes
              that match no tab than the bar does - so it always slides rather
              than entering. */}
          {carriesPill ? (
            <motion.span
              animate={{ opacity: isActive ? 1 : 0 }}
              className="absolute inset-0 rounded-lg bg-accent"
              initial={false}
              layoutId="top-nav-pill"
              transition={transition}
            />
          ) : null}
          <span className="relative">{label}</span>
        </span>
      )}
    </NavLink>
  </li>
);

/**
 * Header navigation. Same destinations as the floating bar - including the
 * dev-only components page - rendered as text links instead of icons, and with
 * the same pill sliding between them.
 */
export const TopNav = () => {
  const { t } = useTranslation();
  // The header arrives already lit on the current route: until the first paint
  // is behind us every transition is instant, so nothing slides into place on
  // load. After that the pill glides between destinations as usual.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const transition = settled ? springTransition : instantTransition;
  const headerItems = useHeaderItems();
  const { pillTo } = useNavPill(headerItems);
  const { headerNav } = useNavLayout();

  // Five text destinations and a wordmark do not fit a narrow window, and
  // shrinking them all until each shows two letters would be worse than not
  // showing them: the floating bar covers the same destinations as icons, and
  // it is what appears instead.
  if (!headerNav) {
    return (
      <AppBar>
        <Wordmark />
      </AppBar>
    );
  }

  return (
    <AppBar>
      <Wordmark />
      {/* The same tour anchor the bottom bar carries: whichever of the two is
          on screen is what "everywhere else" points at, and with both showing
          the step simply spotlights both. */}
      <nav aria-label={t("navigationHeader")} data-tour-step-id="app-nav">
        <ul className="flex items-center gap-0.5">
          {headerItems.map((item) => (
            <TopNavItem
              carriesPill={item.to === pillTo}
              key={item.to}
              label={t(item.labelKey)}
              to={item.to}
              transition={transition}
            />
          ))}
        </ul>
      </nav>
    </AppBar>
  );
};
