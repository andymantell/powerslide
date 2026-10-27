// Synthesised one-shot sounds for the ambience: birds, animals, bells, water,
// weather and distant town noise. Nothing is downloaded; each call builds a
// few WebAudio nodes, schedules them at time `t` into `out` and returns how
// long the sound lasts, so the caller can tidy up after it.
//
// k: { ctx, noise, brown } (the shared noise buffers); r: a random function.

const ramp = (r, lo, hi) => lo + r() * (hi - lo);

// One oscillator playing a list of notes. Each note glides from f0 to f1 over
// dur seconds, starting `at` seconds in. Notes must not overlap.
function notes(k, out, t, type, list, filter = null) {
  const { ctx } = k;
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  g.gain.value = 0;
  let end = 0;
  for (const n of list) {
    const a = t + n.at;
    const atk = n.atk ?? Math.min(0.02, n.dur * 0.25);
    o.frequency.setValueAtTime(n.f0, a);
    o.frequency.exponentialRampToValueAtTime(n.f1 ?? n.f0, a + n.dur);
    g.gain.setValueAtTime(0, a);
    g.gain.linearRampToValueAtTime(n.g ?? 1, a + atk);
    g.gain.linearRampToValueAtTime(0, a + n.dur);
    end = Math.max(end, n.at + n.dur);
  }
  let head = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'bandpass';
    f.frequency.value = filter.freq;
    f.Q.value = filter.q ?? 1;
    head = o.connect(f);
  }
  head.connect(g).connect(out);
  o.start(t);
  o.stop(t + end + 0.05);
  return { o, g, end };
}

// A vibrato LFO on an oscillator's frequency.
function vibrato(k, o, t, end, rate, depth) {
  const lfo = k.ctx.createOscillator();
  lfo.frequency.value = rate;
  const d = k.ctx.createGain();
  d.gain.value = depth;
  lfo.connect(d).connect(o.frequency);
  lfo.start(t);
  lfo.stop(t + end + 0.05);
}

// Filtered noise with an attack/decay envelope.
export function noiseBurst(k, out, t, { freq = 1000, q = 1, type = 'bandpass', dur = 0.2, gain = 1, atk = 0.005, sweep = null, buf = 'noise' }) {
  const { ctx } = k;
  const src = ctx.createBufferSource();
  src.buffer = k[buf];
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
  return dur;
}

// A struck metal bar or bell: a few inharmonic partials, each fading at its
// own rate. ratios/decays line up; gain is the loudest partial.
export function bell(k, out, t, base, ratios, decays, gain = 1, type = 'sine') {
  const { ctx } = k;
  let end = 0;
  ratios.forEach((ratio, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = base * ratio;
    const g = ctx.createGain();
    const d = decays[i] ?? decays[decays.length - 1];
    const peak = gain / (1 + i * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.02);
    end = Math.max(end, d);
  });
  return end;
}

// ------------------------------------------------------------------ birds

// A garden or meadow songbird: a short phrase of whistles and trills.
function songbird(k, out, t, r) {
  const base = ramp(r, 2400, 4200);
  const list = [];
  let at = 0;
  const style = Math.floor(r() * 3);
  const n = 4 + Math.floor(r() * 7);
  for (let i = 0; i < n; i++) {
    const dur = style === 1 ? ramp(r, 0.03, 0.05) : ramp(r, 0.05, 0.13);
    const f0 = style === 0 ? base * ramp(r, 0.8, 1.35) : base * (1 - i * 0.03);
    const f1 = f0 * (style === 2 ? ramp(r, 1.2, 1.6) : ramp(r, 0.7, 1.15));
    list.push({ at, dur, f0, f1, g: ramp(r, 0.5, 1) });
    at += dur + (style === 1 ? 0.025 : ramp(r, 0.03, 0.09));
  }
  return notes(k, out, t, 'sine', list).end;
}

// A skylark: a long, tumbling song high over the moor.
function skylark(k, out, t, r) {
  const list = [];
  let at = 0;
  const len = ramp(r, 5, 9);
  let f = ramp(r, 3000, 4200);
  while (at < len) {
    const dur = ramp(r, 0.03, 0.08);
    f = Math.min(5600, Math.max(2600, f * ramp(r, 0.82, 1.22)));
    list.push({ at, dur, f0: f, f1: f * ramp(r, 0.85, 1.25), g: ramp(r, 0.4, 1) });
    at += dur + ramp(r, 0.01, 0.05);
  }
  return notes(k, out, t, 'sine', list).end;
}

