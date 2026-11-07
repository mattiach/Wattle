import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import logo from "@/assets/logo/logo.svg";
import { paths } from "@/routing/paths";

/**
 * The application's name in the bar, drawn rather than set.
 *
 * `dark:invert` is the whole of how it survives every palette: the mark is two
 * tones - near-black ink and near-white paper - and inverting swaps them, so a
 * dark logo sits on a light page and a light one on a dark page. A palette only
 * changes the accent, never which of the two grounds is under it, so one class
 * covers all eight.
 *
 * Sized by height alone. The bar is 56px and the mark is 2.8:1, so a fixed
 * width would be a second number to keep in step with the first.
 */
export const Wordmark = () => {
  const { t } = useTranslation();

  return (
    <Link
      className="flex items-center gap-1.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      to={paths.app.path}
    >
      {/* The file's own dimensions, so the bar reserves the right shape before
          the image has loaded; the height class is what actually sizes it. */}
      <img
        alt={t("appName")}
        className="h-6 w-auto dark:invert"
        height={272}
        src={logo}
        width={770}
      />
      <span className="relative top-1.5 right-1 size-1.5 rounded-full bg-wattle" />
    </Link>
  );
};
