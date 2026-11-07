import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { blurDissolve } from "./components/blur-dissolve";
import { Closing } from "./scenes/closing";
import { Intro } from "./scenes/intro";
import { Letters } from "./scenes/letters";
import { LocalAi } from "./scenes/local-ai";
import { Opening } from "./scenes/opening";
import { Pages } from "./scenes/pages";
import { Privacy } from "./scenes/privacy";
import { Remember } from "./scenes/remember";
import { Sparks } from "./scenes/sparks";
import { clamp, easeInOut } from "./theme";
import { scenes, TOTAL_FRAMES, TRANSITION } from "./timeline";

const MUSIC_FADE_IN = 30;
const MUSIC_FADE_OUT = 60;
const MUSIC_LEVEL = 0.55;

const musicVolume = (f: number) =>
  MUSIC_LEVEL *
  interpolate(
    f,
    [0, MUSIC_FADE_IN, TOTAL_FRAMES - MUSIC_FADE_OUT, TOTAL_FRAMES],
    [0, 1, 1, 0],
    clamp
  );

const cut = (
  <TransitionSeries.Transition
    presentation={blurDissolve()}
    timing={linearTiming({ durationInFrames: TRANSITION, easing: easeInOut })}
  />
);

export const Wattle = () => (
  <AbsoluteFill>
    <Audio src={staticFile("audio/ambient.wav")} volume={musicVolume} />
    <TransitionSeries>
      <TransitionSeries.Sequence
        durationInFrames={scenes.opening}
        name="Opening"
      >
        <Opening />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence durationInFrames={scenes.intro} name="Logo">
        <Intro />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence durationInFrames={scenes.pages} name="Pages">
        <Pages />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence durationInFrames={scenes.sparks} name="Sparks">
        <Sparks />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence
        durationInFrames={scenes.letters}
        name="Letters"
      >
        <Letters />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence
        durationInFrames={scenes.remember}
        name="Remember"
      >
        <Remember />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence
        durationInFrames={scenes.privacy}
        name="Privacy"
      >
        <Privacy />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence durationInFrames={scenes.ai} name="Local AI">
        <LocalAi />
      </TransitionSeries.Sequence>
      {cut}
      <TransitionSeries.Sequence
        durationInFrames={scenes.closing}
        name="Closing"
      >
        <Closing />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