// Cuckoo: two soft falling notes, a few times over.
function cuckoo(k, out, t, r) {
  const hi = ramp(r, 640, 690);
  const list = [];
  const reps = 2 + Math.floor(r() * 3);
  for (let i = 0; i < reps; i++) {
    const at = i * ramp(r, 0.85, 1.0);
    list.push({ at, dur: 0.22, f0: hi, f1: hi * 0.98, atk: 0.04 });
    list.push({ at: at + 0.3, dur: 0.34, f0: hi * 0.8, f1: hi * 0.78, atk: 0.05 });
  }
  return notes(k, out, t, 'sine', list, { type: 'lowpass', freq: 1400 }).end;
}

// Curlew: a rising "cur-lee", then a bubbling trill.
function curlew(k, out, t, r) {
  const list = [];
  let at = 0;
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    list.push({ at, dur: 0.45, f0: 1500, f1: 2500, atk: 0.1 });
    at += 0.6;
  }
  for (let i = 0; i < 8; i++) {
    list.push({ at, dur: 0.07, f0: 2600 + i * 40, f1: 2300, g: 0.8 });
    at += 0.09;
  }
  return notes(k, out, t, 'sine', list).end;
}

// Crow or raven: harsh, nasal caws.
function crow(k, out, t, r, low = false) {
  const base = low ? ramp(r, 260, 320) : ramp(r, 380, 480);
  const list = [];
  const reps = 1 + Math.floor(r() * 3);
  for (let i = 0; i < reps; i++) list.push({ at: i * ramp(r, 0.32, 0.45), dur: ramp(r, 0.18, 0.28), f0: base * 1.1, f1: base * 0.85 });
  return notes(k, out, t, 'sawtooth', list, { freq: low ? 900 : 1300, q: 2.5 }).end;
}

// Gulls: a mewing cry, then a few quick laughing calls.
function gull(k, out, t, r) {
  const base = ramp(r, 1300, 1700);
  const list = [{ at: 0, dur: ramp(r, 0.35, 0.5), f0: base * 0.8, f1: base * 1.15, atk: 0.06 }];
  let at = 0.6;
  const reps = 2 + Math.floor(r() * 5);
  for (let i = 0; i < reps; i++) {
    list.push({ at, dur: 0.13, f0: base * 1.2, f1: base * 0.85, g: 1 - i * 0.08 });
    at += ramp(r, 0.16, 0.22);
  }
  return notes(k, out, t, 'sawtooth', list, { freq: 1900, q: 2 }).end;
}

// Golden eagle or buzzard: a long, falling "kee-arrr".
function raptor(k, out, t, r) {
  const f0 = ramp(r, 2400, 2900);
  const n = notes(k, out, t, 'sawtooth', [{ at: 0, dur: ramp(r, 1.0, 1.5), f0, f1: f0 * 0.62, atk: 0.08 }], { freq: 2300, q: 1.5 });
  vibrato(k, n.o, t, n.end, 24, 60);
  return n.end;
}

// Alpine marmot: a sharp alarm whistle.
function marmot(k, out, t, r) {
  const f = ramp(r, 2700, 3200);
  const list = [];
  for (let i = 0; i < 1 + Math.floor(r() * 3); i++) list.push({ at: i * ramp(r, 0.5, 0.9), dur: 0.18, f0: f, f1: f * 0.92, atk: 0.01 });
  return notes(k, out, t, 'sine', list).end;
}

// Alpine chough: a ringing "chee-ow".
function chough(k, out, t, r) {
  const list = [];
  for (let i = 0; i < 1 + Math.floor(r() * 3); i++) list.push({ at: i * ramp(r, 0.35, 0.6), dur: 0.24, f0: ramp(r, 2200, 2600), f1: 1400 });
  return notes(k, out, t, 'triangle', list).end;
}

// Tawny owl: "hoo ... hoo-hoo-hooo".
function owl(k, out, t, r) {
  const f = ramp(r, 370, 420);
  const n = notes(k, out, t, 'sine', [
    { at: 0, dur: 0.6, f0: f, f1: f * 0.97, atk: 0.12 },
    { at: 1.6, dur: 0.18, f0: f * 0.95, atk: 0.04 },
    { at: 1.95, dur: 0.9, f0: f, f1: f * 0.9, atk: 0.1 },
  ]);
  vibrato(k, n.o, t, n.end, 6, 8);
  return n.end;
}

// Woodpecker drumming on a dead tree.
function woodpecker(k, out, t, r) {
  const { ctx } = k;
  const src = ctx.createBufferSource();
  src.buffer = k.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = ramp(r, 1100, 1700);
  f.Q.value = 5;
  const g = ctx.createGain();
  g.gain.value = 0;
  const hits = 12 + Math.floor(r() * 12);
  let at = 0;
  for (let i = 0; i < hits; i++) {
    g.gain.setValueAtTime(1 - i / (hits * 1.4), t + at);
    g.gain.setTargetAtTime(0, t + at + 0.002, 0.006);
    at += 1 / (17 + i * 0.25);
  }
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + at + 0.1);
  return at + 0.1;
}

