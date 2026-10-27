// Procedural audio with WebAudio: wheel roar, wind, slide hiss, car engines.

const VOICES = 5;

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Brown noise for low rumble.
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }

    this.roll = this.loop(this.noise, 'bandpass', 400, 0.8);
    this.rumble = this.loop(this.brown, 'lowpass', 160, 0.7);
    this.wind = this.loop(this.noise, 'bandpass', 800, 0.5);
    this.slide = this.loop(this.noise, 'bandpass', 2200, 2.5);
    this.gravel = this.loop(this.brown, 'bandpass', 900, 0.6);

    this.voices = [];
    for (let i = 0; i < VOICES; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const g2 = ctx.createGain();
      g2.gain.value = 0.3;
      osc.connect(filt);
      osc2.connect(g2).connect(filt);
      filt.connect(g).connect(pan).connect(this.master);
      osc.start();
      osc2.start();
      this.voices.push({ osc, osc2, filt, g, pan });
    }
  }

  loop(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random());
    return { src, f, g };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  set(node, param, value, tc = 0.05) {
    node[param].setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  update(player, cars, camera) {
    if (!this.ctx) return;
    const v = player.crashed ? 0 : player.speed;
    const sliding = !player.crashed && (player.slideMode || player.sliding) && v > 2;
    const gravel = player.surface === 'gravel' && !player.crashed;
    this.set(this.roll.g, 'gain', Math.min(0.5, v * 0.02) * (sliding ? 0.5 : 1));
    this.set(this.roll.f, 'frequency', 250 + v * 35);
    this.set(this.rumble.g, 'gain', Math.min(0.9, v * 0.04));
    this.set(this.wind.g, 'gain', Math.min(0.6, v * v * 0.0007) * (1 - player.tuck * 0.35));
    this.set(this.wind.f, 'frequency', 500 + v * 30);
    const slideAmt = sliding ? Math.min(1, Math.abs(Math.sin(player.slip)) * 1.3) * Math.min(1, v / 8) : 0;
    this.set(this.slide.g, 'gain', slideAmt * 0.55, 0.03);
    this.set(this.slide.f, 'frequency', 1600 + v * 40);
    this.set(this.gravel.g, 'gain', gravel ? Math.min(0.8, v * 0.06) : 0);

    // Assign engine voices to the nearest cars.
    const cp = camera.position;
    const sorted = cars
      .map((c) => ({ c, d: Math.hypot(c.x - cp.x, c.z - cp.z) }))
      .sort((a, b) => a.d - b.d);
    const right = { x: Math.cos(player.yaw), z: Math.sin(player.yaw) };
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      const e = sorted[i];
      if (!e || e.d > 250) {
        this.set(voice.g, 'gain', 0, 0.2);
        continue;
      }
      const c = e.c;
      // Radial velocity for a touch of doppler.
      const cvx = Math.sin(c.yaw) * c.v;
      const cvz = -Math.cos(c.yaw) * c.v;
      const dx = c.x - cp.x, dz = c.z - cp.z;
      const inv = 1 / Math.max(e.d, 0.1);
      const radial = ((cvx - player.vel.x) * dx + (cvz - player.vel.y) * dz) * inv;
      const doppler = 343 / (343 + radial);
      const rpm = 32 + c.v * 2.6;
      this.set(voice.osc, 'frequency', rpm * doppler, 0.1);
      this.set(voice.osc2, 'frequency', rpm * 0.5 * doppler, 0.1);
      this.set(voice.filt, 'frequency', 300 + c.v * 25, 0.1);
      this.set(voice.g, 'gain', Math.min(0.35, 6 / (e.d + 6)) * 0.6, 0.1);
      this.set(voice.pan, 'pan', Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) * inv)), 0.1);
    }
  }

  burst(freq, q, dur, gain, type = 'bandpass', sweepTo = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  crash() {
    this.burst(800, 0.7, 1.2, 1.2, 'lowpass', 120);
    this.burst(3000, 1, 0.4, 0.5);
  }

  rail() {
    this.burst(2400, 8, 0.25, 0.6);
    this.burst(600, 2, 0.15, 0.4);
  }

  honk(distance = 30) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const vol = Math.min(0.5, 12 / distance);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + 0.65);
    g.gain.linearRampToValueAtTime(0, t + 0.75);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    g.connect(f).connect(this.master);
    for (const hz of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.8);
    }
  }

  // A hollow plastic knock for a cone.
  cone() {
    if (!this.ctx) return;
    this.burst(700, 3, 0.18, 0.5, 'bandpass', 300);
  }

  ding() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1320, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }
}
