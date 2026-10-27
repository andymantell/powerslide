// Per-biome ambience: continuous beds (wind, water, surf, town hum, insects,
// rain) plus wildlife and town sounds dropped in at random from src/sfx.js,
// each at its own distance and side. Weather and time of day change the mix.
//
// The hooks (see "Sound" in the README):
// - AMBIENCE[biome] is each biome's default mix.
// - A level's JSON can add `"ambience"`: { layers, events, spots, echo } to
//   change its biome's mix, and `"weather"` / `"time"` (see Audio.setScene).
// - audio.setWeather({ rain, wind, thunder }) and audio.setTimeOfDay(hours)
//   can be called at any time, e.g. by the shared sky and weather code.

import { CALLS } from './sfx.js';

// layers: bed levels, 0..1. wind: { level, tone (Hz, lower is deeper),
// whistle (0..1, wind in rocks and wires), gust (0..1, how much it comes and
// goes) }. insects play by day, crickets at night.
// events: { call: { every: [min, max] seconds, gain, when: 'day' | 'night', bird } }.
// Birds go quiet in heavy rain. echo: { time, feedback, mix } for open rock
// faces and streets, which also catches the rider's own sounds.
export const AMBIENCE = {
  alpine: {
    layers: { wind: { level: 0.18, tone: 600, whistle: 0, gust: 0.4 }, water: 0.1, insects: 0.06, crickets: 0.12 },
    events: {
      cowbell: { every: [3, 9], gain: 0.45 },
      songbird: { every: [2, 6], gain: 0.3, when: 'day', bird: true },
      cuckoo: { every: [25, 60], gain: 0.3, when: 'day', bird: true },
      marmot: { every: [30, 80], gain: 0.3, when: 'day' },
      raptor: { every: [60, 140], gain: 0.18, when: 'day', bird: true },
      owl: { every: [20, 50], gain: 0.3, when: 'night', bird: true },
    },
  },
  dartmoor: {
    layers: { wind: { level: 0.42, tone: 450, whistle: 0.15, gust: 0.8 }, crickets: 0.06 },
    events: {
      skylark: { every: [8, 20], gain: 0.28, when: 'day', bird: true },
      sheep: { every: [5, 14], gain: 0.45 },
      pony: { every: [25, 60], gain: 0.4 },
      crow: { every: [15, 35], gain: 0.28, bird: true },
      curlew: { every: [30, 70], gain: 0.28, bird: true },
      owl: { every: [30, 70], gain: 0.25, when: 'night', bird: true },
    },
  },
  suburbs: {
    layers: { wind: { level: 0.1, tone: 700, whistle: 0, gust: 0.4 }, hum: 0.25, crickets: 0.1 },
    events: {
      songbird: { every: [3, 8], gain: 0.3, when: 'day', bird: true },
      dog: { every: [12, 35], gain: 0.32 },
      chimes: { every: [20, 50], gain: 0.22 },
      mower: { every: [40, 100], gain: 0.22, when: 'day' },
      farHorn: { every: [30, 70], gain: 0.18 },
      crow: { every: [25, 60], gain: 0.18, when: 'day', bird: true },
      airHiss: { every: [50, 120], gain: 0.14 },
    },
  },
  forest: {
    layers: { wind: { level: 0.3, tone: 1100, whistle: 0, gust: 0.6 }, water: 0.04, crickets: 0.08 },
    events: {
      woodpecker: { every: [15, 40], gain: 0.32, when: 'day', bird: true },
      songbird: { every: [4, 10], gain: 0.22, when: 'day', bird: true },
      raven: { every: [25, 60], gain: 0.24, bird: true },
      raptor: { every: [80, 160], gain: 0.14, when: 'day', bird: true },
      owl: { every: [15, 40], gain: 0.4, when: 'night', bird: true },
    },
    echo: { time: 0.12, feedback: 0.2, mix: 0.15 },
  },
  canyon: {
    layers: { wind: { level: 0.32, tone: 500, whistle: 0.5, gust: 0.7 }, insects: 0.16, crickets: 0.14 },
    events: {
      raptor: { every: [20, 50], gain: 0.32, when: 'day', bird: true },
      raven: { every: [20, 45], gain: 0.28, bird: true },
      owl: { every: [30, 60], gain: 0.2, when: 'night', bird: true },
    },
    echo: { time: 0.42, feedback: 0.38, mix: 0.4 },
  },
  city: {
    time: 22,
    layers: { wind: { level: 0.12, tone: 650, whistle: 0.1, gust: 0.3 }, hum: 0.5 },
    events: {
      siren: { every: [40, 90], gain: 0.22 },
      farHorn: { every: [10, 25], gain: 0.24 },
      dog: { every: [30, 70], gain: 0.18 },
      tramBell: { every: [35, 80], gain: 0.28 },
      airHiss: { every: [25, 60], gain: 0.2 },
    },
    echo: { time: 0.18, feedback: 0.3, mix: 0.25 },
  },
  coast: {
    layers: { wind: { level: 0.38, tone: 650, whistle: 0.1, gust: 0.6 }, surf: 0.5 },
    events: {
      wave: { every: [5, 10], gain: 0.45 },
      gull: { every: [4, 12], gain: 0.42, bird: true },
      foghorn: { every: [70, 150], gain: 0.22 },
      buoy: { every: [30, 70], gain: 0.18 },
    },
  },
  pass: {
    layers: { wind: { level: 0.52, tone: 750, whistle: 0.35, gust: 0.9 }, water: 0.18 },
    events: {
      marmot: { every: [12, 35], gain: 0.38, when: 'day' },
      chough: { every: [10, 25], gain: 0.32, bird: true },
      raptor: { every: [40, 90], gain: 0.28, when: 'day', bird: true },
      cowbell: { every: [40, 90], gain: 0.18 },
    },
    echo: { time: 0.3, feedback: 0.25, mix: 0.2 },
  },
};

