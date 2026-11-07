import { AbsoluteFill } from "remotion";
import { Backdrop } from "../components/backdrop";
import { Drift } from "../components/drift";
import { KineticText } from "../components/kinetic-text";
import { Logo } from "../components/logo";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { colors, fonts } from "../theme";
import { scenes } from "../timeline";

export const Intro = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.18} />
    <Sfx at={50} sound="chime" volume={0.45} />
    <Drift duration={scenes.intro} from={1} to={1.05}>
      <AbsoluteFill
        style={{ alignItems: "center", gap: 56, justifyContent: "center" }}
      >
        <Logo delay={10} height={170} />
        <KineticText
          delay={66}
          stagger={3}
          style={{
            color: colors.muted,
            fontFamily: fonts.sans,
            fontSize: 34,
            letterSpacing: "0.01em",
          }}
          text={copy.intro.tagline}
        />
      </AbsoluteFill>
    </Drift>
  </Backdrop>
);
