// Procedural audio with WebAudio: nothing is downloaded, every sound is made
// at run time. Four buses, each with a volume on the Settings screen:
// - effects: the rider and board (wheels, slides, puck, brakes, wind, wobbles,
//   crashes, guardrails), traffic (engines by vehicle type, tyres, horns) and
//   menu and score sounds;
// - ambience: each biome's beds and wildlife, and the weather (ambience.js);
// - music: an optional synthesised bed for each biome (music.js);
// - master over all three.
// Safari only allows sound after a touch, so unlockOn() starts the audio on
// the first touch, click or key press.

import { store } from './settings.js';
import { Ambience, mixFor, rainBuffer, spotsFor } from './ambience.js';
import { Music } from './music.js';
import { bell, noiseBurst } from './sfx.js';

const VOICES = 5; // traffic engines heard at once
const WHEEL_CIRC = 0.22; // m, a 70 mm wheel

export const VOLUMES = [
  ['master', 'Master'],
  ['effects', 'Effects'],
  ['ambience', 'Ambience'],
  ['music', 'Music'],
];
const DEFAULT_VOLUME = { master: 0.8, effects: 1, ambience: 0.8, music: 0.5 };
// Each bus's level at full volume, so the defaults balance.
const TRIM = { master: 0.9, effects: 1, ambience: 0.9, music: 0.7 };

