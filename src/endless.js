// Endless mode's custom settings: what can be set on the setup screen, the
// presets, saving, share links, and turning a setup into the road shape,
// traffic, rider physics and look that main.js applies.

import { store, TUNING, ENDLESS_TRAFFIC } from './settings.js';
import { BIOMES } from './levels.js';
import { ATMOSPHERE } from './sky.js';
import { GROUND_SETS } from './ground.js';

// Words for a slider value: the last step whose `at` it reaches.
const words = (...steps) => (v) => {
  let w = steps[0][1];
  for (const [at, label] of steps) if (v >= at - 1e-6) w = label;
  return w;
};

// A biome can be ridden once it has levels or its own sky or ground; the
// rest would just look like Alpine Meadows.
export const builtBiomes = () => BIOMES.filter((b) => b.levels.length || ATMOSPHERE[b.id] || GROUND_SETS[b.id]);

export const GROUPS = [
  {
    title: 'Road',
    items: [
      { id: 'steep', label: 'Steepness', min: 0.5, max: 1.8, step: 0.1, def: 1, show: words([0, 'Gentle'], [0.8, 'Normal'], [1.2, 'Steep'], [1.5, 'Extreme']) },
      { id: 'corners', label: 'Corners', min: 0, max: 2, step: 0.25, def: 1, show: words([0, 'None'], [0.25, 'Few'], [0.75, 'Normal'], [1.25, 'Lots'], [1.75, 'Non-stop']) },
      { id: 'sharp', label: 'Corner sharpness', min: 0, max: 2, step: 0.25, def: 1, show: words([0, 'Sweeping'], [0.5, 'Gentle'], [0.75, 'Normal'], [1.25, 'Tight'], [1.75, 'Hairpins']) },
      { id: 'grit', label: 'Grit on the road', min: 0, max: 3, step: 0.5, def: 1, show: words([0, 'None'], [0.5, 'A little'], [1, 'Normal'], [2, 'Lots']) },
    ],
  },
  {
    title: 'Rider',
    items: [
      { id: 'boost', label: 'Speed boost', min: 0, max: 1, step: 0.1, def: 0, show: words([0, 'Off'], [0.1, 'Small'], [0.4, 'Big'], [0.8, 'Rocket']), note: 'Tuck to boost' },
      { id: 'grip', label: 'Wheel grip', min: 0.6, max: 1.3, step: 0.05, def: 1, show: words([0, 'Icy'], [0.75, 'Slippy'], [0.95, 'Normal'], [1.1, 'Sticky']) },
      { id: 'gravity', label: 'Gravity', min: 0.4, max: 1.6, step: 0.1, def: 1, show: words([0, 'Floaty'], [0.7, 'Light'], [0.9, 'Earth'], [1.2, 'Heavy']) },
      { id: 'wind', label: 'Wind', min: -1, max: 1, step: 0.25, def: 0, show: words([-1, 'Strong headwind'], [-0.5, 'Headwind'], [0, 'Calm'], [0.25, 'Tailwind'], [0.75, 'Strong tailwind']) },
      { id: 'wobbles', label: 'Speed wobbles', options: [[true, 'On'], [false, 'Off']], def: true },
      { id: 'highsides', label: 'Highsides', options: [[true, 'On'], [false, 'Off']], def: true },
    ],
  },
  {
    // Only endless has these; the campaign levels never do.
    title: 'Endless specials',
    items: [
      { id: 'works', label: 'Roadworks', note: 'Cones and loose chippings', min: 0, max: 2, step: 0.5, def: 1, show: words([0, 'None'], [0.5, 'Few'], [1, 'Normal'], [1.5, 'Lots']) },
      { id: 'radar', label: 'Speed signs', note: 'Points for passing fast', options: [[true, 'On'], [false, 'Off']], def: true },
      { id: 'wilder', label: 'Gets wilder', note: 'Steeper and twistier as you go', options: [[true, 'On'], [false, 'Off']], def: true },
    ],
  },
  {
    title: 'World',
    items: [
      { id: 'biome', label: 'Biome', options: () => builtBiomes().map((b) => [b.id, b.name]), def: () => builtBiomes()[0]?.id ?? 'alpine' },
      { id: 'surface', label: 'Road surface', options: [['smooth', 'Smooth'], ['normal', 'Normal'], ['rough', 'Bumpy']], def: 'normal' },
      { id: 'weather', label: 'Weather', options: [['sunny', 'Sunny'], ['misty', 'Misty'], ['wet', 'Wet']], def: 'sunny' },
      { id: 'traffic', label: 'Traffic', min: 0, max: 3, step: 0.25, def: 1, show: words([0, 'None'], [0.25, 'Quiet'], [0.75, 'Normal'], [1.5, 'Busy'], [2.25, 'Rush hour']) },
      { id: 'carSpeed', label: 'Car speed', min: 0.6, max: 1.6, step: 0.1, def: 1, show: words([0, 'Slow'], [0.8, 'Normal'], [1.2, 'Fast']) },
    ],
  },
];
export const ITEMS = GROUPS.flatMap((g) => g.items);
const itemById = (id) => ITEMS.find((it) => it.id === id);
export const optionsOf = (it) => (typeof it.options === 'function' ? it.options() : it.options);
const defOf = (it) => (typeof it.def === 'function' ? it.def() : it.def);

