import { AppWindow } from "../components/app-window";
import { Backdrop } from "../components/backdrop";
import { FeatureLayout } from "../components/feature-layout";
import { Reveal } from "../components/reveal";
import { Sfx } from "../components/sfx";
import { copy } from "../copy";
import { colors, fonts } from "../theme";
import { scenes } from "../timeline";

const FIRST_POINT = 36;
const POINT_GAP = 14;

/**
 * AI settings (screenshot 5), the camera settling on "A model running on this
 * device". Everything AI uses --assist, never the wattle accent.
 */
export const LocalAi = () => (
  <Backdrop>
    <Sfx at={4} sound="whoosh" volume={0.2} />
    <FeatureLayout
      accent={colors.assist}
      extra={
        <div style={{ marginTop: 44 }}>
          {copy.ai.points.map((point, i) => (
            <Reveal delay={FIRST_POINT + i * POINT_GAP} key={point}>
              <div
                style={{
                  alignItems: "baseline",
                  color: colors.muted,
                  display: "flex",
                  fontFamily: fonts.sans,
                  fontSize: 30,
                  gap: 20,
                  lineHeight: 1.4,
                  marginTop: 18,
                }}
              >
                <span
                  style={{
                    backgroundColor: colors.assist,
                    borderRadius: "50%",
                    flexShrink: 0,
                    height: 9,
                    translate: "0 -4px",
                    width: 9,
                  }}
                />
                {point}
              </div>
            </Reveal>
          ))}
        </div>
      }
      eyebrow={copy.ai.eyebrow}
      title={copy.ai.title}
    >
      <AppWindow
        duration={scenes.ai}
        focus={[
          [50, 45],
          [48, 26],
        ]}
        shot="5.png"
        zoom={[1.12, 1.28]}
      />
    </FeatureLayout>
  </Backdrop>
);
