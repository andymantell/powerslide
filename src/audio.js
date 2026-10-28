// The game's sound, played from recordings (src/samples.js: CC0 sounds cut
// by tools/sounds/build.py, listed in credits.json) with WebAudio. Three
// buses, each with a volume on the Settings screen:
// - effects: the rider and board (wheels, slides, puck, brakes, wind, wobbles,
//   crashes, guardrails), traffic (engines by vehicle type, tyres, horns,
//   sirens) and menu and score sounds;
// - ambience: each biome's beds and wildlife, and the weather (ambience.js);
// - master over both.
// Safari only allows sound after a touch, so unlockOn() starts the audio on
// the first touch, click or key press. The recordings load then too; until
// they have, the game is silent.

import { store } from './settings.js';
import { Ambience, mixFor, spotsFor } from './ambience.js';
import { Samples } from './samples.js';

const VOICES = 5; // traffic engines heard at once

export const VOLUMES = [
  ['master', 'Master'],
  ['effects', 'Effects'],
  ['ambience', 'Ambience'],
];
const DEFAULT_VOLUME = { master: 0.8, effects: 1, ambience: 0.8 };
// Each bus's level at full volume, so the defaults balance.
const TRIM = { master: 0.9, effects: 1, ambience: 0.9 };

// Engines by vehicle type. sample: the engine recording, played at `pitch`
// when idling; rev: how far the revs climb through each gear; gears: top
// speed of each gear (m/s); bright: lowpass (Hz); tyre: road noise; horn:
// its recording and playback speed; siren: 'twoTone' or 'wail'. The traffic
// code names a car's type in car.kind.
const ENGINES = {
  car: { sample: 'engine-car', pitch: 1, rev: 1.6, gears: [8, 14, 20, 27, 99], bright: 4000, gain: 0.5, tyre: 0.5, horn: { sample: 'horn-car', rate: 1 } },
  taxi: { sample: 'engine-diesel', pitch: 1.05, rev: 1.5, gears: [8, 14, 20, 27, 99], bright: 3500, gain: 0.5, tyre: 0.5, horn: { sample: 'horn-car', rate: 1.1 } },
  van: { sample: 'engine-diesel', pitch: 0.95, rev: 1.4, gears: [7, 12, 18, 25, 99], bright: 3000, gain: 0.6, tyre: 0.6, horn: { sample: 'horn-car', rate: 0.9 } },
  suv: { sample: 'engine-big', pitch: 1, rev: 1.5, gears: [8, 14, 21, 28, 99], bright: 3000, gain: 0.6, tyre: 0.65, horn: { sample: 'horn-car', rate: 0.85 } },
  pickup: { sample: 'engine-big', pitch: 0.9, rev: 1.6, gears: [8, 14, 21, 28, 99], bright: 2800, gain: 0.7, tyre: 0.7, horn: { sample: 'horn-car', rate: 0.8 } },
  camper: { sample: 'engine-diesel', pitch: 0.9, rev: 1.3, gears: [7, 12, 17, 23, 99], bright: 2800, gain: 0.6, tyre: 0.65, horn: { sample: 'horn-car', rate: 0.85 } },
  bus: { sample: 'engine-bus', pitch: 1, rev: 1.2, gears: [5, 9, 13, 18, 99], bright: 2500, gain: 0.85, tyre: 0.9, horn: { sample: 'horn-bus', rate: 1 } },
  lorry: { sample: 'engine-lorry', pitch: 1, rev: 1.2, gears: [4, 7, 10, 13, 16, 20, 99], bright: 2500, gain: 0.95, tyre: 1.1, horn: { sample: 'horn-truck', rate: 1 } },
  tractor: { sample: 'engine-tractor', pitch: 1, rev: 0.6, gears: [3, 6, 9, 99], bright: 2500, gain: 0.8, tyre: 0.3, horn: { sample: 'horn-old', rate: 1 } },
  police: { sample: 'engine-car', pitch: 1.1, rev: 1.7, gears: [8, 14, 20, 27, 99], bright: 4000, gain: 0.55, tyre: 0.5, siren: 'twoTone', horn: { sample: 'horn-car', rate: 1.1 } },
  ambulance: { sample: 'engine-diesel', pitch: 1, rev: 1.4, gears: [7, 12, 18, 25, 99], bright: 3000, gain: 0.6, tyre: 0.6, siren: 'wail', horn: { sample: 'horn-car', rate: 0.9 } },
  fire: { sample: 'engine-lorry', pitch: 1.05, rev: 1.2, gears: [5, 9, 13, 18, 99], bright: 2500, gain: 0.9, tyre: 0.9, siren: 'twoTone', horn: { sample: 'horn-truck', rate: 1.05 } },
  icecream: { sample: 'engine-diesel', pitch: 0.95, rev: 1.3, gears: [7, 12, 17, 23, 99], bright: 2800, gain: 0.55, tyre: 0.6, chimes: true, horn: { sample: 'horn-car', rate: 1.2 } },
  horsebox: { sample: 'engine-big', pitch: 0.9, rev: 1.4, gears: [7, 12, 18, 25, 99], bright: 2800, gain: 0.65, tyre: 0.75, horn: { sample: 'horn-car', rate: 0.85 } },
  motorbike: { sample: 'engine-bike', pitch: 1, rev: 2.2, gears: [6, 11, 16, 21, 27, 99], bright: 6000, gain: 0.6, tyre: 0.25, horn: { sample: 'horn-car', rate: 1.4 } },
};
const SIRENS = { twoTone: 'siren-twotone', wail: 'siren-wail' };
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
    this.ready = false; // the recordings have loaded and the sounds are wired
    this.muted = false;
    this.paused = false;
    this.volume = { ...DEFAULT_VOLUME, ...store.get('powerslide.volume', {}) };
    this.scene = { biome: 'alpine' };
    this.weather = { rain: 0, wind: 0, thunder: false };
    this.hour = null;
    this.riding = false; // on a run
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
    for (const key of ['effects', 'ambience']) {
      this.bus[key] = ctx.createGain();
      this.bus[key].connect(this.master);
    }
    // Closes in the ambience between hedge banks (see setEcho's zones).
    this.ambMuffle = ctx.createBiquadFilter();
    this.ambMuffle.type = 'lowpass';
    this.ambMuffle.frequency.value = 20000;
    this.bus.ambience.disconnect();
    this.bus.ambience.connect(this.ambMuffle).connect(this.master);
    this.applyVolume();

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

    this.samples = new Samples(ctx);
    this.samples.load().then(() => this.build());
  }

  // Wires up the continuous sounds once the recordings are in.
  build() {
    const ctx = this.ctx;
    const fx = this.bus.effects;
    // ---- Rider and board.
    this.roll = this.loop('roll', 'lowpass', 6000, 0.7, fx);
    this.rumble = this.loop('roll-rough', 'lowpass', 500, 0.7, fx); // a bumpy road
    this.hiss = this.loop('wet', 'highpass', 400, 0.7, fx); // wet road
    this.wind = this.loop('rush', 'lowpass', 2000, 0.7, fx);
    this.buffet = this.loop('rush', 'lowpass', 160, 0.7, fx); // helmet buffeting
    this.slide = this.loop('slide', 'highpass', 200, 0.7, fx);
    this.squeal = this.loop('squeal', 'bandpass', 1500, 0.6, fx);
    this.gravel = this.loop('gravel', 'lowpass', 6000, 0.7, fx);
    this.grit = this.loop('gravel', 'highpass', 2500, 0.7, fx);
    this.puck = this.loop('puck', 'highpass', 700, 0.7, fx);
    this.shoe = this.loop('shoe', 'lowpass', 6000, 0.7, fx);
    this.scrape = this.loop('scrape', 'lowpass', 5000, 0.7, fx); // body or deck on the road
    this.railScrape = this.loop('rail-scrape', 'highpass', 400, 0.7, fx);
    this.skitter = this.loop('skitter', 'lowpass', 7000, 0.7, fx); // the loose board
    this.splash = this.loop('wade', 'lowpass', 7000, 0.7, fx); // wading through a ford
    this.grid = this.loop('grid', 'highpass', 150, 0.7, fx); // wheels drumming over a cattle grid
    this.flutter = this.loop('flap', 'bandpass', 600, 0.5, fx); // flapping leathers in an air brake
    // The trucks rattling in a wobble: the rough roll chopped at the wobble's beat.
    this.rattle = this.loop('roll-rough', 'bandpass', 1800, 1.5, fx);
    this.rattleLfo = this.am(this.rattle, 7);

    // ---- Traffic: each voice follows one car, with its own engine, tyres
    // and siren, panned to where it is.
    this.voices = [];
    for (let i = 0; i < VOICES; i++) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 3000;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      filt.connect(g).connect(pan).connect(fx);
      const tyre = this.loop('tyres', 'bandpass', 900, 0.5, pan);
      const sirenG = ctx.createGain();
      sirenG.gain.value = 0;
      sirenG.connect(pan);
      this.voices.push({ filt, g, pan, tyre, sirenG, eng: null, siren: null, car: null, prof: null, chimeT: 0 });
    }

    this.ambience = new Ambience(this.samples, this.bus.ambience);
    this.ready = true;
    this.applyScene();
  }

  // A recording looping through a filter, silent until set. src is null if
  // the recording didn't load.
  loop(name, type, freq, q, out) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    f.connect(g).connect(out);
    return { src: this.source(name, f), f, g };
  }

  // A looping source of a recording into `out`, from a random point.
  source(name, out) {
    const buf = this.samples.get(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(out);
    src.start(0, Math.random() * buf.duration);
    return src;
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
    const echo = e || this.scene.mix?.echo || { time: 0.25, feedback: 0, mix: 0 };
    const t = this.ctx.currentTime;
    this.delay.delayTime.setTargetAtTime(echo.time, t, 0.1);
    this.fb.gain.setTargetAtTime(clamp(echo.feedback, 0, 0.8), t, 0.1);
    this.fxSend.gain.setTargetAtTime(echo.mix * 0.5, t, 0.1);
    this.ambSend.gain.setTargetAtTime(echo.mix * 0.6, t, 0.1);
  }

  applyScene() {
    if (!this.ready || !this.scene.mix) return;
    const { mix, spots } = this.scene;
    this.ambience.setMix(mix, spots);
    this.ambience.weather = this.weather;
    this.ambience.hour = this.hour ?? mix.time ?? 13;
    this.setEcho(null);
  }

  // ------------------------------------------------------------ per frame
  set(node, param, value, tc = 0.05) {
    if (node) node[param].setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  update(player, cars, camera) {
    if (!this.ready || this.ctx.state !== 'running') return;
    // Time by the audio clock, so a slow frame rate doesn't slow the birds.
    const now = this.ctx.currentTime;
    const dt = clamp(now - (this.lastT ?? now), 0, 0.5);
    this.lastT = now;
    this.updateRider(player, dt);
    this.updateTraffic(player, cars, camera, dt);
    const cp = camera.position;
    this.ambience.update(dt, { x: cp.x, z: cp.z, yaw: player.yaw });
    // Galleries and tunnels ring with their own echo; hedge banks muffle.
    const zone = this.scene.zones?.find((z) => player.s >= z.s0 && player.s <= z.s1) || null;
    if (zone !== this.zone) {
      this.zone = zone;
      this.setEcho(zone?.echo);
      this.ambMuffle.frequency.setTargetAtTime(zone?.muffle || 20000, now, 0.4);
    }
  }

  updateRider(p, dt) {
    const crashed = p.crashed;
    const v = crashed || !this.onRoad ? 0 : p.speed;
    const wet = Math.max(this.weather.rain > 0.15 ? 1 : 0, this.scene.wet || 0);
    const rough = p.mods?.rolling ?? 1;
    const onGravel = p.surface === 'gravel' && !crashed;
    const sliding = !crashed && (p.slideMode || p.sliding) && v > 2;
    const slideAmt = sliding ? Math.min(1, Math.abs(Math.sin(p.slip)) * 1.3) * Math.min(1, v / 8) : 0;
    // The wheels' recordings play faster the faster you go.
    const wheelRate = clamp(0.6 + v * 0.03, 0.55, 1.6);

    // Wheels: a roar that rises with speed, grainier on a bumpy road.
    const texture = Math.sqrt(rough);
    this.set(this.roll.g, 'gain', Math.min(0.8, v * 0.033) * (0.5 + 0.5 * texture) * (onGravel ? 0.4 : 1) * (1 - slideAmt * 0.5));
    this.set(this.roll.src, 'playbackRate', wheelRate);
    this.set(this.roll.f, 'frequency', (1500 + v * 400) / (rough > 1.5 ? 1.5 : 1));
    this.set(this.rumble.g, 'gain', Math.min(0.5, v * 0.02) * clamp(rough - 0.8, 0, 1.2));
    this.set(this.rumble.src, 'playbackRate', wheelRate);
    this.set(this.hiss.g, 'gain', wet * Math.min(0.35, v * 0.02));
    this.set(this.hiss.src, 'playbackRate', clamp(0.8 + v * 0.015, 0.8, 1.3));
    const crunch = 0.7 + Math.random() * 0.6;
    this.set(this.gravel.g, 'gain', onGravel ? Math.min(0.8, v * 0.06) * crunch : 0, 0.02);
    this.set(this.gravel.src, 'playbackRate', clamp(0.7 + v * 0.03, 0.7, 1.5));
    this.set(this.grit.g, 'gain', crashed ? 0 : Math.min(1, p.dirt || 0) * Math.min(0.35, v * 0.03) * crunch, 0.02);

    // Wind: rises with the square of speed; a tuck cuts it, an air brake
    // catches it (and flaps the leathers).
    const air = p.airbrake || 0;
    const tuck = p.tuck || 0;
    this.set(this.wind.g, 'gain', Math.min(0.9, v * v * 0.0013) * (1 - tuck * 0.45) * (1 + air * 0.6));
    this.set(this.wind.f, 'frequency', 500 + v * 150 - tuck * 600);
    this.set(this.wind.src, 'playbackRate', clamp(0.85 + v * 0.01, 0.85, 1.25));
    this.set(this.buffet.g, 'gain', clamp((v - 10) * 0.03, 0, 0.6) * (1 - tuck * 0.6 + air));
    this.set(this.flutter.g, 'gain', air * Math.min(1, v / 15) * 0.45);
    this.set(this.flutter.src, 'playbackRate', clamp(0.8 + v * 0.025, 0.8, 1.6));

    // Slides: urethane hiss with a squeal on top; quieter and duller in the wet.
    const wetSlide = wet ? 0.6 : 1;
    this.set(this.slide.g, 'gain', slideAmt * 0.6 * wetSlide, 0.03);
    this.set(this.slide.src, 'playbackRate', clamp(0.85 + v * 0.012, 0.85, 1.25) * (wet ? 0.85 : 1));
    this.set(this.squeal.g, 'gain', slideAmt * slideAmt * 0.25 * (wet ? 0.15 : 1), 0.04);
    this.set(this.squeal.src, 'playbackRate', 0.9 + v * 0.008 + (Math.random() - 0.5) * 0.04, 0.02);

    // The puck on a glove scraping the road, crackling with sparks.
    const hand = !crashed && p.slideMode && p.handDown ? (p.handAmount || 0) * Math.min(1, v / 6) : 0;
    this.set(this.puck.g, 'gain', hand * 0.45, 0.03);
    if (hand > 0.3 && Math.random() < hand * dt * 35) this.grain('rail-scrape', 0.3 * hand);

    // A cattle grid (main.js sets this.onGrid): the wheels drumming over the
    // bars, faster the faster you cross.
    const grid = this.onGrid && v > 1 ? 1 : 0;
    this.set(this.grid.src, 'playbackRate', clamp(v / 10, 0.5, 2.2), 0.01);
    this.set(this.grid.g, 'gain', grid * Math.min(0.5, v * 0.04), 0.01);
    // A ford: a splash going in, then wading.
    const water = crashed ? 0 : p.water || 0;
    if (water > 0.005 && !this.wasWet && v > 1) this.shot('splash', Math.min(0.9, v * 0.07));
    this.wasWet = water > 0.005;
    this.set(this.splash.g, 'gain', Math.min(1, water * 12) * Math.min(0.5, v * 0.05), 0.03);
    this.set(this.splash.src, 'playbackRate', clamp(0.8 + v * 0.03, 0.8, 1.4));

    // Footbrake: a shoe sole juddering along the road.
    this.set(this.shoe.g, 'gain', crashed ? 0 : (p.brake || 0) * Math.min(1, v / 3) * 0.5 * (0.7 + Math.random() * 0.3), 0.02);
    this.set(this.shoe.src, 'playbackRate', clamp(0.8 + v * 0.03, 0.8, 1.4));

    // Pushing: the foot plants and scuffs back.
    const pt = p.pushT ?? -1;
    if (!crashed && pt >= 0 && (this.lastPushT < 0 || pt < this.lastPushT)) this.kick();
    this.lastPushT = pt;

    // Speed wobbles: the trucks rattle at the wobble's beat.
    this.set(this.rattle.g, 'gain', crashed ? 0 : Math.min(1, (p.wobble || 0) * 1.5) * Math.min(1, v / 15) * 0.6, 0.05);
    this.set(this.rattleLfo, 'frequency', 5 + v * 0.12);

    // Guardrail: a clang, then a metal scrape while you lean on it.
    this.set(this.railScrape.g, 'gain', this.ctx.currentTime - this.lastRail < 0.12 ? Math.min(0.45, v * 0.03) : 0, 0.05);

    // Crashing: thuds as the body lands, and leathers sliding on the road.
    const rag = p.ragdoll;
    if (crashed && rag) {
      if (rag.impacts > this.impacts) this.thud(Math.min(1, p.speed / 8 + 0.3));
      this.impacts = rag.impacts;
      this.set(this.scrape.g, 'gain', Math.min(0.5, p.speed * 0.05), 0.08);
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
      this.set(this.skitter.g, 'gain', down ? Math.min(0.45, h * 0.05) : 0, 0.04);
      this.set(this.skitter.src, 'playbackRate', clamp(0.6 + h * 0.08, 0.6, 1.6));
    } else {
      this.boardDown = true;
      this.set(this.skitter.g, 'gain', 0, 0.1);
    }
  }

  // Gives a traffic voice to a car: its engine recording and siren.
  assign(vc, car) {
    vc.eng?.stop();
    vc.siren?.stop();
    vc.car = car;
    vc.prof = car ? engineOf(car) : null;
    vc.eng = car ? this.source(vc.prof.sample, vc.filt) : null;
    vc.siren = car && vc.prof.siren ? this.source(SIRENS[vc.prof.siren], vc.sirenG) : null;
    vc.chimeT = 0;
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
        this.assign(free.shift(), c);
      }
      for (const vc of free) if (vc.car) this.assign(vc, null);
    }
    const right = { x: Math.cos(player.yaw), z: Math.sin(player.yaw) };
    const wet = this.weather.rain > 0.15 || this.scene.wet;
    for (const vc of this.voices) {
      const c = vc.car;
      if (!c || !cars.includes(c)) {
        if (c) this.assign(vc, null);
        this.set(vc.g, 'gain', 0, 0.2);
        this.set(vc.tyre.g, 'gain', 0, 0.2);
        this.set(vc.sirenG, 'gain', 0, 0.2);
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
      const revs = 1 + prof.rev * (g ? 0.35 + frac * 0.65 : frac);
      this.set(vc.eng, 'playbackRate', prof.pitch * revs ** 0.55 * doppler, 0.08);
      this.set(vc.filt, 'frequency', prof.bright * (0.6 + frac * 0.6), 0.1);
      const near = Math.min(0.4, 6 / (d + 6));
      this.set(vc.g, 'gain', near * prof.gain, 0.1);
      this.set(vc.tyre.g, 'gain', prof.tyre * Math.min(1, c.v / 20) * Math.min(0.4, 8 / (d + 8)) * (wet ? 1.6 : 1), 0.1);
      this.set(vc.tyre.f, 'frequency', wet ? 2200 : 600 + c.v * 20, 0.2);
      this.set(vc.tyre.src, 'playbackRate', clamp(0.7 + c.v * 0.02, 0.7, 1.4) * doppler, 0.2);
      this.set(vc.pan, 'pan', clamp((dx * right.x + dz * right.z) * inv, -1, 1), 0.1);
      // Sirens: a UK two-tone (police, fire) or a rising and falling wail
      // (ambulance), pitched by the doppler like the engine.
      const on = prof.siren && c.siren !== false && (c.siren || c.lights || c.blues);
      this.set(vc.siren, 'playbackRate', doppler, 0.05);
      this.set(vc.sirenG, 'gain', on ? Math.min(0.3, 10 / (d + 10)) : 0, 0.1);
      // The ice cream van plays its tune whenever it's close.
      if (prof.chimes && d < 160) {
        vc.chimeT -= dt;
        if (vc.chimeT <= 0) {
          vc.chimeT = 14;
          this.shot('icecream', Math.min(0.3, 12 / (d + 12)), 1, vc.pan);
        }
      }
    }
  }

  // ------------------------------------------------------------ one-shots
  // A recording played once (a random variant), at `gain` and `rate`.
  shot(name, gain = 1, rate = 1, out = this.bus?.effects) {
    if (!this.ready) return;
    const buf = this.samples.pick(name);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start();
    src.onended = () => g.disconnect();
  }

  // A few milliseconds from somewhere in a recording: a spark's crackle.
  grain(name, gain, len = 0.03) {
    const buf = this.samples.get(name);
    if (!buf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1.5 + Math.random();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(hp).connect(g).connect(this.bus.effects);
    src.start(t, Math.random() * (buf.duration - len));
    src.stop(t + len + 0.01);
  }

  crash() {
    this.shot('body', 1, 0.9);
    this.shot('board-hit', 0.6, 0.9 + Math.random() * 0.2);
  }

  thud(amount) {
    this.shot('body', 0.8 * amount, 0.9 + Math.random() * 0.25);
  }

  clack(amount) {
    // Maple deck and trucks hitting the road.
    this.shot('board-hit', 0.6 * amount, 1 + Math.random() * 0.25);
  }

  carHit() {
    this.shot('car-crash', 0.9);
    this.shot('body', 0.8);
  }

  rail() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // The first touch clangs; staying on the rail scrapes (see updateRider).
    if (now - this.lastRail > 0.4) this.shot('clang', 0.7, 0.9 + Math.random() * 0.15);
    this.lastRail = now;
  }

  kick() {
    this.shot('push', 0.6, 0.95 + Math.random() * 0.1);
  }

  honk(distance = 30, car = null) {
    const horn = engineOf(car).horn;
    this.shot(horn.sample, Math.min(0.6, 14 / distance), horn.rate);
  }

  // A hollow plastic knock for a cone.
  cone() {
    this.shot('cone', 0.6, 0.9 + Math.random() * 0.2);
  }

  ding() {
    this.shot('ding', 0.5);
  }

  // Menu sounds: click, back, move (controller focus), tick (a slider).
  ui(kind) {
    this.shot(`ui-${kind}`, kind === 'move' || kind === 'tick' ? 0.25 : 0.4);
  }

  // The finish: a fanfare, a little brighter for each star.
  fanfare(stars = 1) {
    this.shot('fanfare', 0.6, 1 + 0.06 * (stars - 1));
  }

  // A new biome unlocked, or another big moment.
  unlock() {
    this.shot('unlock', 0.6);
  }
}
