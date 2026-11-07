import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/**
 * Which destination the navigation highlight sits on.
 *
 * Not the same question as "which tab is active", and that difference is the
 * whole reason this exists. Several routes match no tab at all - an entry, a
 * spark, the spark archive - so an active-only highlight *unmounts* on them.
 * Coming back then mounts a fresh one, and a shared-layout element with no
 * previous box to travel from does not slide: it plays an entrance, which is
 * the drop-from-below this fixes.
 *
 * So the highlight is sticky. It stays on the last destination that matched
 * and merely fades while none does, which means it always has somewhere to
 * travel from and the movement is always horizontal.
 *
 * `pillTo` is seeded from the current path rather than from an effect, so the
 * bar's first paint already has it in the right place. When the application
 * opens on a route that matches no destination there is nothing to seed it
 * with, so it falls back to the first item - the homepage - and the first move
 * of the session travels from there to whatever is clicked, which is still a
 * horizontal one.
 */
export const useNavPill = (items: { to: string }[]) => {
  const { pathname } = useLocation();
  const activeTo = items.find((item) => item.to === pathname)?.to ?? null;

  const [pillTo, setPillTo] = useState(() => activeTo ?? items[0]?.to ?? "");

  useEffect(() => {
    if (activeTo) {
      setPillTo(activeTo);
    }
  }, [activeTo]);

  return { activeTo, pillTo };
};
