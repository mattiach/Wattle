import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/backdrop";
import { Drift } from "../components/drift";
import { KineticText } from "../components/kinetic-text";
import { Reveal } from "../components/reveal";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { clamp, colors, ease, fonts } from "../theme";
import { scenes } from "../timeline";

const FIRST_ITEM = 58;
const ITEM_GAP = 34;

const Rule = ({ delay }: { readonly delay: number }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + 34], [0, 1], {
    ...clamp,
    easing: ease,
  });

  return (
    <div
      style={{
        backgroundColor: colors.wattle,
        height: 2,
        marginBottom: 32,
        width: `${p * 100}%`,
      }}
    />
  );
};

/**
 * On This Day, Echo and Calendar have no screenshots yet, so they are told in
 * type alone rather than with an invented interface.
 */
export const Remember = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.2} />
    {copy.remember.items.map((item, i) => (
      <Sfx
        at={FIRST_ITEM + i * ITEM_GAP}
        key={item.title}
        sound="tick"
        volume={0.18}
      />
    ))}
    <Drift duration={scenes.remember} from={1} to={1.04}>
      <AbsoluteFill
        style={{ alignItems: "center", paddingTop: 210, textAlign: "center" }}
      >
        <Reveal delay={4} distance={12}>
          <div
            style={{
              color: colors.wattleInk,
              fontFamily: fonts.sans,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            {copy.remember.eyebrow}
          </div>
        </Reveal>
        <KineticText
          delay={12}
          style={{
            color: colors.ink,
            fontFamily: fonts.serif,
            fontSize: 88,
            letterSpacing: "-0.015em",
            marginTop: 30,
          }}
          text={copy.remember.headline}
        />
        <div
          style={{
            display: "flex",
            gap: 96,
            marginTop: 130,
            textAlign: "left",
          }}
        >
          {copy.remember.items.map((item, i) => {
            const delay = FIRST_ITEM + i * ITEM_GAP;
            return (
              <div key={item.title} style={{ width: 460 }}>
                <Rule delay={delay} />
                <Reveal delay={delay + 6}>
                  <div
                    style={{
                      color: colors.ink,
                      fontFamily: fonts.serif,
                      fontSize: 56,
                      fontWeight: 500,
                    }}
                  >
                    {item.title}
                  </div>
                  <p
                    style={{
                      color: colors.muted,
                      fontFamily: fonts.sans,
                      fontSize: 28,
                      lineHeight: 1.5,
                      margin: "18px 0 0",
                    }}
                  >
                    {item.body}
                  </p>
                </Reveal>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Drift>
  </Backdrop>
);