// Engines by vehicle type. base: firing frequency at idle (Hz); rev: how far
// it climbs through each gear; gears: top speed of each gear (m/s); harm: the
// exhaust note's harmonics; bright: lowpass (Hz); tyre: road noise; horn:
// notes (Hz) and length (s). The traffic code names a car's type in car.kind.
const ENGINES = {
  car: { base: 32, rev: 1.6, gears: [8, 14, 20, 27, 99], harm: [1, 0.6, 0.9, 0.3, 0.5, 0.2, 0.25, 0.1], bright: 800, gain: 0.45, tyre: 0.5, horn: { notes: [392, 494], dur: 0.6 } },
  taxi: { base: 28, rev: 1.5, gears: [8, 14, 20, 27, 99], harm: [1, 0.5, 0.8, 0.5, 0.5, 0.4, 0.3, 0.25], bright: 750, gain: 0.45, tyre: 0.5, horn: { notes: [440, 554], dur: 0.35 } },
  van: { base: 26, rev: 1.4, gears: [7, 12, 18, 25, 99], harm: [1, 0.4, 0.7, 0.5, 0.5, 0.4, 0.35, 0.3, 0.25], bright: 650, gain: 0.55, tyre: 0.6, horn: { notes: [349, 440], dur: 0.6 } },
  suv: { base: 24, rev: 1.5, gears: [8, 14, 21, 28, 99], harm: [1, 0.9, 0.4, 0.8, 0.2, 0.5, 0.15, 0.3], bright: 600, gain: 0.6, tyre: 0.65, horn: { notes: [311, 392], dur: 0.6 } },
  pickup: { base: 21, rev: 1.6, gears: [8, 14, 21, 28, 99], harm: [1, 1, 0.4, 0.9, 0.2, 0.5, 0.15, 0.35], bright: 550, gain: 0.7, tyre: 0.7, horn: { notes: [294, 370], dur: 0.7 } },
  camper: { base: 23, rev: 1.3, gears: [7, 12, 17, 23, 99], harm: [1, 0.4, 0.7, 0.5, 0.5, 0.4, 0.35, 0.3], bright: 600, gain: 0.55, tyre: 0.65, horn: { notes: [330, 415], dur: 0.6 } },
  bus: { base: 16, rev: 1.2, gears: [5, 9, 13, 18, 99], harm: [1, 0.5, 0.8, 0.6, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3], bright: 520, gain: 0.9, tyre: 0.9, horn: { notes: [262, 330], dur: 0.8, type: 'sawtooth' } },
  lorry: { base: 15, rev: 1.2, gears: [4, 7, 10, 13, 16, 20, 99], harm: [1, 0.5, 0.8, 0.6, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3], bright: 500, gain: 1, tyre: 1.1, horn: { notes: [185, 233, 277], dur: 1.1, type: 'sawtooth' } },
  tractor: { base: 11, rev: 0.6, gears: [3, 6, 9, 99], harm: [1, 0.7, 0.6, 0.5, 0.5, 0.45, 0.4, 0.35], bright: 450, gain: 0.8, tyre: 0.3, horn: { notes: [330], dur: 0.4 } },
  police: { base: 30, rev: 1.7, gears: [8, 14, 20, 27, 99], harm: [1, 0.6, 0.9, 0.3, 0.5, 0.2, 0.25, 0.1], bright: 850, gain: 0.5, tyre: 0.5, siren: 'twoTone', horn: { notes: [392, 494], dur: 0.4 } },
  ambulance: { base: 26, rev: 1.4, gears: [7, 12, 18, 25, 99], harm: [1, 0.4, 0.7, 0.5, 0.5, 0.4, 0.35, 0.3, 0.25], bright: 650, gain: 0.55, tyre: 0.6, siren: 'wail', horn: { notes: [349, 440], dur: 0.5 } },
  fire: { base: 16, rev: 1.2, gears: [5, 9, 13, 18, 99], harm: [1, 0.5, 0.8, 0.6, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3], bright: 520, gain: 0.9, tyre: 0.9, siren: 'twoTone', horn: { notes: [185, 233, 277], dur: 1.0, type: 'sawtooth' } },
  icecream: { base: 25, rev: 1.3, gears: [7, 12, 17, 23, 99], harm: [1, 0.4, 0.7, 0.5, 0.5, 0.4, 0.35, 0.3], bright: 600, gain: 0.5, tyre: 0.6, chimes: true, horn: { notes: [523, 659], dur: 0.4 } },
  horsebox: { base: 24, rev: 1.4, gears: [7, 12, 18, 25, 99], harm: [1, 0.9, 0.4, 0.8, 0.2, 0.5, 0.15, 0.3], bright: 580, gain: 0.65, tyre: 0.75, horn: { notes: [311, 392], dur: 0.6 } },
  motorbike: { base: 55, rev: 2.4, gears: [6, 11, 16, 21, 27, 99], harm: [1, 0.3, 0.9, 0.2, 0.7, 0.2, 0.5, 0.1, 0.35], bright: 2200, gain: 0.55, tyre: 0.25, horn: { notes: [523], dur: 0.25 } },
};
const KINDS = {
  sedan: 'car', hatch: 'car', hatchback: 'car', estate: 'car', coupe: 'car', sports: 'car', cab: 'taxi',
  '4x4': 'suv', jeep: 'suv', offroad: 'suv', truck: 'lorry', hgv: 'lorry', tanker: 'lorry', coach: 'bus', minibus: 'van',
  'fire engine': 'fire', fireengine: 'fire', firetruck: 'fire', 'ice cream': 'icecream', 'ice cream van': 'icecream', icecreamvan: 'icecream', 'ice-cream': 'icecream',
  campervan: 'camper', motorhome: 'camper', motorcycle: 'motorbike', bike: 'motorbike', scooter: 'motorbike', moped: 'motorbike',
};
export function engineOf(car) {
  const k = String(car?.kind || car?.type || 'car').toLowerCase();
  return ENGINES[k] || ENGINES[KINDS[k]] || ENGINES[[...Object.keys(ENGINES)].find((e) => k.includes(e))] || ENGINES.car;
}

// A level's or the sky code's weather, as { rain, wind, thunder } (0..1).
export function weatherOf(w) {
  if (!w) return null;
  if (typeof w === 'string') {
    const rain = { drizzle: 0.25, wet: 0.3, showers: 0.45, rain: 0.6, storm: 0.9 }[w] ?? 0;
    const wind = { cloudy: 0.12, snow: 0.25, breezy: 0.3, windy: 0.6, storm: 0.8, gale: 1 }[w] ?? 0;
    return { rain, wind, thunder: w === 'storm' };
  }
  return { rain: w.rain ?? 0, wind: w.wind ?? 0, thunder: !!w.thunder };
}

