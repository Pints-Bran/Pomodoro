// An original, seamless four-bar instrumental: warm keys, bass, soft drums and vinyl hiss.
export function makeMusic(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate,
    beat = 60 / 72,
    length = beat * 16;
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
        Math.exp(-t * 2.1) *
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
  const chords = [
    [53, 57, 60, 64],
    [50, 53, 57, 60],
    [45, 52, 55, 59],
    [48, 52, 55, 62],
  ] as const;
  chords.forEach((chord, bar) => {
    chord.forEach((m, j) => {
      note(bar * 4 * beat + j * 0.026, beat * 3.8, m, 0.075);
    });
    [0, 2.5].forEach((b) => {
      note((bar * 4 + b) * beat, beat * 1.3, chord[0] - 12, 0.16);
    });
    [1.5, 3.25].forEach((b, j) => {
      note(
        (bar * 4 + b) * beat,
        beat * 0.7,
        (j === 0 ? chord[2] : chord[3]) + 12,
        0.032,
      );
    });
  });
  for (let b = 0; b < 16; b++) {
    const start = Math.floor(b * beat * rate);
    for (let i = 0; i < rate * 0.22; i++) {
      const t = i / rate;
      mix(
        start + i,
        b % 2 === 0
          ? 0.22 *
              Math.sin(2 * Math.PI * (48 * t + 5 * (1 - Math.exp(-t * 24)))) *
              Math.exp(-t * 22)
          : (Math.random() * 2 - 1) * 0.075 * Math.exp(-t * 30),
      );
    }
    for (let half = 0; half < 2; half++) {
      const h = Math.floor((b + half * 0.5 + (half ? 0.045 : 0)) * beat * rate);
      for (let i = 0; i < rate * 0.045; i++)
        mix(
          h + i,
          (Math.random() * 2 - 1) * 0.021 * Math.exp((-i / rate) * 95),
        );
    }
  }
  for (let i = 0; i < out.length; i++)
    out[i] = Math.tanh((out[i] ?? 0) + (Math.random() * 2 - 1) * 0.0015) * 0.8;
  return buffer;
}
