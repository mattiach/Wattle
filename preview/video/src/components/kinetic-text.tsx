import type { CSSProperties } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clamp, ease } from "../theme";

interface Props {
  /** Frame the first word starts arriving. */
  readonly delay?: number;
  /** Frames each word takes to settle. */
  readonly duration?: number;
  /** Frames between consecutive words. */
  readonly stagger?: number;
  readonly style?: CSSProperties;
  readonly text: string;
}

/** Words rise out of a blur one after another. */
export const KineticText = ({
  text,
  delay = 0,
  stagger = 4,
  duration = 26,
  style,
}: Props) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");

  return (
    <span style={{ display: "inline-block", ...style }}>
      {words.map((word, i) => {
        const start = delay + i * stagger;
        const p = interpolate(frame, [start, start + duration], [0, 1], {
          ...clamp,
          easing: ease,
        });
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: words can repeat and never reorder; position is their identity.
            key={`${i}-${word}`}
            style={{
              display: "inline-block",
              filter: `blur(${(1 - p) * 10}px)`,
              opacity: p,
              translate: `0 ${(1 - p) * 0.4}em`,
              whiteSpace: "pre",
            }}
          >
            {word}
            {i < words.length - 1 && " "}
          </span>
        );
      })}
    </span>
  );
};