export function defaults() {
  const cfg = { seed: randomSeed(), newRoad: true };
  for (const it of ITEMS) cfg[it.id] = defOf(it);
  return cfg;
}

export const PRESETS = [
  { name: 'Classic', set: {} },
  { name: 'Cruise', set: { steep: 0.7, corners: 0.75, sharp: 0.5, grit: 0, traffic: 0, wobbles: false, highsides: false, wilder: false } },
  { name: 'Twisty', set: { steep: 0.9, corners: 2, sharp: 1.75 } },
  { name: 'Speed run', set: { steep: 1.6, corners: 0.5, sharp: 0.5, boost: 0.5, wind: 0.5, wobbles: false } },
  { name: 'Moon', set: { gravity: 0.4, traffic: 0, grit: 0 } },
  { name: 'Ice', set: { grip: 0.6, sharp: 0.5, steep: 0.8 } },
  { name: 'Chaos', set: { steep: 1.4, corners: 1.5, sharp: 1.5, grit: 3, traffic: 3, carSpeed: 1.4, weather: 'wet', works: 2 } },
];

// A preset is every setting at its default apart from the ones it sets. The
// biome is where you ride, not how, so presets leave it alone.
const PRESET_ITEMS = ITEMS.filter((it) => it.id !== 'biome');
export function applyPreset(cfg, preset) {
  for (const it of PRESET_ITEMS) cfg[it.id] = preset.set[it.id] ?? defOf(it);
}

export function presetOf(cfg) {
  return PRESETS.find((p) => PRESET_ITEMS.every((it) => cfg[it.id] === (p.set[it.id] ?? defOf(it)))) || null;
}

// Keeps a value to what its control can show: a slider step or an option.
function clean(it, v) {
  if (it.options) {
    const opts = optionsOf(it);
    if (typeof opts[0][0] === 'boolean' && typeof v === 'string') v = v === 'true';
    return opts.some(([o]) => o === v) ? v : defOf(it);
  }
  v = Number(v);
  if (!Number.isFinite(v)) return defOf(it);
  v = Math.min(it.max, Math.max(it.min, v));
  return Number((Math.round((v - it.min) / it.step) * it.step + it.min).toFixed(2));
}

export function setValue(cfg, id, v) {
  cfg[id] = clean(itemById(id), v);
}

export function sliderStep(cfg, id, dir) {
  const it = itemById(id);
  setValue(cfg, id, cfg[id] + dir * it.step);
}

export function randomSeed() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

