import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, colors, ease, easeInOut } from "../theme";

// public/logo.svg is src/assets/logo/logo.svg (770×272) with its paper tone
// set to the video paper, so the counters vanish into the ground.
const LOGO_RATIO = 770 / 272;

interface Props {
  readonly delay?: number;
  readonly height: number;
}

/**
 * The wordmark, written on left to right, then the wattle dot lands.
 * The dot's size and offset follow src/components/layout/wordmark.tsx: a
 * quarter of the mark's height, sitting low beside the last letter.
 */
export const Logo = ({ height, delay = 0 }: Props) => {
  const frame = useCurrentFrame();
  const width = height * LOGO_RATIO;
  const write = interpolate(frame, [delay, delay + 46], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const dot = interpolate(frame, [delay + 40, delay + 62], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const dotSize = height * 0.25;

  return (
    <div style={{ height, position: "relative", width: width + dotSize }}>
      <Img
        src={staticFile("logo.svg")}
        style={{
          clipPath: `inset(-10% ${(1 - write) * 100}% -10% 0)`,
          filter: `blur(${(1 - write) * 4}px)`,
          height,
          width,
        }}
      />
      <div
        style={{
          backgroundColor: colors.wattle,
          borderRadius: "50%",
          height: dotSize,
          left: width + height * 0.08,
          opacity: dot,
          position: "absolute",
          scale: interpolate(dot, [0, 1], [0.2, 1]),
          top: height * 0.75 - dotSize / 2,
          translate: `0 ${(1 - dot) * -height * 0.4}px`,
          width: dotSize,
        }}
      />
    </div>
  );
};
