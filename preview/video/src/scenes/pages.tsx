import { AppWindow } from "../components/app-window";
import { Backdrop } from "../components/backdrop";
import { FeatureLayout } from "../components/feature-layout";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { scenes } from "../timeline";

/** Home, then a new page with the / menu open (screenshots 1 and 2). */
export const Pages = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.2} />
    <FeatureLayout
      body={copy.pages.body}
      eyebrow={copy.pages.eyebrow}
      title={copy.pages.title}
    >
      <AppWindow
        duration={scenes.pages}
        focus={[
          [55, 38],
          [42, 56],
        ]}
        next={{ at: 78, shot: "2.png" }}
        shot="1.png"
        zoom={[1.12, 1.35]}
      />
    </FeatureLayout>
  </Backdrop>
);
