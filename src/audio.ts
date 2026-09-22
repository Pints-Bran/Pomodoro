/** A four-note voicing per bar; its lowest note also sets the bass line. */
type Chord = readonly [number, number, number, number];

/** One original instrumental loop: its tempo, harmony and texture. */
export interface Track {
  readonly id: string;
  readonly name: string;
  readonly mood: string;
  readonly bpm: number;
  readonly chords: readonly Chord[];
  readonly keys: number;
  readonly bass: number;
  readonly melody: number;
  readonly kick: number;
  readonly snare: number;
  readonly hat: number;
  readonly hiss: number;
  /** 0 keeps the mix bright; higher values roll the top off for a warmer room. */
  readonly warmth: number;
  /** How quickly plucked notes fall away; higher is shorter. */
  readonly decay: number;
}

export const TRACKS = [
  {
    id: "still",
    name: "Still",
    mood: "warm keys and soft brushes",
    bpm: 72,
    chords: [
      [53, 57, 60, 64],
      [50, 53, 57, 60],
      [45, 52, 55, 59],
      [48, 52, 55, 62],
    ],
    keys: 0.075,
    bass: 0.16,
    melody: 0.032,
    kick: 0.22,
    snare: 0.075,
    hat: 0.021,
    hiss: 0.0015,
    warmth: 0,
    decay: 2.1,
  },
  {
    id: "dusk",
    name: "Dusk",
    mood: "slow and low, after hours",
    bpm: 63,
    chords: [
      [50, 57, 60, 65],
      [46, 53, 57, 62],
      [50, 55, 58, 62],
      [45, 52, 55, 60],
    ],
    keys: 0.082,
    bass: 0.17,
    melody: 0.024,
    kick: 0.18,
    snare: 0.058,
    hat: 0.016,
    hiss: 0.0028,
    warmth: 0.45,
    decay: 1.7,
  },
  {
    id: "rain",
    name: "Rain",
    mood: "washed out, gentle static",
    bpm: 68,
    chords: [
      [48, 55, 59, 62],
      [45, 52, 55, 60],
      [53, 57, 60, 64],
      [50, 55, 57, 62],
    ],
    keys: 0.07,
    bass: 0.14,
    melody: 0.04,
    kick: 0.16,
    snare: 0.09,
    hat: 0.03,
    hiss: 0.0045,
    warmth: 0.3,
    decay: 1.9,
  },
  {
    id: "drift",
    name: "Drift",
    mood: "brighter, a little more lift",
    bpm: 82,
    chords: [
      [48, 55, 59, 64],
      [52, 59, 62, 67],
      [45, 52, 59, 62],
      [53, 57, 60, 64],
    ],
    keys: 0.068,
    bass: 0.15,
    melody: 0.045,
    kick: 0.2,
    snare: 0.07,
    hat: 0.026,
    hiss: 0.0012,
    warmth: 0.1,
    decay: 2.6,
  },
] as const satisfies readonly Track[];

export const DEFAULT_TRACK: Track = TRACKS[0];

/** Resolve a stored or user-supplied id, falling back to the default track. */
export function findTrack(id: string): Track {
  return TRACKS.find((track) => track.id === id) ?? DEFAULT_TRACK;
}

/** The menu entry that hands the choice of loop back to the app. */
export const SHUFFLE = "shuffle";

/** What the track menu holds: one fixed loop, or the shuffling rotation. */
export type TrackChoice = typeof SHUFFLE | (typeof TRACKS)[number]["id"];

/** One loop on repeat for hours wears thin, so rotation is the starting point. */
export const DEFAULT_CHOICE: TrackChoice = SHUFFLE;

/** Resolve a stored or user-supplied preference; anything unknown shuffles. */
export function findChoice(id: string): TrackChoice {
  if (id === SHUFFLE) return SHUFFLE;
  return TRACKS.find((track) => track.id === id)?.id ?? DEFAULT_CHOICE;
}

/** A random loop, never the one already sounding, so a rotation is audible. */
export function pickTrack(playing?: string): Track {
  const pool = TRACKS.filter((track) => track.id !== playing);
  const options = pool.length > 0 ? pool : TRACKS;
  return options[Math.floor(Math.random() * options.length)] ?? DEFAULT_TRACK;
}

/**
 * How many times the loop walks its chord progression before repeating. One
 * pass is roughly thirteen seconds, short enough to notice looping over a
 * 25-minute session, so each pass is voiced differently.
 */
const PASSES = 3;

/** Beat offsets the bass note lands on, per pass. */
const BASS: readonly (readonly number[])[] = [
  [0, 2.5],
  [0, 2.5, 3.75],
  [0, 1.75],
];