const MAX_EVENTS = 4; // one-shots playing at once
const isNight = (h) => h < 6 || h >= 20.5;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Per-call randomness (not seeded: ambience doesn't need to repeat).
const rand = Math.random;
const between = ([lo, hi]) => lo + rand() * (hi - lo);

export class Ambience {
  // k: { ctx, noise, brown, rain } noise buffers; out: the ambience bus;
  // echo: the shared echo's input.
  constructor(k, out, echo) {
    this.k = k;
    this.ctx = k.ctx;
    this.out = out;
    this.echo = echo;
    this.layers = {};
    this.spots = [];
    this.timers = {};
    this.playing = [];
    this.weather = { rain: 0, wind: 0, thunder: false };
    this.hour = 13;
    this.mix = AMBIENCE.alpine;
    this.gustT = 0;
  }

  // mix: a biome's AMBIENCE entry with any level changes merged in.
  setMix(mix, spots = []) {
    this.mix = mix;
    this.timers = {};
    for (const [name, ev] of Object.entries(mix.events || {})) this.timers[name] = rand() * ev.every[0];
    for (const s of this.spots) s.layer?.stop();
    this.spots = spots.map((s) => ({ ...s, layer: null }));
  }

  // ------------------------------------------------------------ beds
  noiseSrc(buf = 'noise') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.k[buf];
    src.loop = true;
    src.start(0, rand() * 1.5);
    return src;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  lfo(freq, depth, param, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const d = this.gain(depth);
    o.connect(d).connect(param);
    o.start();
    return o;
  }

  // Builds a bed on first use. Each returns { g (its level), stop(), ... }.
  make(kind, out = this.out) {
    const ctx = this.ctx;
    const g = this.gain(0);
    const pan = ctx.createStereoPanner();
    g.connect(pan).connect(out);
    const srcs = [];
    const add = (node) => (srcs.push(node), node);
    const layer = { g, pan, stop: () => srcs.forEach((s) => s.stop()) };
    if (kind === 'wind') {
      const src = add(this.noiseSrc());
      layer.lp = this.filter('lowpass', 600, 0.7);
      layer.whistle = this.filter('bandpass', 1000, 12);
      layer.whistleG = this.gain(0);
      src.connect(layer.lp).connect(g);
      src.connect(layer.whistle).connect(layer.whistleG).connect(g);
    } else if (kind === 'water' || kind === 'stream') {
      // Babbling: a few bands of noise, each wandering in pitch.
      const src = add(this.noiseSrc());
      for (const [f, q, rate] of [[500, 1.5, 0.37], [1300, 2, 0.81], [3100, 2.5, 1.43]]) {
        const bp = this.filter('bandpass', f, q);
        add(this.lfo(rate, f * 0.35, bp.frequency));
        src.connect(bp).connect(g);
      }
    } else if (kind === 'waterfall') {
      const src = add(this.noiseSrc());
      src.connect(this.filter('lowpass', 1400, 0.5)).connect(this.filter('highpass', 150)).connect(g);
    } else if (kind === 'surf') {
      // The sea's slow swell; breaking waves come as `wave` events.
      const src = add(this.noiseSrc('brown'));
      const lp = this.filter('lowpass', 500, 0.7);
      add(this.lfo(0.09, 300, lp.frequency));
      const swell = this.gain(0.7);
      add(this.lfo(0.09, 0.3, swell.gain));
      src.connect(lp).connect(swell).connect(g);
      const hiss = add(this.noiseSrc());
      hiss.connect(this.filter('highpass', 3000)).connect(this.gain(0.06)).connect(swell);
    } else if (kind === 'hum') {
      // Distant traffic: a low roar with a bit of tyre noise on top.
      const src = add(this.noiseSrc('brown'));
      src.connect(this.filter('lowpass', 220)).connect(g);
      const tyres = add(this.noiseSrc());
      const wash = this.gain(0.05);
      add(this.lfo(0.05, 0.03, wash.gain));
      tyres.connect(this.filter('bandpass', 900, 0.6)).connect(wash).connect(g);
    } else if (kind === 'insects') {
      // Cicadas and grasshoppers: a buzzing, pulsing band of noise.
      const src = add(this.noiseSrc());
      const am = this.gain(0.5);
      add(this.lfo(38, 0.5, am.gain, 'square'));
      const swell = this.gain(0.7);
      add(this.lfo(0.13, 0.3, swell.gain));
      src.connect(this.filter('bandpass', 4800, 6)).connect(am).connect(swell).connect(g);
    } else if (kind === 'crickets') {
      const o = add(ctx.createOscillator());
      o.frequency.value = 4400;
      o.start();
      const trill = this.gain(0.5);
      add(this.lfo(30, 0.5, trill.gain, 'square'));
      const chirp = this.gain(0.5);
      add(this.lfo(2.4, 0.5, chirp.gain, 'square'));
      o.connect(trill).connect(chirp).connect(g);
    } else if (kind === 'rain') {
      const src = add(this.noiseSrc('rain'));
      src.connect(this.filter('highpass', 300)).connect(g);
      // The heavier the rain, the more low-end hiss under the drops.
      layer.wash = this.gain(0);
      add(this.noiseSrc('noise')).connect(this.filter('lowpass', 2500)).connect(layer.wash).connect(g);
    }
    return layer;
  }

  layer(kind) {
    return (this.layers[kind] ||= this.make(kind));
  }

  setLevel(kind, v, tc = 1.5) {
    if (!v && !this.layers[kind]) return;
    this.layer(kind).g.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // ------------------------------------------------------------ one-shots
  play(name, gain, pan = rand() * 1.8 - 0.9, far = rand()) {
    const fn = CALLS[name];
    if (!fn) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const g = this.gain(gain * (1 - far * 0.7));
    // Far away, the high end goes first.
    const lp = this.filter('lowpass', 9000 - far * 6500, 0.5);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(this.out);
    if (this.echo) g.connect(this.echo);
    const dur = fn(this.k, lp, t, rand);
    this.playing.push(t + dur);
    this.log = [...(this.log || []).slice(-19), name]; // for tools/audio-check.mjs
    setTimeout(() => p.disconnect(), (dur + 3) * 1000);
  }

  // listener: { x, z, yaw } (the camera); dt in seconds.
  update(dt, listener) {
    const mix = this.mix;
    const L = mix.layers || {};
    const w = this.weather;
    const night = isNight(this.hour);
    const now = this.ctx.currentTime;

    // Wind: the biome's own, plus the weather's, coming and going in gusts.
    const wind = L.wind || { level: 0.15, tone: 600, whistle: 0, gust: 0.4 };
    const level = Math.min(1, wind.level + w.wind * 0.6);
    const gust = Math.min(1, wind.gust + w.wind * 0.5);
    this.gustT -= dt;
    if (this.gustT <= 0 && level > 0) {
      this.gustT = 0.4 + rand() * 1.2;
      const g = level * (1 - gust * 0.55 + gust * rand() * 0.9);
      const l = this.layer('wind');
      l.g.gain.setTargetAtTime(g, now, 0.9);
      l.lp.frequency.setTargetAtTime(wind.tone * (0.7 + (g / Math.max(level, 0.01)) * 0.6), now, 0.9);
      l.whistle.frequency.setTargetAtTime(wind.tone * 1.7 * (0.8 + rand() * 0.5), now, 1.2);
      l.whistleG.gain.setTargetAtTime((wind.whistle + w.wind * 0.3) * 0.15 * (g / Math.max(level, 0.01)), now, 1);
    }
    this.setLevel('water', L.water || 0);
    this.setLevel('surf', L.surf || 0);
    this.setLevel('hum', L.hum || 0);
    this.setLevel('insects', night ? 0 : (L.insects || 0) * (1 - w.rain), 3);
    this.setLevel('crickets', night ? (L.crickets || 0) * (1 - w.rain) : 0, 3);
    this.setLevel('rain', w.rain * 0.7, 2);
    if (this.layers.rain) this.layers.rain.wash.gain.setTargetAtTime(w.rain * w.rain * 0.25, now, 2);

    // Wildlife and town noise.
    this.playing = this.playing.filter((end) => end > now);
    for (const [name, ev] of Object.entries(mix.events || {})) {
      if (ev.when && (ev.when === 'night') !== night) continue;
      // The dawn chorus: birds sing far more around sunrise.
      const chorus = ev.bird && this.hour >= 5 && this.hour < 8.5 ? 2.5 : 1;
      this.timers[name] = (this.timers[name] ?? 0) - dt * chorus;
      if (this.timers[name] > 0) continue;
      this.timers[name] = between(ev.every);
      if (this.playing.length >= MAX_EVENTS) continue;
      const quiet = ev.bird ? 1 - w.rain * 0.85 : 1;
      if (quiet > 0.05) this.play(name, ev.gain * quiet);
    }
    if (w.thunder) {
      this.timers.thunder = (this.timers.thunder ?? between([5, 20])) - dt;
      if (this.timers.thunder <= 0) {
        this.timers.thunder = between([12, 40]);
        this.play('thunder', 0.7, rand() * 1.4 - 0.7, rand() * 0.6);
      }
    }

    // Spots placed by a level: a waterfall or a herd you ride past.
    if (listener) this.updateSpots(dt, listener);
  }

  updateSpots(dt, { x, z, yaw }) {
    const rx = Math.cos(yaw), rz = Math.sin(yaw);
    for (const s of this.spots) {
      if (s.x === undefined) continue;
      const dx = s.x - x, dz = s.z - z;
      const dist = Math.hypot(dx, dz);
      const radius = s.radius || 80;
      const near = clamp01(1 - dist / radius);
      const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(dist, 1)));
      if (CALLS[s.sound]) {
        // A call repeated while you're in earshot.
        s.timer = (s.timer ?? 0) - dt;
        if (near > 0 && s.timer <= 0) {
          s.timer = between(s.every || [3, 8]);
          this.play(s.sound, (s.gain ?? 0.6) * Math.min(1, near * 1.5), pan * 0.9, 1 - near);
        }
        continue;
      }
      if (!s.layer && near <= 0) continue;
      s.layer ||= this.make(s.sound);
      const now = this.ctx.currentTime;
      s.layer.g.gain.setTargetAtTime((s.gain ?? 0.6) * near * near, now, 0.3);
      s.layer.pan.pan.setTargetAtTime(pan * 0.8, now, 0.3);
    }
  }
}