// Hours from a number or a name: dawn, day, dusk, night.
function hourOf(h) {
  if (typeof h === 'number') return h;
  return { dawn: 6.5, morning: 9, day: 13, afternoon: 15, evening: 19, dusk: 19.8, night: 23 }[h] ?? null;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.volume = { ...DEFAULT_VOLUME, ...store.get('powerslide.volume', {}) };
    this.scene = { biome: 'alpine' };
    this.weather = { rain: 0, wind: 0, thunder: false };
    this.hour = null;
    this.riding = false; // on a run: music brings in the drums
    this.onRoad = false; // the rider is moving (not idling behind a menu)
    this.lastRail = -1;
    this.lastPushT = -1;
    this.impacts = 0;
    this.boardDown = true;
    this.assignT = 0;
  }

  // Starts the audio on the first touch, click or key (Safari needs one),
  // resumes it after the iPad interrupts it, and sleeps it while hidden.
  unlockOn(target = window) {
    const go = () => {
      this.start();
      if (this.ctx && this.ctx.state !== 'running' && !this.paused && !document.hidden) this.ctx.resume();
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) target.addEventListener(ev, go, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (!this.paused) this.ctx.resume();
    });
  }

  start() {
    if (this.ctx) {
      if (!this.paused) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    // Older iPads only unlock once something has played inside the touch.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.start(0);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.bus = {};
    for (const key of ['effects', 'ambience', 'music']) {
      this.bus[key] = ctx.createGain();
      this.bus[key].connect(this.master);
    }
    this.applyVolume();

    // Noise: white, and brown for low rumbles; rain is drops over a hiss.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }
    this.k = { ctx, noise: this.noise, brown: this.brown, rain: rainBuffer(ctx) };

    // An echo for canyon walls, streets and forests, fed by the effects and
    // ambience buses. Its level comes from the biome's mix.
    this.echoIn = ctx.createGain();
    const delay = (this.delay = ctx.createDelay(1));
    const fb = (this.fb = ctx.createGain());
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2500;
    this.echoIn.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(this.master);
    this.fxSend = ctx.createGain();
    this.ambSend = ctx.createGain();
    this.bus.effects.connect(this.fxSend).connect(this.echoIn);
    this.bus.ambience.connect(this.ambSend).connect(this.echoIn);

    const fx = this.bus.effects;
    // ---- Rider and board.
    this.roll = this.loop(this.noise, 'bandpass', 400, 0.8, fx);
    this.rumble = this.loop(this.brown, 'lowpass', 160, 0.7, fx);
    this.hiss = this.loop(this.noise, 'highpass', 2500, 0.7, fx); // wet road
    this.wind = this.loop(this.noise, 'bandpass', 800, 0.5, fx);
    this.buffet = this.loop(this.brown, 'lowpass', 140, 0.7, fx); // helmet buffeting
    this.slide = this.loop(this.noise, 'bandpass', 2200, 2.5, fx);
    this.gravel = this.loop(this.brown, 'bandpass', 900, 0.6, fx);
    this.grit = this.loop(this.noise, 'bandpass', 3200, 1.2, fx);
    this.puck = this.loop(this.noise, 'highpass', 2800, 0.7, fx);
    this.shoe = this.loop(this.noise, 'bandpass', 650, 1.2, fx);
    this.scrape = this.loop(this.noise, 'bandpass', 1200, 0.8, fx); // body or deck on the road
    this.railScrape = this.loop(this.noise, 'bandpass', 3800, 6, fx);
    this.skitter = this.loop(this.noise, 'bandpass', 600, 1, fx); // the loose board
    // Urethane squeal on top of the slide hiss, and the bearings' hum.
    this.squeal = this.tone('sawtooth', 1000, 'bandpass', 1000, 8, fx);
    this.bearing = this.tone('triangle', 200, 'lowpass', 1200, 0.7, fx);
    // Flapping leathers in an air brake, and the trucks rattling in a wobble.
    this.flutter = this.loop(this.noise, 'bandpass', 320, 1, fx);
    this.flutterLfo = this.am(this.flutter, 14);
    this.rattle = this.loop(this.noise, 'bandpass', 1800, 3, fx);
    this.rattleLfo = this.am(this.rattle, 7);

    // ---- Traffic.
    this.waves = new Map();
    this.voices = [];
    for (let i = 0; i < VOICES; i++) {
      const osc = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(filt).connect(g).connect(pan).connect(fx);
      osc.start();
      const tyre = this.loop(this.noise, 'bandpass', 700, 0.8, pan);
      // Emergency vehicles' sirens, silent until a voice has one.
      const siren = this.tone('triangle', 700, 'lowpass', 2500, 0.7, pan);
      this.voices.push({ osc, filt, g, pan, tyre, siren, car: null, prof: null, chimeT: 0 });
    }

    this.ambience = new Ambience(this.k, this.bus.ambience);
    this.music = new Music(ctx, this.bus.music, this.noise);
    this.applyVolume();
    this.applyScene();
  }

  // A looping noise source through a filter, silent until set.
  loop(buffer, type, freq, q, out = this.master) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(out);
    src.start(0, Math.random() * 1.5);
    return { src, f, g };
  }

  // A steady oscillator through a filter, silent until set.
  tone(type, freq, ftype, ffreq, q, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.frequency.value = ffreq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(out);
    o.start();
    return { o, f, g };
  }

  // Chops a loop on and off at `rate` Hz; returns the LFO to retune.
  am(node, rate) {
    const ctx = this.ctx;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    node.f.disconnect();
    node.f.connect(chop).connect(node.g);
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chop.gain);
    lfo.start();
    return lfo;
  }

  // ------------------------------------------------------------ settings
  setMuted(m) {
    this.muted = m;
    this.applyVolume();
  }

  setVolume(key, v) {
    this.volume[key] = clamp(v, 0, 1);
    store.set('powerslide.volume', this.volume);
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const curve = (key) => this.volume[key] ** 2 * TRIM[key];
    this.master.gain.setTargetAtTime(this.muted ? 0 : curve('master'), t, 0.05);
    for (const key of Object.keys(this.bus)) this.bus[key].gain.setTargetAtTime(curve(key), t, 0.05);
    this.music?.setOn(!this.muted && this.volume.music > 0 && this.volume.master > 0);
  }

  // The game pauses: everything stops, and stays stopped until unpaused.
  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }

  // ------------------------------------------------------------ hooks
  // The world being ridden: called when a level or endless road is loaded.
  // biome: id; level: its JSON (ambience, weather, time); road: for placing
  // the level's ambience spots; mix: endless mode's derive() (wet road, wind).
  setScene({ biome = 'alpine', level = null, road = null, mix = null } = {}) {
    const change = level?.ambience || {};
    // Sounds the level's set pieces make, plus any it places by hand.
    const auto = spotsFor(level);
    const place = (s) => {
      const f = road.sample(road.start + s.at, {});
      return { ...s, x: f.x + f.rightX * (s.d || 0), z: f.z + f.rightZ * (s.d || 0) };
    };
    const spots = road ? [...auto.spots, ...(change.spots || [])].map(place) : [];
    const zones = road ? [...auto.zones, ...(change.zones || [])].map((z) => ({ ...z, s0: road.start + z.from, s1: road.start + z.to })) : [];
    const wet = mix?.surface?.wet || 0;
    const fromMix = mix && { rain: wet ? 0.3 : 0, wind: Math.min(1, Math.abs(mix.mods?.wind || 0) / 8), thunder: false };
    const sky = level?.sky || {};
    this.scene = { biome, mix: mixFor(biome, change), spots, zones, wet };
    this.weather = weatherOf(level?.weather ?? sky.weather) || fromMix || { rain: 0, wind: 0, thunder: false };
    if (wet && !this.weather.rain && sky.weather === undefined) this.weather.rain = 0.3;
    this.hour = hourOf(level?.time ?? sky.time);
    this.zone = null;
    this.applyScene();
  }

  // Rain, wind (0..1) and thunder; leave a field out to keep it as it is.
  setWeather(w) {
    Object.assign(this.weather, typeof w === 'string' ? weatherOf(w) : w);
    if (this.ambience) this.ambience.weather = this.weather;
  }

  // Hours, 0..24 (night is before 6 and after 20:30), or 'day' / 'night'.
  setTimeOfDay(h) {
    this.hour = hourOf(h);
    if (this.ambience) this.ambience.hour = this.hour ?? this.scene.mix.time ?? 13;
  }

  // An echo, e.g. for a tunnel or a gorge: { time (s), feedback, mix }; null
  // goes back to the biome's.
  setEcho(e) {
    if (!this.ctx) return;
    const echo = e || this.scene.mix.echo || { time: 0.25, feedback: 0, mix: 0 };
    const t = this.ctx.currentTime;
    this.delay.delayTime.setTargetAtTime(echo.time, t, 0.1);
    this.fb.gain.setTargetAtTime(clamp(echo.feedback, 0, 0.8), t, 0.1);
    this.fxSend.gain.setTargetAtTime(echo.mix * 0.5, t, 0.1);
    this.ambSend.gain.setTargetAtTime(echo.mix * 0.6, t, 0.1);
  }

  applyScene() {
    if (!this.ctx) return;
    const { biome, mix, spots } = this.scene;
    this.ambience.setMix(mix, spots);
    this.ambience.weather = this.weather;
    this.ambience.hour = this.hour ?? mix.time ?? 13;
    this.music.setBiome(biome);
    this.setEcho(null);
  }

  // ------------------------------------------------------------ per frame
  set(node, param, value, tc = 0.05) {
    node[param].setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  update(player, cars, camera) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // Time by the audio clock, so a slow frame rate doesn't slow the birds.
    const now = this.ctx.currentTime;
    const dt = clamp(now - (this.lastT ?? now), 0, 0.5);
    this.lastT = now;
    this.updateRider(player, dt);
    this.updateTraffic(player, cars, camera, dt);
    const cp = camera.position;
    this.ambience.update(dt, { x: cp.x, z: cp.z, yaw: player.yaw });
    // Galleries and tunnels ring with their own echo.
    const zone = this.scene.zones?.find((z) => player.s >= z.s0 && player.s <= z.s1) || null;
    if (zone !== this.zone) {
      this.zone = zone;
      this.setEcho(zone?.echo);
    }
    this.music.riding = this.riding ? 1 : 0;
    this.music.speed = clamp(player.speed / 25, 0, 1);
  }

  updateRider(p, dt) {
    const crashed = p.crashed;
    const v = crashed || !this.onRoad ? 0 : p.speed;
    const wet = Math.max(this.weather.rain > 0.15 ? 1 : 0, this.scene.wet || 0);
    const rough = p.mods?.rolling ?? 1;
    const onGravel = p.surface === 'gravel' && !crashed;
    const sliding = !crashed && (p.slideMode || p.sliding) && v > 2;
    const slideAmt = sliding ? Math.min(1, Math.abs(Math.sin(p.slip)) * 1.3) * Math.min(1, v / 8) : 0;

    // Wheels: a roar that rises with speed, grainier on a bumpy road.
    const texture = Math.sqrt(rough);
    this.set(this.roll.g, 'gain', Math.min(0.5, v * 0.02) * (0.5 + 0.5 * texture) * (onGravel ? 0.4 : 1) * (1 - slideAmt * 0.5));
    this.set(this.roll.f, 'frequency', (250 + v * 35) / (rough > 1.5 ? 1.3 : 1));
    this.set(this.rumble.g, 'gain', Math.min(0.3, v * 0.012) * Math.min(1.6, rough ** 0.7));
    this.set(this.bearing.o, 'frequency', Math.max(20, (v / WHEEL_CIRC) * 2));
    this.set(this.bearing.g, 'gain', Math.min(0.025, v * 0.0015));
    this.set(this.hiss.g, 'gain', wet * Math.min(0.3, v * 0.018));
    const crunch = 0.6 + Math.random() * 0.8;
    this.set(this.gravel.g, 'gain', onGravel ? Math.min(0.8, v * 0.06) * crunch : 0, 0.02);
    this.set(this.grit.g, 'gain', crashed ? 0 : Math.min(1, p.dirt || 0) * Math.min(0.35, v * 0.03) * crunch, 0.02);

    // Wind: rises with the square of speed; a tuck cuts it, an air brake
    // catches it (and flaps the leathers).
    const air = p.airbrake || 0;
    const tuck = p.tuck || 0;
    this.set(this.wind.g, 'gain', Math.min(0.65, v * v * 0.0008) * (1 - tuck * 0.45) * (1 + air * 0.6));
    this.set(this.wind.f, 'frequency', 450 + v * 28 - tuck * 120);
    this.set(this.buffet.g, 'gain', clamp((v - 10) * 0.025, 0, 0.5) * (1 - tuck * 0.6 + air));
    this.set(this.flutter.g, 'gain', air * Math.min(1, v / 15) * 0.3);
    this.set(this.flutterLfo, 'frequency', 9 + v * 0.4);

    // Slides: urethane hiss with a squeal on top; quieter and duller in the wet.
    const wetSlide = wet ? 0.6 : 1;
    this.set(this.slide.g, 'gain', slideAmt * 0.55 * wetSlide, 0.03);
    this.set(this.slide.f, 'frequency', (1600 + v * 40) * (wet ? 0.7 : 1));
    this.set(this.squeal.g, 'gain', slideAmt * slideAmt * 0.07 * (wet ? 0.15 : 1), 0.04);
    this.set(this.squeal.o, 'frequency', 850 + v * 18 + (Math.random() - 0.5) * 120, 0.02);
    this.set(this.squeal.f, 'frequency', 900 + v * 20);

    // The puck on a glove scraping the road, crackling with sparks.
    const hand = !crashed && p.slideMode && p.handDown ? (p.handAmount || 0) * Math.min(1, v / 6) : 0;
    this.set(this.puck.g, 'gain', hand * 0.4, 0.03);
    if (hand > 0.3 && Math.random() < hand * dt * 35) {
      noiseBurst(this.k, this.bus.effects, this.ctx.currentTime, { freq: 4000 + Math.random() * 4000, type: 'highpass', dur: 0.015, gain: 0.25 * hand });
    }

    // Footbrake: a shoe sole juddering along the road.
    this.set(this.shoe.g, 'gain', crashed ? 0 : (p.brake || 0) * Math.min(1, v / 3) * 0.45 * (0.6 + Math.random() * 0.4), 0.02);

    // Pushing: the foot plants, then scuffs back.
    const pt = p.pushT ?? -1;
    if (!crashed && pt >= 0 && (this.lastPushT < 0 || pt < this.lastPushT)) this.kick();
    this.lastPushT = pt;

    // Speed wobbles: the trucks rattle at the wobble's beat.
    this.set(this.rattle.g, 'gain', crashed ? 0 : Math.min(1, (p.wobble || 0) * 1.5) * Math.min(1, v / 15) * 0.5, 0.05);
    this.set(this.rattleLfo, 'frequency', 5 + v * 0.12);

    // Guardrail: a clang, then a metal scrape while you lean on it.
    this.set(this.railScrape.g, 'gain', this.ctx.currentTime - this.lastRail < 0.12 ? Math.min(0.35, v * 0.025) : 0, 0.05);

    // Crashing: thuds as the body lands, and leathers sliding on the road.
    const rag = p.ragdoll;
    if (crashed && rag) {
      if (rag.impacts > this.impacts) this.thud(Math.min(1, p.speed / 8 + 0.3));
      this.impacts = rag.impacts;
      this.set(this.scrape.g, 'gain', Math.min(0.4, p.speed * 0.04), 0.08);
    } else {
      this.impacts = 0;
      this.set(this.scrape.g, 'gain', 0, 0.1);
    }
    // The loose board: clacks as it lands, wheels or deck skittering along.
    const lb = p.boardLoose && p.looseBoard;
    if (lb) {
      const down = lb.board.position.y <= (lb.floor ?? -Infinity) + 0.03;
      const h = Math.hypot(lb.vel.x, lb.vel.z);
      if (down && !this.boardDown) this.clack(Math.min(1, h / 10 + 0.3));
      this.boardDown = down;
      this.set(this.skitter.g, 'gain', down ? Math.min(0.35, h * 0.04) : 0, 0.04);
      this.set(this.skitter.f, 'frequency', 400 + h * 60);
    } else {
      this.boardDown = true;
      this.set(this.skitter.g, 'gain', 0, 0.1);
    }
  }

  // A cached PeriodicWave for an engine type.
  wave(prof) {
    if (!this.waves.has(prof)) {
      const real = new Float32Array(prof.harm.length + 1);
      const imag = new Float32Array([0, ...prof.harm]);
      this.waves.set(prof, this.ctx.createPeriodicWave(real, imag));
    }
    return this.waves.get(prof);
  }

  updateTraffic(player, cars, camera, dt) {
    const cp = camera.position;
    // Give the voices to the nearest cars, a few times a second.
    this.assignT -= dt;
    if (this.assignT <= 0) {
      this.assignT = 0.25;
      const near = cars
        .map((c) => ({ c, d: Math.hypot(c.x - cp.x, c.z - cp.z) }))
        .filter((e) => e.d < 260)
        .sort((a, b) => a.d - b.d)
        .slice(0, VOICES)
        .map((e) => e.c);
      // Keep voices on cars they already have, so nothing jumps.
      const free = this.voices.filter((vc) => !near.includes(vc.car));
      for (const c of near) {
        if (this.voices.some((vc) => vc.car === c)) continue;
        const vc = free.shift();
        vc.car = c;
        vc.prof = engineOf(c);
        vc.osc.setPeriodicWave(this.wave(vc.prof));
      }
      for (const vc of free) vc.car = null;
    }
    const right = { x: Math.cos(player.yaw), z: Math.sin(player.yaw) };
    const wet = this.weather.rain > 0.15 || this.scene.wet;
    for (const vc of this.voices) {
      const c = vc.car;
      if (!c || !cars.includes(c)) {
        vc.car = null;
        this.set(vc.g, 'gain', 0, 0.2);
        this.set(vc.tyre.g, 'gain', 0, 0.2);
        this.set(vc.siren.g, 'gain', 0, 0.2);
        continue;
      }
      const prof = vc.prof;
      const dx = c.x - cp.x, dz = c.z - cp.z;
      const d = Math.hypot(dx, dz);
      const inv = 1 / Math.max(d, 0.1);
      // Doppler from the closing speed.
      const cvx = Math.sin(c.yaw) * c.v;
      const cvz = -Math.cos(c.yaw) * c.v;
      const radial = ((cvx - player.vel.x) * dx + (cvz - player.vel.y) * dz) * inv;
      const doppler = 343 / (343 + clamp(radial, -120, 120));
      // Revs climb through each gear and drop at the change.
      const gears = prof.gears;
      let g = 0;
      while (g < gears.length - 1 && c.v > gears[g]) g++;
      const lo = g ? gears[g - 1] : 0;
      const frac = clamp((c.v - lo) / Math.max(1, Math.min(gears[g], lo + 12) - lo), 0, 1);
      const f = prof.base * (1 + prof.rev * (g ? 0.35 + frac * 0.65 : frac));
      this.set(vc.osc, 'frequency', f * doppler, 0.08);
      this.set(vc.filt, 'frequency', prof.bright * (0.6 + frac * 0.6), 0.1);
      const near = Math.min(0.35, 6 / (d + 6));
      this.set(vc.g, 'gain', near * prof.gain, 0.1);
      this.set(vc.tyre.g, 'gain', prof.tyre * Math.min(1, c.v / 20) * Math.min(0.4, 8 / (d + 8)) * (wet ? 1.6 : 1), 0.1);
      this.set(vc.tyre.f, 'frequency', wet ? 2200 : 500 + c.v * 15, 0.2);
      this.set(vc.pan, 'pan', clamp((dx * right.x + dz * right.z) * inv, -1, 1), 0.1);
      // Sirens: a UK two-tone (police, fire) or a rising and falling wail
      // (ambulance), pitched by the doppler like the engine.
      const now = this.ctx.currentTime;
      const on = prof.siren && c.siren !== false && (c.siren || c.lights || c.blues);
      if (on) {
        const pitch = prof.siren === 'wail' ? 650 + 550 * (0.5 - 0.5 * Math.cos(now * Math.PI * 0.8)) : Math.floor(now / 0.55) % 2 ? 600 : 800;
        this.set(vc.siren.o, 'frequency', pitch * doppler, prof.siren === 'wail' ? 0.05 : 0.01);
      }
      this.set(vc.siren.g, 'gain', on ? Math.min(0.25, 10 / (d + 10)) * 0.8 : 0, 0.1);
      // The ice cream van plays its tune whenever it's close.
      if (prof.chimes && d < 160) {
        vc.chimeT -= dt;
        if (vc.chimeT <= 0) {
          vc.chimeT = 7;
          this.icecream(vc.pan, Math.min(0.2, 12 / (d + 12)) * 0.9);
        }
      }
    }
  }

  // ------------------------------------------------------------ one-shots
  burst(freq, q, dur, gain, type = 'bandpass', sweepTo = null) {
    if (!this.ctx) return;
    noiseBurst(this.k, this.bus.effects, this.ctx.currentTime, { freq, q, dur, gain, type, sweep: sweepTo });
  }

  // A low thump, for bodies and boards hitting the ground.
  thump(freq, gain, dur) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus.effects);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  crash() {
    if (!this.ctx) return;
    this.burst(800, 0.7, 1.2, 1.2, 'lowpass', 120);
    this.burst(3000, 1, 0.4, 0.5);
    this.thump(90, 0.9, 0.3);
  }

  thud(amount) {
    this.burst(500, 0.8, 0.25, 0.8 * amount, 'lowpass', 150);
    this.thump(70 + Math.random() * 30, 0.7 * amount, 0.2);
  }

  clack(amount) {
    // Maple deck and trucks hitting the road.
    this.burst(1400, 3, 0.08, 0.6 * amount);
    this.thump(160, 0.4 * amount, 0.08);
  }

  carHit() {
    if (!this.ctx) return;
    this.crash();
    bell(this.k, this.bus.effects, this.ctx.currentTime, 210, [1, 1.7, 2.9, 4.3], [0.5, 0.3, 0.2, 0.1], 0.35, 'sawtooth');
  }

  rail() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // The first touch clangs; staying on the rail scrapes (see updateRider).
    if (now - this.lastRail > 0.4) {
      bell(this.k, this.bus.effects, now, 330 + Math.random() * 40, [1, 2.76, 5.4, 8.9], [0.6, 0.4, 0.25, 0.15], 0.35);
      this.burst(2400, 8, 0.25, 0.5);
      this.burst(600, 2, 0.15, 0.4);
    }
    this.lastRail = now;
  }

  kick() {
    const t = this.ctx.currentTime;
    noiseBurst(this.k, this.bus.effects, t, { freq: 300, type: 'lowpass', dur: 0.08, gain: 0.5 });
    noiseBurst(this.k, this.bus.effects, t + 0.05, { freq: 1300, q: 0.8, dur: 0.3, gain: 0.25, atk: 0.04, sweep: 500 });
  }

  honk(distance = 30, car = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const horn = engineOf(car).horn;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const vol = Math.min(0.5, 12 / distance);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + horn.dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + horn.dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = horn.type === 'sawtooth' ? 1400 : 1800;
    g.connect(f).connect(this.bus.effects);
    for (const hz of horn.notes) {
      const o = ctx.createOscillator();
      o.type = horn.type || 'square';
      o.frequency.value = hz;
      o.connect(g);
      o.start(t);
      o.stop(t + horn.dur + 0.05);
    }
  }

  // An ice cream van's tinny tune, into a vehicle's panner.
  icecream(out, gain) {
    const t = this.ctx.currentTime + 0.02;
    const tune = [659, 784, 880, 784, 659, 587, 523, 587, 659, 523];
    const o = this.ctx.createOscillator();
    o.type = 'square';
    const g = this.ctx.createGain();
    g.gain.value = 0;
    tune.forEach((f, i) => {
      const at = t + i * 0.28;
      o.frequency.setValueAtTime(f, at);
      g.gain.setValueAtTime(gain, at);
      g.gain.setTargetAtTime(gain * 0.25, at + 0.02, 0.08);
    });
    g.gain.setTargetAtTime(0, t + tune.length * 0.28, 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + tune.length * 0.28 + 0.4);
  }

  // A hollow plastic knock for a cone.
  cone() {
    if (!this.ctx) return;
    this.burst(700, 3, 0.18, 0.5, 'bandpass', 300);
  }

  ding() {
    this.chime([880, 1320], 0.25);
  }

  // Notes one after another, as a bright little chime.
  chime(freqs, gain = 0.2, gap = 0.08, len = 0.35) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    freqs.forEach((f, i) => o.frequency.setValueAtTime(f, t + i * gap));
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + gap * (freqs.length - 1) + len);
    o.connect(g).connect(this.bus.effects);
    o.start(t);
    o.stop(t + gap * (freqs.length - 1) + len + 0.05);
  }

  // Menu sounds: click, back, move (controller focus), tick (a slider).
  ui(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const [f0, f1, gain, dur] = {
      click: [900, 1300, 0.12, 0.05],
      back: [700, 450, 0.1, 0.06],
      move: [1500, 1500, 0.04, 0.025],
      tick: [1800, 1800, 0.05, 0.02],
    }[kind] || [900, 1300, 0.12, 0.05];
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus.effects);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // The finish: a rising fanfare, a note higher for each star.
  fanfare(stars = 1) {
    this.chime([523, 659, 784, 1047, 1319].slice(0, 2 + stars), 0.25, 0.13, 0.6);
  }

  // A new biome unlocked, or another big moment.
  unlock() {
    this.chime([784, 988, 1175, 1568], 0.22, 0.09, 0.9);
  }
}
