import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/backdrop";
import { Drift } from "../components/drift";
import { KineticText } from "../components/kinetic-text";
import { Logo } from "../components/logo";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { clamp, colors, easeInOut, fonts } from "../theme";
import { scenes } from "../timeline";

const FIRST_PHRASE = 64;
const PHRASE_GAP = 18;
const FADE_OUT = 30;

const Content = () => {
  const frame = useCurrentFrame();
  const out = interpolate(
    frame,
    [scenes.closing - FADE_OUT, scenes.closing],
    [1, 0],
    { ...clamp, easing: easeInOut }
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        gap: 64,
        justifyContent: "center",
        opacity: out,
      }}
    >
      <Logo delay={8} height={150} />
      <div style={{ display: "flex", gap: 28 }}>
        {copy.closing.phrases.map((phrase, i) => (
          <KineticText
            delay={FIRST_PHRASE + i * PHRASE_GAP}
            key={phrase}
            style={{
              color:
                i === copy.closing.phrases.length - 1
                  ? colors.wattleInk
                  : colors.ink,
              fontFamily: fonts.serif,
              fontSize: 56,
              fontStyle: "italic",
            }}
            text={phrase}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Closing = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.18} />
    <Sfx at={48} sound="chime" volume={0.5} />
    <Drift duration={scenes.closing} from={1.04} to={1}>
      <Content />
    </Drift>
  </Backdrop>
);
