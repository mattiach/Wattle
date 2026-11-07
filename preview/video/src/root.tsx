import { Composition, Folder } from "remotion";
import { Closing } from "./scenes/closing";
import { Intro } from "./scenes/intro";
import { Letters } from "./scenes/letters";
import { LocalAi } from "./scenes/local-ai";
import { Opening } from "./scenes/opening";
import { Pages } from "./scenes/pages";
import { Privacy } from "./scenes/privacy";
import { Remember } from "./scenes/remember";
import { Sparks } from "./scenes/sparks";
import { FPS, scenes, TOTAL_FRAMES } from "./timeline";
import { Wattle } from "./wattle";

const size = { fps: FPS, height: 1080, width: 1920 } as const;

export const RemotionRoot = () => (
  <>
    <Composition
      component={Wattle}
      durationInFrames={TOTAL_FRAMES}
      id="Wattle"
      {...size}
    />
    {/* Each scene on its own, for working on one without scrubbing the film. */}
    <Folder name="Scenes">
      <Composition
        component={Opening}
        durationInFrames={scenes.opening}
        id="Opening"
        {...size}
      />
      <Composition
        component={Intro}
        durationInFrames={scenes.intro}
        id="Logo"
        {...size}
      />
      <Composition
        component={Pages}
        durationInFrames={scenes.pages}
        id="Pages"
        {...size}
      />
      <Composition
        component={Sparks}
        durationInFrames={scenes.sparks}
        id="Sparks"
        {...size}
      />
      <Composition
        component={Letters}
        durationInFrames={scenes.letters}
        id="Letters"
        {...size}
      />
      <Composition
        component={Remember}
        durationInFrames={scenes.remember}
        id="Remember"
        {...size}
      />
      <Composition
        component={Privacy}
        durationInFrames={scenes.privacy}
        id="Privacy"
        {...size}
      />
      <Composition
        component={LocalAi}
        durationInFrames={scenes.ai}
        id="LocalAi"
        {...size}
      />
      <Composition
        component={Closing}
        durationInFrames={scenes.closing}
        id="Closing"
        {...size}
      />
    </Folder>
  </>
);