// ------------------------------------------------------------------ animals

// A sheep's quavering "baa" (lambs are higher).
function sheep(k, out, t, r) {
  const { ctx } = k;
  const lamb = r() < 0.3;
  const f = lamb ? ramp(r, 380, 480) : ramp(r, 190, 280);
  const dur = ramp(r, 0.6, 1.1);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * 1.06, t + dur * 0.3);
  o.frequency.linearRampToValueAtTime(f * 0.86, t + dur);
  vibrato(k, o, t, dur, ramp(r, 6, 8), f * 0.05);
  // The bleat's quaver: a tremolo on the level.
  const trem = ctx.createGain();
  trem.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = ramp(r, 9, 13);
  const ld = ctx.createGain();
  ld.gain.value = 0.4;
  lfo.connect(ld).connect(trem.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 0.06);
  g.gain.setValueAtTime(1, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  for (const [fq, q] of [[lamb ? 1000 : 750, 4], [lamb ? 1900 : 1350, 5]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fq;
    bp.Q.value = q;
    o.connect(bp).connect(trem);
  }
  trem.connect(g).connect(out);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
  return dur;
}

// A pony's whinny, ending in a snort.
function pony(k, out, t, r) {
  const f = ramp(r, 420, 520);
  const n = notes(k, out, t, 'sawtooth', [
    { at: 0, dur: 0.3, f0: f, f1: f * 2.3, atk: 0.05 },
    { at: 0.3, dur: 0.9, f0: f * 2.2, f1: f * 0.9, atk: 0.005 },
  ], { freq: 1500, q: 1.6 });
  vibrato(k, n.o, t, n.end, 11, 45);
  noiseBurst(k, out, t + 1.3, { freq: 700, type: 'lowpass', dur: 0.3, gain: 0.7, atk: 0.02 });
  return 1.7;
}

// Cowbells: a cow or two shifting about, each with its own bell.
function cowbell(k, out, t, r) {
  const base = ramp(r, 520, 820);
  let at = 0;
  const clanks = 1 + Math.floor(r() * 4);
  let end = 0;
  for (let i = 0; i < clanks; i++) {
    end = at + bell(k, out, t + at, base, [1, 1.51, 2.37, 3.6], [0.7, 0.45, 0.3, 0.15], ramp(r, 0.4, 1), 'triangle');
    noiseBurst(k, out, t + at, { freq: 2500, q: 2, dur: 0.03, gain: 0.3 });
    at += ramp(r, 0.25, 0.8);
  }
  return end;
}

// A dog barking a few streets away.
function dog(k, out, t, r) {
  const f = ramp(r, 280, 440);
  const list = [];
  let at = 0;
  for (let i = 0; i < 1 + Math.floor(r() * 4); i++) {
    list.push({ at, dur: ramp(r, 0.09, 0.15), f0: f * 1.4, f1: f * 0.8, atk: 0.008 });
    at += ramp(r, 0.2, 0.45);
  }
  return notes(k, out, t, 'sawtooth', list, { freq: 900, q: 1.5 }).end;
}

// ------------------------------------------------------------------ places

// Wind chimes on a porch: a few notes of a pentatonic scale.
function chimes(k, out, t, r) {
  const scale = [1047, 1175, 1319, 1568, 1760, 2093];
  let at = 0;
  let end = 0;
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    end = at + bell(k, out, t + at, scale[Math.floor(r() * scale.length)], [1, 2.76], [ramp(r, 1.5, 2.6), 0.6], ramp(r, 0.3, 0.7));
    at += ramp(r, 0.12, 0.5);
  }
  return end;
}

// A lawnmower or strimmer a few gardens away, starting up and wandering.
function mower(k, out, t, r) {
  const { ctx } = k;
  const dur = ramp(r, 8, 16);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = ramp(r, 46, 60);
  o.frequency.setValueAtTime(f * 0.6, t);
  o.frequency.linearRampToValueAtTime(f, t + 1);
  for (let a = 2; a < dur; a += ramp(r, 1, 2.5)) o.frequency.linearRampToValueAtTime(f * ramp(r, 0.85, 1.12), t + a);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 1.5);
  g.gain.setValueAtTime(1, t + dur - 2);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  return dur;
}

