import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { colors } from "../theme";

interface Props {
  readonly children?: ReactNode;
  readonly tone?: "paper" | "night";
}

/** Paper (or night) ground with a soft vignette and moving film grain. */
export const Backdrop = ({ tone = "paper", children }: Props) => {
  const frame = useCurrentFrame();
  const isNight = tone === "night";

  return (
    <AbsoluteFill
      style={{ backgroundColor: isNight ? colors.night : colors.paper }}
    >
      {children}
      <AbsoluteFill
        style={{
          background: isNight
            ? "radial-gradient(ellipse at 50% 45%, transparent 40%, oklch(0 0 0 / 55%) 100%)"
            : "radial-gradient(ellipse at 50% 45%, transparent 55%, oklch(0.4 0.03 70 / 14%) 100%)",
          pointerEvents: "none",
        }}
      />
      <svg
        aria-hidden="true"
        height="100%"
        style={{
          inset: 0,
          mixBlendMode: isNight ? "screen" : "multiply",
          opacity: isNight ? 0.07 : 0.05,
          pointerEvents: "none",
          position: "absolute",
        }}
        width="100%"
      >
        <filter id={`grain-${tone}`}>
          <feTurbulence
            baseFrequency="0.85"
            numOctaves="2"
            seed={frame % 12}
            stitchTiles="stitch"
            type="fractalNoise"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect filter={`url(#grain-${tone})`} height="100%" width="100%" />
      </svg>
    </AbsoluteFill>
  );
};