// A biome's mix with a level's changes merged in. Setting an event or layer
// to 0 (or null) switches it off.
export function mixFor(biomeId, change = {}) {
  const base = AMBIENCE[biomeId] || AMBIENCE.alpine;
  const layers = { ...base.layers };
  for (const [k, v] of Object.entries(change.layers || {})) {
    if (k === 'wind' && v && typeof v === 'object') layers.wind = { ...layers.wind, ...v };
    else layers[k] = v || 0;
  }
  const events = { ...base.events };
  for (const [k, v] of Object.entries(change.events || {})) {
    if (!v) delete events[k];
    else events[k] = { every: [10, 30], gain: 0.3, ...events[k], ...v };
  }
  return { ...base, layers, events, echo: change.echo ?? base.echo, time: change.time ?? base.time };
}

// Sounds a level's set pieces and props make by themselves: a waterfall, a
// stream under a bridge, a church bell, a sawmill, cows in a pasture. Each is
// { at, d, sound, radius, gain, every } (`at` from the start line). zones are
// stretches with their own echo, such as avalanche galleries and tunnels.
export function spotsFor(level) {
  const spots = [];
  const zones = [];
  const mid = (e) => e.at ?? ((e.from ?? 0) + (e.to ?? e.from ?? 0)) / 2;
  for (const f of level?.features || []) {
    if (f.type === 'stream') spots.push({ at: mid(f), d: 0, sound: f.fall ? 'waterfall' : 'stream', radius: f.fall ? 170 : 90, gain: f.fall ? 0.7 : 0.5 });
    else if (f.type === 'covered') spots.push({ at: mid(f), d: 0, sound: 'stream', radius: 80, gain: 0.45 });
    else if (f.type === 'lake') spots.push({ at: mid(f), d: 0, sound: 'surf', radius: Math.max(150, ((f.to ?? 0) - (f.from ?? 0)) * 0.6), gain: 0.12 });
    else if (f.type === 'gallery' || f.type === 'tunnel') zones.push({ from: f.from ?? f.at, to: f.to ?? f.at, echo: { time: 0.07, feedback: 0.45, mix: 0.55 } });
  }
  for (const p of level?.props || []) {
    const types = [].concat(p.type || p.scatter || p.row || []);
    if (types.includes('church')) spots.push({ at: mid(p), d: p.d ?? 0, sound: 'churchBell', radius: 320, gain: 0.45, every: [25, 50] });
    if (types.includes('sawmill')) spots.push({ at: mid(p), d: p.d ?? 0, sound: 'saw', radius: 160, gain: 0.35, every: [6, 12] });
    if (types.some((t) => t === 'fountain' || t === 'trough')) spots.push({ at: mid(p), d: p.d ?? 0, sound: 'waterfall', radius: 25, gain: 0.25 });
    if (p.scatter && types.some((t) => t.startsWith('cow'))) {
      // A herd: bells every couple of hundred metres along the pasture.
      const side = p.side === 'left' ? -1 : 1;
      for (let s = p.from; s <= p.to; s += 200) {
        spots.push({ at: s, d: side * ((p.near ?? 15) + (p.far ?? 60)) * 0.4, sound: 'cowbell', radius: 110, gain: 0.5, every: [1.5, 4] });
      }
    }
  }
  return { spots, zones };
}

// Rain as a buffer of individual drops over a soft hiss, made once.
export function rainBuffer(ctx) {
  const rate = ctx.sampleRate;
  const len = rate * 3;
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) {
    b = b * 0.97 + (Math.random() * 2 - 1) * 0.03;
    d[i] = b * 0.6;
  }
  const drops = 3 * 700;
  for (let n = 0; n < drops; n++) {
    const at = Math.floor(Math.random() * len);
    const f = 2000 + Math.random() * 5000;
    const amp = 0.05 + Math.random() ** 3 * 0.5;
    const decay = rate * (0.001 + Math.random() * 0.004);
    const span = Math.min(len - at, Math.floor(decay * 5));
    for (let i = 0; i < span; i++) d[at + i] += amp * Math.exp(-i / decay) * Math.sin((2 * Math.PI * f * i) / rate);
  }
  return buf;
}
