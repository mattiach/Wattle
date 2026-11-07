import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Backdrop } from "../components/backdrop";
import { Drift } from "../components/drift";
import { KineticText } from "../components/kinetic-text";
import { Reveal } from "../components/reveal";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { clamp, colors, ease, fonts } from "../theme";
import { scenes } from "../timeline";

const FIRST_LINE = 16;
const LINE_GAP = 34;
const RULE_AT = FIRST_LINE + LINE_GAP * 3;

const GoldRule = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [RULE_AT, RULE_AT + 36], [0, 1], {
    ...clamp,
    easing: ease,
  });

  return (
    <div
      style={{
        backgroundColor: colors.nightWattle,
        height: 2,
        margin: "56px auto 0",
        width: 260 * p,
      }}
    />
  );
};

/** Dark mode: the night palette, settings blurred far behind (screenshot 4). */
export const Privacy = () => (
  <Backdrop tone="night">
    <Sfx at={4} sound="whoosh" volume={0.2} />
    {copy.privacy.lines.map((line, i) => (
      <Sfx
        at={FIRST_LINE + i * LINE_GAP + 4}
        key={line}
        sound="tick"
        volume={0.3}
      />
    ))}
    <Drift duration={scenes.privacy} from={1.12} to={1.2}>
      <Img
        src={staticFile("screenshots/4.png")}
        style={{
          filter: "blur(22px)",
          height: "100%",
          objectFit: "cover",
          opacity: 0.22,
          width: "100%",
        }}
      />
    </Drift>
    <Drift duration={scenes.privacy} from={1} to={1.04}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {copy.privacy.lines.map((line, i) => (
          <KineticText
            delay={FIRST_LINE + i * LINE_GAP}
            key={line}
            stagger={3}
            style={{
              color: colors.nightInk,
              fontFamily: fonts.serif,
              fontSize: 124,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
            }}
            text={line}
          />
        ))}
        <GoldRule />
        <Reveal delay={RULE_AT + 14}>
          <p
            style={{
              color: colors.nightMuted,
              fontFamily: fonts.sans,
              fontSize: 32,
              margin: "40px 0 0",
            }}
          >
            {copy.privacy.footnote}
          </p>
        </Reveal>
      </AbsoluteFill>
    </Drift>
  </Backdrop>
);
