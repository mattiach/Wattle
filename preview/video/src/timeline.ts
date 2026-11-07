// Scene lengths in frames at 30 fps. Transitions overlap neighbouring scenes,
// so the video is the sum of scenes minus one transition per cut.
export const FPS = 30;
export const TRANSITION = 20;

export const scenes = {
  ai: 190,
  closing: 200,
  intro: 150,
  letters: 160,
  opening: 180,
  pages: 175,
  privacy: 200,
  remember: 240,
  sparks: 130,
} as const;

const sceneCount = Object.keys(scenes).length;

export const TOTAL_FRAMES =
  Object.values(scenes).reduce((sum, d) => sum + d, 0) -
  TRANSITION * (sceneCount - 1);
