import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clamp, colors, ease, fonts } from "../theme";
import { KineticText } from "./kinetic-text";
import { Reveal } from "./reveal";

interface Props {
  readonly accent?: string;
  readonly body?: string;
  /** The visual on the right: a window, a typed line. */
  readonly children: ReactNode;
  /** Extra lines under the body, e.g. a list of points. */
  readonly extra?: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
}

const TEXT_LEFT = 150;
const TEXT_WIDTH = 640;

/** Editorial split: the words on the left, the thing itself on the right. */
export const FeatureLayout = ({
  eyebrow,
  title,
  body,
  accent = colors.wattleInk,
  extra,
  children,
}: Props) => {
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [6, 40], [0, 1], { ...clamp, easing: ease });

  return (
    <>
      {children}
      <div
        style={{
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          left: TEXT_LEFT,
          position: "absolute",
          top: 0,
          width: TEXT_WIDTH,
        }}
      >
        <Reveal delay={4} distance={12}>
          <div
            style={{
              alignItems: "center",
              color: accent,
              display: "flex",
              fontFamily: fonts.sans,
              fontSize: 22,
              fontWeight: 600,
              gap: 18,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                backgroundColor: accent,
                height: 2,
                width: 48 * rule,
              }}
            />
            {eyebrow}
          </div>
        </Reveal>
        <KineticText
          delay={12}
          style={{
            color: colors.ink,
            fontFamily: fonts.serif,
            fontSize: title.length > 12 ? 84 : 128,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.02,
            marginTop: 28,
          }}
          text={title}
        />
        {body ? (
          <Reveal delay={30}>
            <p
              style={{
                color: colors.muted,
                fontFamily: fonts.sans,
                fontSize: 32,
                lineHeight: 1.45,
                margin: "36px 0 0",
              }}
            >
              {body}
            </p>
          </Reveal>
        ) : null}
        {extra}
      </div>
    </>
  );
};
