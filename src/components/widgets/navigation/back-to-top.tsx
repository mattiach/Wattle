import { ArrowUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { arrivalTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";

/** Far enough down that the control only appears once the top is out of sight. */
const REVEAL_AT = 400;

const scrollToTop = () => window.scrollTo({ behavior: "smooth", top: 0 });

/**
 * Returns to the top of a long page. It stays out of the way until there is
 * something to return from, which is why it appears on scroll rather than
 * sitting in the header.
 */
export const BackToTop = () => {
  const { t } = useTranslation();
  const navigation = useAppSelector((state) => state.settings.navigation);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > REVEAL_AT);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "fixed right-4 z-20",
            // Clear of the floating bar when there is one, otherwise level
            // with where that bar would have sat.
            navigation === "header"
              ? "bottom-[max(1rem,env(safe-area-inset-bottom))]"
              : "bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4rem))]"
          )}
          exit={{ opacity: 0, y: 8 }}
          initial={{ opacity: 0, y: 8 }}
          transition={arrivalTransition}
        >
          {/* Literally the same glass the floating nav is made of - one
              utility, so the two cannot stop reading as one layer. */}
          <Button
            aria-label={t("backToTop")}
            className="glass-bar size-9 rounded-full text-muted-foreground"
            onClick={scrollToTop}
            type="button"
            variant="ghost"
          >
            <ArrowUp />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
