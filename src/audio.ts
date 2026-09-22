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

/** Render one seamless loop: warm keys, bass, soft drums and vinyl hiss. */
export function makeMusic(ctx: AudioContext, track: Track): AudioBuffer {
  const rate = ctx.sampleRate,
    beat = 60 / track.bpm,
    beats = track.chords.length * 4,
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
      f = freq(midi);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env =
        Math.min(1, t / 0.018) *
        Math.exp(-t * track.decay) *
        Math.min(1, (duration - t) / 0.15);
      mix(
        start + i,
        level *
          env *
          (Math.sin(2 * Math.PI * f * t) +
            0.22 * Math.sin(2 * Math.PI * f * 2.002 * t) +
            0.08 * Math.sin(2 * Math.PI * f * 3 * t)),
      );
    }
  }
  track.chords.forEach((chord, bar) => {
    chord.forEach((m, j) => {
      note(bar * 4 * beat + j * 0.026, beat * 3.8, m, track.keys);
    });
    [0, 2.5].forEach((b) => {
      note((bar * 4 + b) * beat, beat * 1.3, chord[0] - 12, track.bass);
    });
    [1.5, 3.25].forEach((b, j) => {
      note(
        (bar * 4 + b) * beat,
        beat * 0.7,
        (j === 0 ? chord[2] : chord[3]) + 12,
        track.melody,
      );
    });
  });
  for (let b = 0; b < beats; b++) {
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
