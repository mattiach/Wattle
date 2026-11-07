import type { CSSProperties } from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, colors, ease, easeInOut } from "../theme";

// Every capture in preview/screenshots is the maximised window at 2560×1368.
const SHOT_RATIO = 1368 / 2560;

const fill: CSSProperties = {
  height: "100%",
  inset: 0,
  position: "absolute",
  width: "100%",
};

type Point = readonly [x: number, y: number];

const CANVAS_WIDTH = 1920;
const BLEED_LEFT = 820;
const BLEED_TOP = 134;
const BLEED_WIDTH = 1520;
/** Percent of the window kept filled beyond the canvas edge. */
const RIGHT_MARGIN = 6;

interface Props {
  readonly delay?: number;
  /** Frames the camera move lasts; usually the scene's length. */
  readonly duration: number;
  /**
   * The point of the screenshot, in percent, that sits at the centre of the
   * window's on-screen part, start → end.
   */
  readonly focus: readonly [Point, Point];
  /** A second screenshot that cross-fades in over the first. */
  readonly next?: { readonly shot: string; readonly at: number };
  /** File in public/screenshots. */
  readonly shot: string;
  /** Window turn in degrees around Y, start → end. */
  readonly turn?: readonly [number, number];
  /**
   * Interior zoom, start → end. The captures carry wide empty margins, so
   * values from about 1.1 keep the app's content column in view; higher
   * values move in closer.
   */
  readonly zoom: readonly [number, number];
}

const clampTo = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * A real screenshot in a floating window that bleeds off the right edge,
 * entering in perspective while the camera inside it moves toward a point of
 * interest.
 */
export const AppWindow = ({
  shot,
  duration,
  zoom,
  focus,
  turn = [-14, -6],
  delay = 0,
  next,
}: Props) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [delay, delay + 50], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const move = interpolate(frame, [delay, duration], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const lerp = (a: number, b: number) => a + (b - a) * move;

  // Place the focus point at the centre of what is on screen, then clamp so
  // the image never pulls away from a visible edge. On the right that is the
  // canvas edge, not the window's: the part of the window past it is never
  // seen (the turn brings the right side closer, so less of it shows, not
  // more), and a small margin covers the rest.
  const scale = lerp(zoom[0], zoom[1]);
  const onScreen = Math.min(1, (CANVAS_WIDTH - BLEED_LEFT) / BLEED_WIDTH);
  const centreX = (onScreen * 100) / 2;
  const visibleRight = Math.min(100, onScreen * 100 + RIGHT_MARGIN);
  const x = clampTo(
    centreX - lerp(focus[0][0], focus[1][0]) * scale,
    visibleRight - 100 * scale,
    0
  );
  const y = clampTo(
    50 - lerp(focus[0][1], focus[1][1]) * scale,
    100 - 100 * scale,
    0
  );

  return (
    <div
      style={{
        backgroundColor: colors.paper,
        border: `1px solid ${colors.line}`,
        borderRadius: 18,
        boxShadow:
          "0 2px 6px oklch(0.2 0.02 70 / 6%), 0 40px 90px -20px oklch(0.2 0.02 70 / 35%)",
        height: BLEED_WIDTH * SHOT_RATIO,
        left: BLEED_LEFT,
        opacity: enter,
        overflow: "hidden",
        position: "absolute",
        top: BLEED_TOP,
        transform: `perspective(2600px) translateX(${(1 - enter) * 140}px) rotateY(${lerp(turn[0], turn[1])}deg) rotateX(${lerp(5, 2)}deg)`,
        transformOrigin: "0% 50%",
        width: BLEED_WIDTH,
      }}
    >
      <div
        style={{
          inset: 0,
          position: "absolute",
          scale,
          transformOrigin: "0 0",
          translate: `${x}% ${y}%`,
        }}
      >
        <Img src={staticFile(`screenshots/${shot}`)} style={fill} />
        {next ? (
          <Img
            src={staticFile(`screenshots/${next.shot}`)}
            style={{
              ...fill,
              opacity: interpolate(frame, [next.at, next.at + 18], [0, 1], {
                ...clamp,
                easing: ease,
              }),
            }}
          />
        ) : null}
      </div>
    </div>
  );
};