// Any text works as a seed; numbers are used as they are.
export function seedNumber(text) {
  const t = String(text).trim();
  if (/^\d{1,9}$/.test(t)) return Number(t);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

const KEY = 'powerslide.endless';

export function loadEndless() {
  const cfg = defaults();
  const saved = store.get(KEY, null);
  if (saved && typeof saved === 'object') {
    for (const it of ITEMS) if (it.id in saved) cfg[it.id] = clean(it, saved[it.id]);
    if (typeof saved.seed === 'string' && saved.seed.trim()) cfg.seed = saved.seed.slice(0, 24);
    if (typeof saved.newRoad === 'boolean') cfg.newRoad = saved.newRoad;
  }
  return cfg;
}

export function saveEndless(cfg) {
  store.set(KEY, cfg);
}

// Share links: ?level=endless&seed=…, plus each setting that isn't its default.
export function shareUrl(cfg) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('level', 'endless');
  url.searchParams.set('seed', cfg.seed);
  for (const it of ITEMS) if (cfg[it.id] !== defOf(it)) url.searchParams.set(it.id, String(cfg[it.id]));
  return url.toString();
}

// Reads a share link into a fresh setup; null when the link has no seed.
export function fromParams(params) {
  if (!params.get('seed')) return null;
  const cfg = defaults();
  cfg.seed = params.get('seed').slice(0, 24);
  cfg.newRoad = false;
  for (const it of ITEMS) if (params.has(it.id)) cfg[it.id] = clean(it, params.get(it.id));
  return cfg;
}

// Best scores are kept for each mix of settings (the road seed aside);
// the default mix keeps using the original endless best.
export function bestKey(cfg) {
  const changed = ITEMS.filter((it) => cfg[it.id] !== defOf(it)).map((it) => `${it.id}=${cfg[it.id]}`);
  return changed.length ? `powerslide.best.endless.${changed.join('&')}` : 'powerslide.best.endless';
}

const SURFACE = {
  smooth: { grip: 1.08, rolling: 0.7, look: { tone: 0.72, bump: 0.45 } },
  normal: { grip: 1, rolling: 1, look: { tone: 1, bump: 1 } },
  rough: { grip: 0.92, rolling: 2.2, look: { tone: 1.15, bump: 1.9 } },
};
const WET_GRIP = 0.72;
const MISTY_FOG = 5;
const WIND_SPEED = 8; // m/s at full slider
const BOOST = 2.5; // m/s² at full slider and full tuck

// Everything a setup changes, ready for main.js to apply.
export function derive(cfg) {
  const surface = SURFACE[cfg.surface] || SURFACE.normal;
  const wet = cfg.weather === 'wet';
  const grip = cfg.grip * surface.grip * (wet ? WET_GRIP : 1);
  return {
    seed: seedNumber(cfg.seed),
    shape: { steep: cfg.steep, corners: cfg.corners, sharp: cfg.sharp, grit: cfg.grit, wilder: cfg.wilder },
    extras: { works: cfg.works, radar: cfg.radar },
    traffic: { density: ENDLESS_TRAFFIC.density * cfg.traffic, speed: ENDLESS_TRAFFIC.speed * cfg.carSpeed },
    tuning: {
      ...TUNING,
      muStatic: TUNING.muStatic * grip,
      muKinetic: TUNING.muKinetic * grip,
      wobble: cfg.wobbles,
      highside: cfg.highsides,
    },
    mods: { gravity: cfg.gravity, wind: cfg.wind * WIND_SPEED, rolling: surface.rolling, boost: cfg.boost * BOOST },
    surface: { ...surface.look, wet: wet ? 1 : 0 },
    fog: cfg.weather === 'misty' ? MISTY_FOG : 1,
    biome: BIOMES.find((b) => b.id === cfg.biome) || builtBiomes()[0],
  };
}

// The same, for a campaign level: everything back to normal.
export const NORMAL = {
  shape: {},
  tuning: TUNING,
  mods: { gravity: 1, wind: 0, rolling: 1, boost: 0 },
  surface: { tone: 1, bump: 1, wet: 0 },
  fog: 1,
};

// A campaign level: normal, except that rain wets the road as endless's
// "wet" weather does, with the same loss of grip.
export function levelMix(level) {
  if (level?.sky?.weather !== 'rain') return NORMAL;
  return {
    ...NORMAL,
    tuning: { ...TUNING, muStatic: TUNING.muStatic * WET_GRIP, muKinetic: TUNING.muKinetic * WET_GRIP },
    surface: { ...NORMAL.surface, wet: 1 },
  };
}
