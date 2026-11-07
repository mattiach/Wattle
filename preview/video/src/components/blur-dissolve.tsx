import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import { AbsoluteFill } from "remotion";

type Props = Record<string, never>;

const BlurDissolve = ({
  children,
  presentationDirection,
  presentationProgress: p,
}: TransitionPresentationComponentProps<Props>) => {
  // The outgoing scene keeps full opacity and drifts out of focus; the
  // incoming one, drawn on top, comes into focus as it fades in. No dip to
  // black between them.
  const isExiting = presentationDirection === "exiting";

  return (
    <AbsoluteFill
      style={
        isExiting
          ? { filter: `blur(${p * 14}px)`, scale: 1 + p * 0.04 }
          : {
              filter: `blur(${(1 - p) * 14}px)`,
              opacity: p,
              scale: 1.03 - p * 0.03,
            }
      }
    >
      {children}
    </AbsoluteFill>
  );
};

export const blurDissolve = (): TransitionPresentation<Props> => ({
  component: BlurDissolve,
  props: {},
});
