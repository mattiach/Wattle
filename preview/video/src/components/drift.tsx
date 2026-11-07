import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp } from "../theme";

interface Props {
  readonly children: ReactNode;
  readonly duration: number;
  readonly from?: number;
  readonly to?: number;
}

/** A slow, constant push-in so no frame of the film sits still. */
export const Drift = ({ duration, from = 1, to = 1.04, children }: Props) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        scale: interpolate(frame, [0, duration], [from, to], clamp),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
