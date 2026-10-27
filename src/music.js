// An optional, synthesised music bed: a slow four-chord loop for each biome,
// with a pad, a plucked arpeggio and, while riding, bass and a soft beat.
// Notes are scheduled a little ahead of time from a timer.

const MOODS = {
  // root: MIDI note; chords: semitones above the root, one chord per bar.
  alpine: { bpm: 84, root: 60, pluck: 'bell', chords: [[0, 4, 7, 11], [7, 11, 14, 17], [9, 12, 16, 19], [5, 9, 12, 16]] },
  dartmoor: { bpm: 76, root: 62, pluck: 'soft', chords: [[0, 3, 7, 10], [5, 9, 12, 15], [0, 3, 7, 10], [-2, 2, 5, 9]] },
  suburbs: { bpm: 96, root: 55, pluck: 'bell', chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]] },
  forest: { bpm: 80, root: 57, pluck: 'soft', chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]] },
  canyon: { bpm: 76, root: 52, pluck: 'twang', chords: [[0, 3, 7, 10], [1, 5, 8, 12], [0, 3, 7, 10], [-2, 2, 5, 9]] },
  city: { bpm: 88, root: 53, pluck: 'keys', swing: 0.18, chords: [[0, 4, 7, 11], [-1, 2, 7, 10], [-3, 0, 5, 9], [-5, -1, 4, 7]] },
  coast: { bpm: 92, root: 62, pluck: 'bell', chords: [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]] },
  pass: { bpm: 100, root: 50, pluck: 'twang', chords: [[0, 3, 7, 12], [-4, 0, 3, 7], [3, 7, 10, 15], [-2, 2, 5, 10]] },
};

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

export class Music {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
    this.mood = MOODS.alpine;
    this.riding = 0; // 0 in menus, 1 on a run: brings in bass and drums
    this.speed = 0; // 0..1, busier hats when fast
    this.step = 0;
    this.next = 0;
    this.on = false;
    this.timer = null;
  }

  setBiome(id) {
    this.mood = MOODS[id] || MOODS.alpine;
  }

  // Only runs while the music bus is audible, to save the CPU.
  setOn(on) {
    if (on === this.on) return;
    this.on = on;
    clearInterval(this.timer);
    if (!on) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.25;
    if (this.next < ctx.currentTime - 1) this.next = ctx.currentTime + 0.05;
    const m = this.mood;
    const sixteenth = 60 / m.bpm / 4;
    while (this.next < ahead) {
      const i = this.step % 16;
      const chord = m.chords[Math.floor(this.step / 16) % m.chords.length];
      const swing = i % 2 ? (m.swing || 0) * sixteenth : 0;
      const t = this.next + swing;
      if (i === 0) this.pad(t, chord.map((n) => hz(m.root + n)), sixteenth * 16);
      if (i % 2 === 0 && Math.random() < 0.75) this.pluck(t, hz(m.root + 12 + chord[ARP[(i / 2) % 8]]), m.pluck);
      if (this.riding > 0.5) {
        if (i === 0 || i === 10) this.bass(t, hz(m.root - 12 + chord[0]), sixteenth * (i === 0 ? 8 : 5));
        if (i === 0 || i === 8 || (i === 11 && Math.random() < 0.4)) this.kick(t);
        if (i === 4 || i === 12) this.snare(t);
        if (i % 2 === 0 || (this.speed > 0.6 && Math.random() < this.speed - 0.4)) this.hat(t, i % 4 === 2 ? 0.5 : 0.3);
      }
      this.next += sixteenth;
      this.step++;
    }
  }

  env(t, peak, atk, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out);
    return g;
  }

  osc(type, f, t, dur, to) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  pad(t, freqs, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = this.env(t, 0.12, dur * 0.3, dur * 1.1);
    lp.connect(g);
    for (const f of freqs) {
      this.osc('sawtooth', f, t, dur * 1.1, lp).detune.value = -7;
      this.osc('sawtooth', f, t, dur * 1.1, lp).detune.value = 7;
    }
  }

  pluck(t, f, kind) {
    if (kind === 'twang') {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.setValueAtTime(3000, t);
      bp.frequency.exponentialRampToValueAtTime(400, t + 0.4);
      bp.connect(this.env(t, 0.12, 0.004, 0.6));
      this.osc('sawtooth', f, t, 0.6, bp);
    } else if (kind === 'keys') {
      const g = this.env(t, 0.14, 0.006, 0.9);
      this.osc('sine', f, t, 0.9, g);
      this.osc('sine', f * 2, t, 0.3, this.env(t, 0.04, 0.004, 0.3));
    } else if (kind === 'soft') {
      this.osc('triangle', f, t, 0.8, this.env(t, 0.12, 0.05, 0.8));
    } else {
      this.osc('triangle', f, t, 0.7, this.env(t, 0.13, 0.004, 0.7));
      this.osc('sine', f * 3, t, 0.25, this.env(t, 0.03, 0.002, 0.25));
    }
  }

  bass(t, f, dur) {
    this.osc('triangle', f, t, dur, this.env(t, 0.3, 0.01, dur));
  }

  kick(t) {
    const o = this.osc('sine', 120, t, 0.3, this.env(t, 0.5, 0.003, 0.3));
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  }

  noiseHit(t, type, freq, gain, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(t, gain, 0.002, dur));
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  snare(t) {
    this.noiseHit(t, 'bandpass', 1800, 0.18, 0.18);
  }

  hat(t, gain) {
    this.noiseHit(t, 'highpass', 7000, gain * 0.12, 0.05);
  }
}
