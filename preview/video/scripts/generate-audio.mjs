// Synthesises the video's audio into public/audio as 16-bit stereo WAV.
// No samples, no downloads: everything here is sine waves, noise and a small
// Schroeder reverb, so the soundtrack carries no licence of its own.
//
//   node scripts/generate-audio.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44_100;
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "audio"
);
const TAU = Math.PI * 2;

const writeWav = (name, left, right) => {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32_767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32_767), 46 + i * 4);
  }
  writeFileSync(join(OUT, name), buf);
};

const normalize = (left, right, peak) => {
  let max = 0;
  for (let i = 0; i < left.length; i += 1) {
    max = Math.max(max, Math.abs(left[i]), Math.abs(right[i]));
  }
  const k = max > 0 ? peak / max : 1;
  for (let i = 0; i < left.length; i += 1) {
    left[i] *= k;
    right[i] *= k;
  }
};

// Schroeder reverb: four damped combs into two allpasses, per channel.
const reverb = (input, offset, feedback = 0.84, damp = 0.35) => {
  const out = new Float32Array(input.length);
  for (const d of [1557, 1617, 1491, 1422]) {
    const size = d + offset;
    const line = new Float32Array(size);
    let idx = 0;
    let store = 0;
    for (let i = 0; i < input.length; i += 1) {
      const y = line[idx];
      store = y * (1 - damp) + store * damp;
      line[idx] = input[i] + store * feedback;
      out[i] += y / 4;
      idx = (idx + 1) % size;
    }
  }
  for (const d of [225, 556]) {
    const size = d + offset;
    const line = new Float32Array(size);
    let idx = 0;
    for (let i = 0; i < out.length; i += 1) {
      const buffered = line[idx];
      const x = out[i];
      out[i] = buffered - x;
      line[idx] = x + buffered * 0.5;
      idx = (idx + 1) % size;
    }
  }
  return out;
};

const withReverb = (left, right, wet) => {
  const wl = reverb(left, 0);
  const wr = reverb(right, 23);
  for (let i = 0; i < left.length; i += 1) {
    left[i] = left[i] * (1 - wet) + wl[i] * wet;
    right[i] = right[i] * (1 - wet) + wr[i] * wet;
  }
};

// --- Ambient pad -----------------------------------------------------------
// D major, warm and unresolved until the end: Dmaj9 → Bm9 → Gmaj7 → Asus.
const CHORDS = [
  [146.83, 220.0, 329.63, 369.99, 554.37],
  [123.47, 185.0, 293.66, 440.0, 554.37],
  [98.0, 146.83, 246.94, 369.99, 440.0],
  [110.0, 164.81, 246.94, 293.66, 369.99],
];
const PAD_SECONDS = 54;
const CHORD_SECONDS = 6.5;
const FADE = 2.6;

const pad = () => {
  const n = PAD_SECONDS * SR;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const count = Math.ceil(PAD_SECONDS / CHORD_SECONDS);
  for (let c = 0; c < count; c += 1) {
    // The last chord returns home to D.
    const notes = c === count - 1 ? CHORDS[0] : CHORDS[c % CHORDS.length];
    const start = c * CHORD_SECONDS - FADE / 2;
    const end = start + CHORD_SECONDS + FADE;
    const from = Math.max(0, Math.floor(start * SR));
    const to = Math.min(n, Math.floor(end * SR));
    for (let i = from; i < to; i += 1) {
      const t = i / SR;
      const local = t - start;
      const span = end - start;
      // Equal-power swell in and out; flat in between.
      const edge = Math.min(local, span - local, FADE);
      const env = Math.sin((edge / FADE) * (Math.PI / 2)) ** 2;
      notes.forEach((f, k) => {
        const lfo = 0.85 + 0.15 * Math.sin(TAU * (0.07 + k * 0.013) * t + k);
        const v =
          Math.sin(TAU * f * t) +
          0.6 * Math.sin(TAU * f * 1.0035 * t + k) +
          0.12 * Math.sin(TAU * f * 2 * t);
        const s = (v * env * lfo) / (notes.length * 2.4);
        const pan = 0.5 + (k % 2 === 0 ? -0.22 : 0.22);
        left[i] += s * (1 - pan);
        right[i] += s * pan;
      });
    }
  }
  // A low D drone under everything.
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const d = 0.05 * Math.sin(TAU * 73.42 * t);
    left[i] += d;
    right[i] += d;
  }
  withReverb(left, right, 0.45);
  // Fade the file itself in and out; the video adds its own fades on top.
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const g = Math.min(1, t / 3, (PAD_SECONDS - t) / 4);
    left[i] *= g;
    right[i] *= g;
  }
  normalize(left, right, 0.7);
  writeWav("ambient.wav", left, right);
};

// --- Chime: two soft bell tones, E5 then B5 -------------------------------
const chime = () => {
  const n = 3.5 * SR;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const partials = [
    [1, 1],
    [2, 0.25],
    [3.01, 0.1],
    [4.16, 0.06],
  ];
  for (const [f0, delay, pan] of [
    [659.25, 0, 0.42],
    [987.77, 0.14, 0.58],
  ]) {
    for (let i = Math.floor(delay * SR); i < n; i += 1) {
      const t = i / SR - delay;
      const attack = Math.min(1, t / 0.004);
      let s = 0;
      for (const [ratio, amp] of partials) {
        s += amp * Math.exp(-t * 2.2 * ratio) * Math.sin(TAU * f0 * ratio * t);
      }
      left[i] += s * attack * (1 - pan);
      right[i] += s * attack * pan;
    }
  }
  withReverb(left, right, 0.4);
  normalize(left, right, 0.6);
  writeWav("chime.wav", left, right);
};

// --- Whoosh: swept, low-passed noise that pans across ---------------------
const whoosh = () => {
  const seconds = 1.6;
  const n = Math.floor(seconds * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647 - 0.5;
  };
  let lp = 0;
  let lpLow = 0;
  for (let i = 0; i < n; i += 1) {
    const p = i / n;
    const shape = Math.sin(Math.PI * p ** 0.8) ** 2;
    const cutoff = 250 + 2600 * shape;
    lp += (1 - Math.exp((-TAU * cutoff) / SR)) * (random() - lp);
    lpLow += (1 - Math.exp((-TAU * 140) / SR)) * (lp - lpLow);
    const s = (lp - lpLow) * shape;
    const pan = 0.25 + 0.5 * p;
    left[i] = s * (1 - pan);
    right[i] = s * pan;
  }
  withReverb(left, right, 0.25);
  normalize(left, right, 0.5);
  writeWav("whoosh.wav", left, right);
};

// --- Tick: a quiet, rounded tap -------------------------------------------
const tick = () => {
  const n = Math.floor(0.6 * SR);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const s =
      Math.exp(-t * 55) * Math.sin(TAU * 1320 * t) +
      0.6 * Math.exp(-t * 30) * Math.sin(TAU * 440 * t);
    left[i] = s * Math.min(1, t / 0.002);
    right[i] = left[i];
  }
  withReverb(left, right, 0.3);
  normalize(left, right, 0.45);
  writeWav("tick.wav", left, right);
};

mkdirSync(OUT, { recursive: true });
pad();
chime();
whoosh();
tick();
