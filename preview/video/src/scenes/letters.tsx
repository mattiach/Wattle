import { AppWindow } from "../components/app-window";
import { Backdrop } from "../components/backdrop";
import { FeatureLayout } from "../components/feature-layout";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { scenes } from "../timeline";

/** A new letter, the camera settling on its prompt (screenshot 3). */
export const Letters = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.2} />
    <FeatureLayout
      body={copy.letters.body}
      eyebrow={copy.letters.eyebrow}
      title={copy.letters.title}
    >
      <AppWindow
        duration={scenes.letters}
        focus={[
          [50, 40],
          [46, 45],
        ]}
        shot="3.png"
        zoom={[1.12, 1.3]}
      />
    </FeatureLayout>
  </Backdrop>
);
