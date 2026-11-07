import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/backdrop";
import { Drift } from "../components/drift";
import { KineticText } from "../components/kinetic-text";
import { copy } from "../copy";
import { clamp, colors, easeInOut, fonts } from "../theme";
import { scenes } from "../timeline";

const line = {
  color: colors.ink,
  fontFamily: fonts.serif,
  fontSize: 96,
  fontWeight: 400,
  letterSpacing: "-0.015em",
  lineHeight: 1.15,
} as const;

/** The last word drifts apart and fades, as the line says it would. */
const Vanishing = ({ text }: { readonly text: string }) => {
  const frame = useCurrentFrame();
  const gone = interpolate(frame, [118, 168], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });

  return (
    <span
      style={{
        display: "inline-block",
        filter: `blur(${gone * 16}px)`,
        opacity: 1 - gone,
        // Transforms only: spacing the letters would re-centre the line.
        scale: 1 + gone * 0.12,
        transformOrigin: "0% 50%",
        translate: `${gone * 0.4}em 0`,
      }}
    >
      <KineticText delay={84} text={text} />
    </span>
  );
};

export const Opening = () => (
  <Backdrop>
    <Drift duration={scenes.opening} from={1.02} to={1.07}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <KineticText
          delay={10}
          stagger={6}
          style={line}
          text={copy.opening.first}
        />
        <div style={{ ...line, fontStyle: "italic" }}>
          <KineticText
            delay={62}
            stagger={6}
            text={`${copy.opening.second} `}
          />
          <Vanishing text={copy.opening.vanishing} />
        </div>
      </AbsoluteFill>
    </Drift>
  </Backdrop>
);