// A distant siren wailing across the city.
function siren(k, out, t, r) {
  const { ctx } = k;
  const dur = ramp(r, 7, 12);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  const lo = ramp(r, 600, 700), hi = lo * 1.9;
  o.frequency.setValueAtTime(lo, t);
  for (let a = 0, up = true; a < dur; a += 1.5, up = !up) o.frequency.linearRampToValueAtTime(up ? hi : lo, t + a + 1.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  return dur;
}

// A car horn a few blocks over.
function farHorn(k, out, t, r) {
  const len = r() < 0.5 ? 0.25 : 0.6;
  let end = 0;
  for (const hz of [ramp(r, 380, 420), ramp(r, 480, 520)]) end = notes(k, out, t, 'square', [{ at: 0, dur: len, f0: hz, g: 0.5 }], { type: 'lowpass', freq: 900 }).end;
  return end;
}

// A tram's "ding ding".
function tramBell(k, out, t, r) {
  const base = ramp(r, 1150, 1350);
  bell(k, out, t, base, [1, 2.0, 2.9], [0.9, 0.4, 0.2], 0.8);
  return 0.3 + bell(k, out, t + 0.3, base, [1, 2.0, 2.9], [0.9, 0.4, 0.2], 0.7);
}

// A bus or lorry letting off its air brakes.
function airHiss(k, out, t, r) {
  return noiseBurst(k, out, t, { freq: 3500, type: 'highpass', dur: ramp(r, 0.5, 0.9), gain: 0.8, atk: 0.01 });
}

// A wave breaking on the rocks below.
function wave(k, out, t, r) {
  const { ctx } = k;
  const dur = ramp(r, 4, 6.5);
  const src = ctx.createBufferSource();
  src.buffer = k.noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(ramp(r, 1800, 2800), t + 1.3);
  lp.frequency.exponentialRampToValueAtTime(350, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
  return dur;
}

// A foghorn far out to sea.
function foghorn(k, out, t) {
  let end = 0;
  for (const hz of [98, 99.3]) end = notes(k, out, t, 'sawtooth', [{ at: 0, dur: 3, f0: hz, atk: 0.5, g: 0.6 }], { type: 'lowpass', freq: 380 }).end;
  return end;
}

// A buoy's bell rocking in the swell.
function buoy(k, out, t, r) {
  return bell(k, out, t, ramp(r, 480, 560), [1, 2.4, 3.9], [2.2, 1.0, 0.5], 0.7);
}

// Thunder: a crack (when close) and a long, uneven rumble.
function thunder(k, out, t, r) {
  const { ctx } = k;
  const dur = ramp(r, 4, 7);
  const near = r() < 0.4;
  const src = ctx.createBufferSource();
  src.buffer = k.brown;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(near ? 900 : 300, t);
  lp.frequency.exponentialRampToValueAtTime(110, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(near ? 1 : 0.5, t + (near ? 0.05 : 0.6));
  for (let a = 0.8; a < dur - 0.5; a += ramp(r, 0.3, 0.9)) g.gain.linearRampToValueAtTime(ramp(r, 0.2, 0.7), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
  if (near) noiseBurst(k, out, t, { freq: 2000, type: 'highpass', dur: 0.25, gain: 0.5 });
  return dur;
}

// A village church bell tolling the hour.
function churchBell(k, out, t, r) {
  const base = ramp(r, 300, 380);
  const tolls = 3 + Math.floor(r() * 4);
  let end = 0;
  // A bell's hum, prime, tierce and quint, and the ring above.
  for (let i = 0; i < tolls; i++) end = i * 1.7 + bell(k, out, t + i * 1.7, base, [0.5, 1, 1.19, 1.5, 2, 2.5], [3.5, 2.5, 1.8, 1.5, 1.0, 0.6], 0.6);
  return end;
}

// A sawmill's blade biting into a log, then running free.
function saw(k, out, t, r) {
  const f = ramp(r, 900, 1200);
  const len = ramp(r, 2, 4);
  return notes(k, out, t, 'sawtooth', [
    { at: 0, dur: 0.6, f0: f * 1.3, f1: f, atk: 0.1, g: 0.6 },
    { at: 0.6, dur: len, f0: f * 0.82, f1: f * 0.78, atk: 0.05 },
    { at: 0.6 + len, dur: 1.2, f0: f * 1.25, f1: f * 1.3, atk: 0.1, g: 0.5 },
  ], { freq: 2200, q: 1.5 }).end;
}

// Everything the ambience can schedule, by name.
export const CALLS = {
  songbird, skylark, cuckoo, curlew, crow, raven: (k, o, t, r) => crow(k, o, t, r, true), gull, raptor, marmot, chough, owl, woodpecker,
  sheep, pony, cowbell, dog, chimes, mower, siren, farHorn, tramBell, airHiss, wave, foghorn, buoy, thunder, churchBell, saw,
};
