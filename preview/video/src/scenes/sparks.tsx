import { interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/backdrop";
import { FeatureLayout } from "../components/feature-layout";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { clamp, colors, ease, fonts } from "../theme";

const CARET_PERIOD = 30;

/**
 * There is no Sparks screenshot yet, so this scene draws no app UI: only a
 * line being written beside the wattle-coloured rail sparks use in the app.
 */
const TypedSpark = ({ text }: { readonly text: string }) => {
  const frame = useCurrentFrame();
  const rail = interpolate(frame, [14, 44], [0, 1], { ...clamp, easing: ease });
  const typed = interpolate(frame, [34, 96], [0, text.length], clamp);
  const shown = Math.floor(typed);
  // The letter being typed fades in rather than popping.
  const arriving = typed - shown;
  const caretOn =
    frame % CARET_PERIOD < CARET_PERIOD / 2 || shown < text.length;

  return (
    <div
      style={{
        alignItems: "center",
        bottom: 0,
        display: "flex",
        left: 880,
        position: "absolute",
        right: 140,
        top: 0,
      }}
    >
      {/* The rail stretches to the full text, which is laid out from the
          start (untyped letters are invisible) so nothing reflows. */}
      <div style={{ alignItems: "stretch", display: "flex", gap: 48 }}>
        <div
          style={{
            backgroundColor: colors.wattle,
            borderRadius: 2,
            flexShrink: 0,
            scale: `1 ${rail}`,
            transformOrigin: "50% 0%",
            width: 4,
          }}
        />
        <div
          style={{
            color: colors.ink,
            fontFamily: fonts.serif,
            fontSize: 64,
            lineHeight: 1.3,
            opacity: rail,
          }}
        >
          {/* Only plain inline spans here: an inline-block (or any box) between
              two letters is a line-break opportunity, and a half-typed word
              would wrap early and snap back as it completes. */}
          {text.slice(0, shown)}
          <span style={{ opacity: arriving }}>
            {text.slice(shown, shown + 1)}
          </span>
          <span style={{ position: "relative" }}>
            <span
              style={{
                backgroundColor: colors.ink,
                height: "0.95em",
                left: 2,
                opacity: caretOn ? 0.8 : 0,
                position: "absolute",
                top: "0.14em",
                width: 3,
              }}
            />
          </span>
          <span style={{ opacity: 0 }}>{text.slice(shown + 1)}</span>
        </div>
      </div>
    </div>
  );
};

export const Sparks = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.2} />
    <FeatureLayout
      body={copy.sparks.body}
      eyebrow={copy.sparks.eyebrow}
      title={copy.sparks.title}
    >
      <TypedSpark text={copy.sparks.example} />
    </FeatureLayout>
  </Backdrop>
);
