import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/layout/page-header";
import { PageIntro } from "@/components/layout/page-intro";
import { registry } from "@/components/development/registry";

/**
 * A gallery of the reusable pieces, for whoever picks this codebase up next.
 *
 * Reachable only when `NODE_ENV=development` in `.env` - the route and the
 * navigation entry are gated by the same value, so it can never be reachable
 * by URL while its tab is hidden.
 */
export const ComponentsPage = () => {
  const { t } = useTranslation();

  return (
    <main className="mx-auto w-full max-w-column flex-1 px-6 pb-28">
      <PageHeader
        description={t("components.subtitle")}
        title={t("components.title")}
      />

      <div className="mt-8 flex flex-col gap-8">
        {registry.map(({ name, component: Component }, index) => (
          <PageIntro delay={0.04 * (index + 1)} key={name}>
            <section>
              <h2 className="font-heading font-medium text-[1.05rem] text-foreground leading-none">
                {name}
              </h2>
              <div className="mt-3 rounded-xl border border-hairline bg-card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Component />
                </div>
              </div>
            </section>
          </PageIntro>
        ))}
      </div>
    </main>
  );
};
