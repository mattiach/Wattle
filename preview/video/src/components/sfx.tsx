import { Audio } from "@remotion/media";
import { Sequence, staticFile } from "remotion";

interface Props {
  readonly at?: number;
  readonly sound: "chime" | "whoosh" | "tick";
  readonly volume?: number;
}

/** A one-shot sound effect at a frame of the enclosing scene. */
export const Sfx = ({ sound, at = 0, volume = 0.5 }: Props) => (
  <Sequence from={at} layout="none" name={`sfx: ${sound}`}>
    <Audio src={staticFile(`audio/${sound}.wav`)} volume={volume} />
  </Sequence>
);