/** Beat offset and chord tone for each melody note, per pass. */
const MELODY: readonly (readonly (readonly [number, 1 | 2 | 3])[])[] = [
  [
    [1.5, 2],
    [3.25, 3],
  ],
  [
    [0.75, 3],
    [2.25, 1],
    [3.5, 2],
  ],
  [[1.25, 3]],
];

/**
 * Loops are rendered at this rate rather than the device's, which can be
 * 96 kHz: the work is three passes long now, and nothing here lives above
 * 16 kHz. The browser resamples on playback.
 */
const RATE = 32000;

/** One sine period. A table lookup per partial beats Math.sin per sample. */
const SIZE = 4096;
const WAVE = new Float32Array(SIZE);
for (let i = 0; i < SIZE; i++) WAVE[i] = Math.sin((2 * Math.PI * i) / SIZE);
const wave = (phase: number): number => WAVE[(phase | 0) & (SIZE - 1)] ?? 0;

/** Render one seamless loop: warm keys, bass, soft drums and vinyl hiss. */
export function makeMusic(ctx: AudioContext, track: Track): AudioBuffer {
  const rate = RATE,
    beat = 60 / track.bpm,
    bars = track.chords.length * PASSES,
    beats = bars * 4,
    length = beat * beats;
  const buffer = ctx.createBuffer(1, Math.round(length * rate), rate),
    out = buffer.getChannelData(0);
  const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  function mix(index: number, sample: number): void {
    const position = index % out.length;
    out[position] = (out[position] ?? 0) + sample;
  }
  function note(
    time: number,
    duration: number,
    midi: number,
    level: number,
  ): void {
    const start = Math.floor(time * rate),
      n = Math.floor(duration * rate),
      step = (freq(midi) * SIZE) / rate,
      attack = 0.018 * rate,
      release = 0.15 * rate,
      // The exponential fall is one multiply per sample, not one Math.exp.
      fall = Math.exp(-track.decay / rate);
    let first = 0,
      second = 0,
      third = 0,
      decay = 1;
    for (let i = 0; i < n; i++) {
      const env =
        Math.min(1, i / attack) * decay * Math.min(1, (n - i) / release);
      mix(
        start + i,
        level * env * (wave(first) + 0.22 * wave(second) + 0.08 * wave(third)),
      );
      decay *= fall;
      first += step;
      second += step * 2.002;
      third += step * 3;
    }
  }
  /** The bar the drums sit out, so the loop breathes instead of grinding on. */
  const hush = (PASSES - 1) * track.chords.length;
  for (let pass = 0; pass < PASSES; pass++) {
    const bass = BASS[pass % BASS.length] ?? [];
    const melody = MELODY[pass % MELODY.length] ?? [];
    track.chords.forEach((chord, index) => {
      const bar = pass * track.chords.length + index;
      chord.forEach((m, j) => {
        // An open voicing on the middle pass lifts the same harmony elsewhere.
        const midi = pass === 1 && j === 3 ? m + 12 : m;
        note(bar * 4 * beat + j * 0.026, beat * 3.8, midi, track.keys);
      });
      bass.forEach((b) => {
        note((bar * 4 + b) * beat, beat * 1.3, chord[0] - 12, track.bass);
      });
      melody.forEach(([b, tone]) => {
        note((bar * 4 + b) * beat, beat * 0.7, chord[tone] + 12, track.melody);
      });
    });
  }
  for (let b = 0; b < beats; b++) {
    if (Math.floor(b / 4) === hush) continue;
    const start = Math.floor(b * beat * rate);
    for (let i = 0; i < rate * 0.22; i++) {
      const t = i / rate;
      mix(
        start + i,
        b % 2 === 0
          ? track.kick *
              Math.sin(2 * Math.PI * (48 * t + 5 * (1 - Math.exp(-t * 24)))) *
              Math.exp(-t * 22)
          : (Math.random() * 2 - 1) * track.snare * Math.exp(-t * 30),
      );
    }
    for (let half = 0; half < 2; half++) {
      const h = Math.floor((b + half * 0.5 + (half ? 0.045 : 0)) * beat * rate);
      for (let i = 0; i < rate * 0.045; i++)
        mix(
          h + i,
          (Math.random() * 2 - 1) * track.hat * Math.exp((-i / rate) * 95),
        );
    }
  }
  if (track.warmth > 0) {
    // One-pole lowpass: the darker the track, the less of each new sample lands.
    const opening = 1 - track.warmth;
    let previous = 0;
    for (let i = 0; i < out.length; i++) {
      previous += opening * ((out[i] ?? 0) - previous);
      out[i] = previous;
    }
  }
  for (let i = 0; i < out.length; i++)
    out[i] =
      Math.tanh((out[i] ?? 0) + (Math.random() * 2 - 1) * track.hiss) * 0.8;
  return buffer;
}
