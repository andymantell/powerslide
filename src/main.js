import * as THREE from 'three';
import { Road, START_S, setRoadWidth } from './road.js';
import { Terrain } from './terrain.js';
import { RoadMesh } from './roadmesh.js';
import { Player } from './player.js';
import { Traffic, carLights } from './traffic.js';
import { Input } from './input.js';
import { Audio, VOLUMES } from './audio.js';
import { TILT_SENSITIVITIES } from './tilt.js';
import { SlideMarks } from './marks.js';
import { Sparks } from './sparks.js';
import { createSky, SUN_DIR, atmosphereFor, ENV } from './sky.js';
import { Precipitation } from './weather.js';
import { Post } from './post.js';
import { texturesReady, GROUND_SETS } from './ground.js';
import { MARKINGS } from './roadmat.js';
import { Forest } from './forest.js';
import { Boulders } from './boulders.js';
import { Grass } from './grass.js';
import { Props } from './props.js';
import { Structures } from './structures.js';
import { dressLevel } from './dressing.js';
import { Scenery } from './scenery.js';
import { WHEEL_R } from './rider.js';
import { lerp } from './noise.js';
import { watchForUpdates } from './version.js';
import { registerOffline, keepSaves } from './pwa.js';
import { exportCode, importCode, hasProgress } from './transfer.js';
import { store, loadSettings, QUALITY, QUALITY_ORDER, autoQuality } from './settings.js';
import { lookOf } from './biomes.js';
import { GROUPS, PRESETS, optionsOf, defaults as endlessDefaults, applyPreset, presetOf, setValue, sliderStep, randomSeed, loadEndless, saveEndless, shareUrl, fromParams, bestKey, derive, levelMix } from './endless.js';
import { setRoadSurface } from './roadmat.js';
import { Extras } from './extras.js';
import { BIOMES, levelUnlocked, levelProgress, nextLevel, levelAfter, biomeOf, biomeUnlocked, recordFinish, starCount } from './levels.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const Q = QUALITY[settings.quality];

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
// Dynamic resolution: start at the preset's cap and adapt to the frame rate.
const res = { ratio: Math.min(devicePixelRatio, Q.maxPixelRatio), acc: 0, frames: 0 };
renderer.setPixelRatio(res.ratio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// The level to open with (?level=<id> or ?level=endless), else the next one to
// play. Its biome's look (sky, ground, road paint, trees) is fixed for the
// page; picking a level in another biome reloads the page into it.
const params = new URLSearchParams(location.search);
const wanted = params.get('level');
const bootLevel = wanted === 'endless' ? null : BIOMES.flatMap((b) => b.levels).find((l) => l.id === wanted) || nextLevel();
// Endless mode's setup (src/endless.js), remembered between visits. A shared
// link's settings replace the saved ones.
let endless = loadEndless();
const shared = wanted === 'endless' && fromParams(params);
if (shared) {
  endless = shared;
  saveEndless(endless);
}
// Endless rides in the biome its setup picks.
const endlessLook = () => lookOf(derive(endless).biome);
const look = bootLevel ? lookOf(biomeOf(bootLevel), bootLevel) : endlessLook();
const pick = (map, key) => map[key] || map.alpine;
// Narrow-lane biomes: set before the road mesh and traffic are made.
setRoadWidth(look.lane);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 12000);
// Time of day and weather come with the look; ?time= and ?weather= override
// them for testing.
const atmo = atmosphereFor(look.atmosphere, params.get('time') || look.time, params.get('weather') || look.weather);
const { sky, sun, fogDensity, bakeClouds } = createSky(scene, renderer, Q, atmo);
const precip = new Precipitation(scene, Q);
const camVel = new THREE.Vector3();
const camPrev = new THREE.Vector3();
const post = new Post(renderer, scene, camera, Q);

// The world is rebuilt for each level (see loadWorld); start with a stub road.
const road = new Road(1);
road.ensure(START_S + 200);
// Falling snow settles everywhere, not just on the peaks.
const groundSet = { ...pick(GROUND_SETS, look.ground) };
groundSet.snowCover = ENV.snow;
const terrain = new Terrain(scene, road, 12, Q, renderer, groundSet);
const forest = new Forest(scene, renderer, Q, look.species);
terrain.forest = forest;
const boulders = new Boulders(scene, renderer, pick(GROUND_SETS, look.ground));
terrain.boulders = boulders;
const grass = new Grass(scene, renderer, terrain, Q);
const props = new Props(scene, renderer, terrain, look.atmosphere);
props.mat.userData.uniforms.uNight.value = ENV.night;
const structures = new Structures(scene, renderer, road, terrain, props, boulders);
const scenery = new Scenery(road, terrain, props, structures);
const roadMesh = new RoadMesh(scene, road, renderer, pick(MARKINGS, look.markings));
const player = new Player(scene, road, terrain);
const traffic = new Traffic(scene, road, Q);
traffic.lights = carLights(atmo, ENV);
const extras = new Extras(scene, road);
const input = new Input();
const audio = new Audio();
audio.unlockOn();
const marks = new SlideMarks(scene);
const sparks = new Sparks(scene, Q.sparks);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- game state
const game = {
  mode: 'loading', // loading | title | intro | play | crashed | finished | paused
  level: null, // the level being played; null for endless
  seed: 0,
  time: 0, // run time in seconds (levels)
  checkpoint: null, // { s, time, bonus } of the last checkpoint passed
  cpNext: 0, // index of the next checkpoint
  bonus: 0,
  combo: 0,
  comboTimer: 0,
  slidePts: 0,
  slideHand: false,
  slideStartSpeed: 0,
  wasSliding: false,
  best: 0, // endless best score
  showFps: false,
  mph: store.get('powerslide.mph', true),
  muted: store.get('powerslide.muted', false),
  camMode: 0,
  runStartDist: 0,
  nearMisses: 0,
  hintTimer: 0,
  hintShown: false,
};
audio.muted = game.muted;
// The endless best is kept for each mix of settings.
const loadBest = () => {
  const key = bestKey(endless);
  return store.get(key, key === 'powerslide.best.endless' ? store.get('powerslide.best.pro', 0) : 0);
};
game.best = loadBest();

// ---------------------------------------------------------------- world
const PANELS = ['loading', 'title', 'help', 'whatsnew', 'settings', 'intro', 'setup', 'crash', 'finish', 'pause'];
function show(id) {
  for (const p of PANELS) $(p).classList.toggle('hidden', p !== id);
  $('hud').classList.toggle('hidden', !!id && id !== 'crash' && id !== 'finish' && id !== 'pause');
  // The in-run menu and restart buttons only show while riding.
  $('runbtns').classList.toggle('hidden', !!id);
  if (id) focusFirst($(id));
}

// Builds terrain tiles around the rider, with a progress readout.
async function buildTiles() {
  if (terrain.update(player.pos.x, player.pos.z, 12)) return;
  const prevMode = game.mode;
  game.mode = 'loading';
  show('loading');
  let built = 0;
  const total = terrain.tileCount;
  for (let done = false; !done; ) {
    const before = terrain.near.size + terrain.far.size;
    done = terrain.update(player.pos.x, player.pos.z, 30);
    built += Math.max(0, terrain.near.size + terrain.far.size - before);
    $('load-pct').textContent = `${Math.min(100, Math.round((built / total) * 100))}%`;
    await new Promise((r) => setTimeout(r, 0));
  }
  forest.update(player.pos.x, player.pos.z);
  boulders.update();
  props.update(player.pos.x, player.pos.z, true);
  grass.fill(player.pos.x, player.pos.z);
  game.mode = prevMode;
}

let worldKey = null; // the endless setup the road on screen was made with
const setupKey = () => JSON.stringify({ ...endless, newRoad: null });
// Swaps in the road for a level, or for endless the road its setup makes.
async function loadWorld(level) {
  game.level = level;
  const mix = level ? levelMix(level) : derive(endless);
  worldKey = level ? null : setupKey();
  game.worldRidden = false;
  game.seed = level ? level.seed : mix.seed;
  road.reset(game.seed, level, mix.shape);
  const biome = level ? biomeOf(level) : mix.biome;
  road.drive = biome?.drive === 'left' ? -1 : 1;
  // The biome picks the traffic mix and the side of the road (and your lane).
  traffic.setPlace(biome?.id, biome?.drive);
  player.side = road.drive;
  road.rails = biome?.rails !== false;
  road.ensure(START_S + 7000);
  terrain.reset(game.seed + 11, level?.terrain);
  // Level set pieces and props shape the terrain, so they go in before any tiles build.
  props.begin();
  structures.plan(level);
  dressLevel(level, road, props);
  props.shape();
  structures.build();
  props.finish();
  // Endless dresses its road as it goes; the first stretch before any tiles.
  if (level) scenery.clear();
  else {
    scenery.reset(game.seed, mix.biome?.id, mix.sets);
    scenery.update(road.start);
  }
  // Dev builds: shout about any prop that isn't sitting on the ground.
  if (import.meta.env.DEV) {
    const off = props.floating();
    if (off.length) console.warn(`${off.length} props off the ground`, off.slice(0, 10));
  }
  grass.clear();
  roadMesh.clear();
  marks.clear();
  sparks.clear();
  traffic.configure(level ? level.traffic : mix.traffic, game.seed);
  if (level) extras.clear();
  else extras.reset(game.seed, mix.extras);
  game.trafficBase = traffic.density;
  player.diff = mix.tuning;
  Object.assign(player.mods, mix.mods);
  setRoadSurface(roadMesh.roadMat, { ...mix.surface, wet: Math.max(mix.surface.wet ?? 0, ENV.wet) });
  scene.fog.density = fogDensity * mix.fog;
  audio.setScene({ biome: (level ? biomeOf(level) : mix.biome)?.id, level, road, mix });
  // The sky this page was built with (a level's own, or a ?time= / ?weather= test).
  audio.setWeather(ENV.weather);
  audio.setTimeOfDay(ENV.time);
  player.reset(road.start);
  cam.init = false;
  roadMesh.update(player.s);
  await buildTiles();
}

// ---------------------------------------------------------------- menus
function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  $('toast').replaceChildren(el);
  setTimeout(() => el.remove(), 2700);
}

function stars(list, cls = 'stars') {
  const el = document.createElement('i');
  el.className = cls;
  el.innerHTML = list.map((on) => `<span class="${on ? 'on' : ''}">★</span>`).join('');
  return el;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

function renderMenu() {
  const next = nextLevel();
  const out = [];
  const coming = [];
  for (const biome of BIOMES) {
    if (!biome.levels.length) {
      coming.push(biome.name);
      continue;
    }
    const sec = document.createElement('div');
    sec.className = 'biome';
    const total = biome.levels.reduce((n, l) => n + starCount(l.id), 0);
    sec.innerHTML = `<h3>${biome.name}<small>★ ${total} / ${biome.levels.length * 3}</small></h3><p class="small">${biome.blurb}</p>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    biome.levels.forEach((level, i) => {
      const b = document.createElement('button');
      b.className = 'tile' + (level === next ? ' next' : '');
      b.disabled = !levelUnlocked(level);
      b.innerHTML = `<b>${i + 1}</b><span>${level.name}</span>`;
      b.appendChild(stars(levelProgress(level.id).stars));
      b.onclick = () => selectLevel(level);
      grid.appendChild(b);
    });
    sec.appendChild(grid);
    out.push(sec);
  }
  if (coming.length) {
    const sec = document.createElement('div');
    sec.className = 'biome';
    sec.innerHTML = `<h3>Coming soon</h3><div class="coming">${coming.map((n) => `<span>🔒 ${n}</span>`).join('')}</div>`;
    out.push(sec);
  }
  $('biomes').replaceChildren(...out);

  const qual = $('opt-quality');
  qual.replaceChildren(
    ...QUALITY_ORDER.map((key) => {
      const b = document.createElement('button');
      b.textContent = key === 'auto' ? `Auto (${QUALITY[autoQuality(settings.device)].label})` : QUALITY[key].label;
      b.className = key === settings.qualityChoice ? 'on' : '';
      b.onclick = () => setQuality(key);
      return b;
    }),
  );
}

// Speed units: mph by default.
const UNITS = [[true, 'MPH'], [false, 'KM/H']];
$('opt-units').replaceChildren(
  ...UNITS.map(([mph, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => setUnits(mph);
    return b;
  }),
);
function setUnits(mph) {
  game.mph = mph;
  store.set('powerslide.mph', mph);
  [...$('opt-units').children].forEach((b, i) => b.classList.toggle('on', UNITS[i][0] === mph));
}
setUnits(game.mph);

// Volumes: master, effects, ambience and music, as sliders like the endless
// setup's (drag or tap along them, or left / right with the D-pad).
function volumeRow([key, label]) {
  const row = document.createElement('div');
  row.className = 'opt-row';
  row.append(Object.assign(document.createElement('label'), { textContent: label }));
  const b = document.createElement('button');
  b.className = 'slider';
  b.setAttribute('aria-label', `${label} volume`);
  b.innerHTML = '<span class="track"><span class="fill"></span><span class="knob"></span></span><span class="val"></span>';
  const paint = () => {
    const v = audio.volume[key];
    b.querySelector('.fill').style.width = `${v * 100}%`;
    b.querySelector('.knob').style.left = `${v * 100}%`;
    b.querySelector('.val').textContent = v ? `${Math.round(v * 100)}%` : 'Off';
  };
  const set = (v) => {
    const before = audio.volume[key];
    audio.setVolume(key, Math.round(v * 20) / 20);
    if (audio.volume[key] !== before) {
      paint();
      audio.ui('tick');
    }
  };
  const track = b.querySelector('.track');
  const fromX = (e) => {
    const r = track.getBoundingClientRect();
    set((e.clientX - r.left) / r.width);
  };
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture?.(e.pointerId);
    fromX(e);
  });
  b.addEventListener('pointermove', (e) => {
    if (b.hasPointerCapture?.(e.pointerId)) fromX(e);
  });
  b.nudge = (_, dir) => set(audio.volume[key] + dir * 0.1);
  paint();
  row.append(b);
  return row;
}
$('opt-volume').replaceChildren(...VOLUMES.map(volumeRow));

// Menu buttons click (sliders tick as they move instead).
addEventListener('click', (e) => {
  const b = e.target.closest?.('button');
  if (!b || b.classList.contains('slider') || b.closest('#hud')) return;
  audio.ui(b.classList.contains('secondary') || /back|menu|quit/.test(b.id) ? 'back' : 'click');
});
// Steering on touch screens: swipe (the default) or tilt.
const STEER_MODES = [[false, 'Swipe'], [true, 'Tilt']];
$('opt-steer').replaceChildren(
  ...STEER_MODES.map(([tilt, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => setTiltMode(tilt, true);
    return b;
  }),
);
$('opt-tilt').replaceChildren(
  ...TILT_SENSITIVITIES.map(([key, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => setTiltSensitivity(key);
    return b;
  }),
);
// ask: called from a tap, so iOS can show its motion access prompt.
async function setTiltMode(on, ask = false) {
  if (on && ask && !(await input.tilt.request())) {
    toast('Tilt needs motion access. Reload, turn Tilt on again and tap Allow');
    on = false;
  }
  input.tilt.enabled = on;
  store.set('powerslide.tilt', on);
  [...$('opt-steer').children].forEach((b, i) => b.classList.toggle('on', STEER_MODES[i][0] === on));
  $('tilt-row').classList.toggle('hidden', !on);
  $('tilt-note').classList.toggle('hidden', !on);
}
function setTiltSensitivity(key) {
  input.tilt.sensitivity = key;
  store.set('powerslide.tiltSensitivity', key);
  [...$('opt-tilt').children].forEach((b, i) => b.classList.toggle('on', TILT_SENSITIVITIES[i][0] === key));
}
setTiltSensitivity(store.get('powerslide.tiltSensitivity', 'medium'));
setTiltMode(store.get('powerslide.tilt', false));
// Android hands out motion readings without asking; iOS waits for RIDE.
if (input.tilt.enabled && typeof window.DeviceMotionEvent?.requestPermission !== 'function') input.tilt.request();

function setQuality(key) {
  if (key === settings.qualityChoice) return;
  store.set('powerslide.quality', key);
  // Antialiasing and terrain detail are fixed at start-up, so reload.
  location.reload();
}

async function toTitle() {
  player.reset(road.start);
  cam.init = false;
  await buildTiles();
  game.mode = 'title';
  renderMenu();
  show('title');
  const next = $('biomes').querySelector('.tile.next');
  setFocus(next);
}

async function selectLevel(level) {
  if (game.mode === 'loading') return;
  if (JSON.stringify(lookOf(level && biomeOf(level), level)) !== JSON.stringify(look)) {
    // Another biome, time of day or weather: reload into it.
    location.search = `?level=${level ? level.id : 'endless'}`;
    return;
  }
  if (level !== game.level || !level) await loadWorld(level);
  else player.reset(road.start);
  showIntro();
}

function showIntro() {
  const level = game.level;
  game.mode = 'intro';
  if (level) {
    const biome = biomeOf(level);
    $('intro-where').textContent = `${biome.name} · Level ${biome.levels.indexOf(level) + 1}`;
    $('intro-name').textContent = level.name;
    $('intro-hint').textContent = level.hint || '';
    const km = ((road.finish - road.start) / 1000).toFixed(1);
    $('intro-targets').innerHTML = `★ Finish the ${km} km run<br>★ Finish in under <b>${fmtTime(level.targets.time)}</b><br>★ Score <b>${level.targets.score}</b> or more`;
    const p = levelProgress(level.id);
    $('intro-best').replaceChildren();
    if (p.bestTime !== null) {
      $('intro-best').append(stars(p.stars), ` Best ${fmtTime(p.bestTime)} · ${p.bestScore} points`);
    }
    show('intro');
  } else {
    openSetup();
  }
}

// ---------------------------------------------------------------- endless setup
// Sliders are buttons: drag or tap along them, or focus one with the D-pad and
// press left / right. Choices are rows of buttons, like the settings screen.
function renderSetup() {
  const cur = presetOf(endless);
  $('setup-presets').replaceChildren(
    ...PRESETS.map((p) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.className = p === cur ? 'on' : '';
      b.onclick = () => {
        applyPreset(endless, p);
        setupChanged();
      };
      return b;
    }),
  );
  $('setup-groups').replaceChildren(
    ...GROUPS.map((g) => {
      const sec = document.createElement('div');
      sec.className = 'es-group';
      const rows = document.createElement('div');
      rows.className = 'es-rows';
      rows.append(...g.items.map(setupRow));
      sec.append(Object.assign(document.createElement('h3'), { textContent: g.title }), rows);
      return sec;
    }),
  );
  $('setup-seed').value = endless.seed;
  $('setup-newroad').replaceChildren(
    ...[[true, 'New road'], [false, 'Same road']].map(([v, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = endless.newRoad === v ? 'on' : '';
      b.onclick = () => {
        endless.newRoad = v;
        setupChanged();
      };
      return b;
    }),
  );
  game.best = loadBest();
  $('setup-best').textContent = game.best ? `Best with these settings: ${game.best} points` : '';
}

function setupRow(it) {
  const row = document.createElement('div');
  row.className = 'es-row';
  const label = document.createElement('label');
  label.textContent = it.label;
  if (it.note) label.append(Object.assign(document.createElement('small'), { textContent: it.note }));
  row.append(label);
  if (it.options) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.append(
      ...optionsOf(it).map(([v, text]) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.className = endless[it.id] === v ? 'on' : '';
        b.onclick = () => {
          setValue(endless, it.id, v);
          setupChanged(b);
        };
        return b;
      }),
    );
    row.append(seg);
    return row;
  }
  const b = document.createElement('button');
  b.className = 'slider';
  b.dataset.id = it.id;
  b.setAttribute('aria-label', it.label);
  b.innerHTML = '<span class="track"><span class="fill"></span><span class="knob"></span></span><span class="val"></span>';
  paintSlider(b, it);
  const track = b.querySelector('.track');
  const fromX = (e) => {
    const r = track.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const before = endless[it.id];
    setValue(endless, it.id, it.min + t * (it.max - it.min));
    if (endless[it.id] !== before) sliderChanged(b, it);
  };
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture?.(e.pointerId);
    fromX(e);
  });
  b.addEventListener('pointermove', (e) => {
    if (b.hasPointerCapture?.(e.pointerId)) fromX(e);
  });
  row.append(b);
  return row;
}

function paintSlider(b, it) {
  const v = endless[it.id];
  const t = ((v - it.min) / (it.max - it.min)) * 100;
  b.querySelector('.fill').style.width = `${t}%`;
  b.querySelector('.knob').style.left = `${t}%`;
  b.querySelector('.val').textContent = it.show(v);
  b.classList.toggle('changed', v !== it.def);
}

// A slider moved: repaint just it (so a drag isn't interrupted), plus the
// presets and best score that depend on it.
function sliderChanged(b, it) {
  paintSlider(b, it);
  saveEndless(endless);
  const cur = presetOf(endless);
  [...$('setup-presets').children].forEach((p, i) => p.classList.toggle('on', PRESETS[i] === cur));
  game.best = loadBest();
  $('setup-best').textContent = game.best ? `Best with these settings: ${game.best} points` : '';
}

const SLIDERS = GROUPS.flatMap((g) => g.items).filter((it) => !it.options);
function nudgeSlider(b, dir) {
  const it = SLIDERS.find((x) => x.id === b.dataset.id);
  sliderStep(endless, it.id, dir);
  sliderChanged(b, it);
}

// Re-renders the screen and puts the highlight back on the same spot.
function setupChanged(from) {
  saveEndless(endless);
  const all = [...$('setup').querySelectorAll('button')];
  const at = all.indexOf(from || navEl);
  renderSetup();
  if (at >= 0 && navEl?.classList.contains('focus')) setFocus($('setup').querySelectorAll('button')[at], true);
}

function openSetup() {
  game.mode = 'intro';
  renderSetup();
  show('setup');
  setFocus($('setup-ride'));
}

$('setup-seed').addEventListener('change', () => {
  const v = $('setup-seed').value.trim().slice(0, 24);
  endless.seed = v || randomSeed();
  // A typed-in code is a road you want to ride.
  endless.newRoad = false;
  setupChanged();
});
$('setup-seed').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') $('setup-seed').blur();
});
$('setup-roll').addEventListener('click', () => {
  endless.seed = randomSeed();
  setupChanged($('setup-roll'));
});
$('setup-share').addEventListener('click', async () => {
  const url = shareUrl(endless);
  try {
    if (navigator.share && document.body.classList.contains('is-touch')) {
      await navigator.share({ title: 'Powerslide', text: `Ride my Powerslide road (code ${endless.seed})`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied. Send it to a friend!');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Road code ${endless.seed}`);
  }
});
$('setup-reset').addEventListener('click', () => {
  const seed = endless.seed;
  endless = endlessDefaults();
  endless.seed = seed;
  setupChanged($('setup-reset'));
  toast('Back to normal settings');
});
$('setup-back').addEventListener('click', () => back());
$('setup-ride').addEventListener('click', () => rideEndless(true));
// reroll: roll a new road code first, if the setup asks for a new road each ride.
async function rideEndless(reroll) {
  if (game.mode === 'loading') return;
  if (reroll && endless.newRoad) endless.seed = randomSeed();
  saveEndless(endless);
  if (JSON.stringify(endlessLook()) !== JSON.stringify(look)) {
    // Another biome's look: reload into it and set off straight away.
    location.search = '?level=endless&go=1';
    return;
  }
  game.best = loadBest();
  // The road on screen is already this one and nobody has ridden it yet.
  if (game.level || worldKey !== setupKey() || game.worldRidden) await loadWorld(null);
  startRun();
}
$('crash-setup').addEventListener('click', openSetup);

renderMenu();
if (settings.device === 'xbox') {
  $('xbox-tip').classList.remove('hidden');
  $('pad-hint').classList.remove('hidden');
}
document.body.classList.add(`is-${settings.device}`);
if ('ontouchstart' in window) document.body.classList.add('is-touch');
input.onPad = (on) => {
  toast(on ? 'Controller connected' : 'Controller disconnected');
  $('pad-hint').classList.toggle('hidden', !on);
  document.body.classList.toggle('has-pad', on);
};

// Levels score the distance covered towards the finish; endless scores all of it.
function score() {
  if (game.level) return Math.floor(Math.max(0, Math.min(player.s, road.finish) - road.start)) + Math.floor(game.bonus);
  return Math.floor(player.distance - game.runStartDist) + Math.floor(game.bonus);
}

function popup(text, sub = '') {
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1500);
  while ($('popups').children.length > 3) $('popups').firstChild.remove();
}

function fmtSpeed(ms) {
  return game.mph ? Math.round(ms * 2.23694) : Math.round(ms * 3.6);
}

// from: 'start' (a level from the top), 'checkpoint', or 'here' (endless:
// carry on from where you came off).
async function startRun(from = game.level ? 'start' : 'here') {
  audio.start();
  input.resetTouchHold?.(); // touch-only: don't carry a held tuck into the new run
  if (input.tilt.enabled) {
    input.tilt.request(); // inside the RIDE tap, so iOS can ask for motion access
    input.tilt.calibrate();
  }
  const level = game.level;
  const cp = from === 'checkpoint' ? game.checkpoint : null;
  if (level) {
    player.reset(cp ? cp.s : road.start);
    traffic.configure(level.traffic, game.seed + (cp ? game.cpNext : 0));
    game.time = cp ? cp.time : 0;
    game.bonus = cp ? cp.bonus : 0;
    if (!cp) {
      game.checkpoint = null;
      game.cpNext = 0;
    }
    cam.init = false;
    await buildTiles();
  } else {
    if (game.mode === 'crashed') player.reset(player.s);
    for (const c of [...traffic.cars]) {
      if (Math.abs(c.s - player.s) < 90) {
        traffic.remove(c);
      }
    }
    game.bonus = 0;
  }
  game.mode = 'play';
  game.worldRidden = true;
  show(null);
  game.combo = 0;
  game.slidePts = 0;
  game.wasSliding = false;
  game.nearMisses = 0;
  game.runStartDist = player.distance;
  game.wildStep = Math.floor(Math.max(0, player.s - road.start) / 2000);
  player.topSpeed = 0;
  if (level?.hint && !cp) hint(level.hint, 6);
}

function endRun() {
  game.mode = 'crashed';
  const sc = score();
  const unit = game.mph ? 'mph' : 'km/h';
  $('crash-reason').textContent = player.crashReason;
  if (game.level) {
    const togo = Math.max(0, road.finish - player.s);
    $('crash-stats').innerHTML = `Score <b>${sc}</b> · Time <b>${fmtTime(game.time)}</b><br>
      <b>${(togo / 1000).toFixed(2)} km</b> from the finish<br>
      Top speed <b>${fmtSpeed(player.topSpeed)} ${unit}</b>`;
    $('again').textContent = 'RESTART';
  } else {
    const isBest = sc > game.best;
    if (isBest) {
      game.best = sc;
      store.set(bestKey(endless), sc);
    }
    $('crash-stats').innerHTML = `Score <b>${sc}</b>${isBest ? ' — new best!' : ''}<br>
      Distance <b>${((player.distance - game.runStartDist) / 1000).toFixed(2)} km</b><br>
      Top speed <b>${fmtSpeed(player.topSpeed)} ${unit}</b><br>
      Near misses <b>${game.nearMisses}</b>`;
    $('again').textContent = 'RIDE AGAIN';
  }
  $('from-cp').classList.toggle('hidden', !game.checkpoint);
  $('crash-setup').classList.toggle('hidden', !!game.level);
  $('again').classList.toggle('secondary', !!game.checkpoint);
  show('crash');
  if (game.checkpoint) setFocus($('from-cp'));
}

function finishRun() {
  game.mode = 'finished';
  const level = game.level;
  const sc = score();
  const r = recordFinish(level, game.time, sc);
  $('finish-stars').replaceChildren(stars(levelProgress(level.id).stars.map((had, i) => had || r.earned[i]), 'stars big'));
  const t = level.targets;
  const line = (ok, text) => `<span class="${ok ? '' : 'miss'}">${ok ? '★' : '☆'} ${text}</span>`;
  $('finish-stats').innerHTML = [
    line(true, 'Finished'),
    line(r.earned[1], `Time <b>${fmtTime(game.time)}</b> (target ${fmtTime(t.time)})${r.bestTime ? ' · best!' : ''}`),
    line(r.earned[2], `Score <b>${sc}</b> (target ${t.score})${r.bestScore ? ' · best!' : ''}`),
  ].join('<br>');
  const after = levelAfter(level);
  $('next').classList.toggle('hidden', !after);
  const biome = biomeOf(level);
  if (!after && biome.levels[biome.levels.length - 1] === level) {
    const nb = BIOMES[BIOMES.indexOf(biome) + 1];
    if (nb) popup(biomeUnlocked(nb) ? `${nb.name.toUpperCase()} UNLOCKED` : `${biome.name.toUpperCase()} COMPLETE`);
    audio.unlock();
  }
  audio.fanfare(r.earned.filter(Boolean).length);
  show('finish');
}

// ---------------------------------------------------------------- menu navigation
// Arrow keys, the d-pad and the left stick move focus between the buttons of
// the open panel; A or Enter presses the focused one, B or Esc goes back.
function panelButtons() {
  const panel = PANELS.map($).find((p) => !p.classList.contains('hidden'));
  // The update prompt floats over the menus; its buttons join the D-pad order.
  const update = [...document.querySelectorAll('#update button')];
  if (!panel) return update.filter((b) => b.offsetParent !== null);
  return [...panel.querySelectorAll('button'), ...update].filter((b) => !b.disabled && b.offsetParent !== null);
}

// The highlight is our own .focus class, not :focus-visible: Safari hides the
// focus ring after the screen has been touched, which left iPad controller
// players with no idea where they were.
let navEl = null;
const navOn = () => !matchMedia('(hover: none)').matches || document.body.classList.contains('has-pad');
function setFocus(b, force = false) {
  if (!b || (!force && !navOn())) return;
  if (navEl && navEl !== b) navEl.classList.remove('focus');
  navEl = b;
  b.classList.add('focus');
  b.focus({ preventScroll: true });
  b.scrollIntoView({ block: 'nearest' });
}
function currentFocus(list) {
  if (list.includes(navEl)) return navEl;
  return list.includes(document.activeElement) ? document.activeElement : null;
}
// A touch or click hides the highlight; the next controller press brings it back.
addEventListener('pointerdown', () => navEl?.classList.remove('focus'), true);

function focusFirst(panel) {
  setFocus([...panel.querySelectorAll('button')].find((x) => !x.disabled && x.offsetParent !== null));
}

function moveFocus(dx, dy) {
  const list = panelButtons();
  if (!list.length) return;
  const cur = currentFocus(list);
  if (!cur || !cur.classList.contains('focus')) {
    setFocus(cur || list[0], true);
    return;
  }
  // Left and right move a focused slider rather than the focus.
  if (dx && cur.classList.contains('slider')) {
    (cur.nudge || nudgeSlider)(cur, dx);
    return;
  }
  const r0 = cur.getBoundingClientRect();
  const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bestScore = Infinity;
  for (const b of list) {
    if (b === cur) continue;
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
    const along = x * dx + y * dy;
    if (along <= 1) continue;
    const across = Math.abs(x * dy - y * dx);
    const sc = along + across * 2.5;
    if (sc < bestScore) {
      bestScore = sc;
      best = b;
    }
  }
  if (best) {
    setFocus(best, true);
    audio.ui('move');
  }
}

const stickNav = { x: 0, y: 0, t: 0 };
function menuInput(dt) {
  // Typing or pasting a stars code: B leaves the box.
  if (document.activeElement?.tagName === 'TEXTAREA') {
    if (input.wasPressed('Pad1')) document.activeElement.blur();
    return;
  }
  // Typing a road code: leave the keys to the text box.
  if (document.activeElement?.tagName === 'INPUT') return;
  const pressed = (c) => input.wasPressed(c);
  let dx = 0, dy = 0;
  if (pressed('ArrowLeft') || pressed('Pad14')) dx = -1;
  if (pressed('ArrowRight') || pressed('Pad15')) dx = 1;
  if (pressed('ArrowUp') || pressed('Pad12')) dy = -1;
  if (pressed('ArrowDown') || pressed('Pad13')) dy = 1;
  // Left stick, with auto-repeat while held.
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (gp) {
    const ax = Math.abs(gp.axes[0]) > 0.6 ? Math.sign(gp.axes[0]) : 0;
    const ay = Math.abs(gp.axes[1]) > 0.6 ? Math.sign(gp.axes[1]) : 0;
    stickNav.t -= dt;
    if ((ax || ay) && (ax !== stickNav.x || ay !== stickNav.y || stickNav.t <= 0)) {
      dx = dx || ax;
      dy = dy || ay;
      stickNav.t = ax === stickNav.x && ay === stickNav.y ? 0.18 : 0.4;
    }
    stickNav.x = ax;
    stickNav.y = ay;
  }
  if (dx || dy) moveFocus(dx, dy);
  const list = panelButtons();
  const focused = currentFocus(list);
  // Enter on a focused button is a native click already. With nothing
  // highlighted, A shows the highlight first rather than pressing blind.
  if (pressed('Pad0') && !focused?.classList.contains('focus')) setFocus(focused || list[0], true);
  else if (pressed('Pad0') || ((pressed('Enter') || pressed('NumpadEnter')) && !focused)) (focused || list[0])?.click();
  if (pressed('Pad1') || pressed('Escape')) back();
}

function back() {
  if (!$('setup').classList.contains('hidden')) toTitle().then(() => setFocus($('endless')));
  else if (game.mode === 'paused') togglePause();
  else if (game.mode === 'intro' || game.mode === 'finished' || (game.mode === 'crashed' && player.crashTime > 1)) toTitle();
  else if (!$('help').classList.contains('hidden')) {
    show('title');
    setFocus($('howto'));
  } else if (!$('settings').classList.contains('hidden')) {
    show('title');
    setFocus($('opts'));
  } else if (!$('whatsnew').classList.contains('hidden')) {
    show('title');
    setFocus($('newsbtn'));
  }
}

$('start').addEventListener('click', () => startRun());
$('again').addEventListener('click', () => startRun());
$('from-cp').addEventListener('click', () => startRun('checkpoint'));
$('menu').addEventListener('click', toTitle);
$('retry').addEventListener('click', () => startRun());
$('next').addEventListener('click', () => {
  const after = levelAfter(game.level);
  if (after) selectLevel(after);
});
$('finish-menu').addEventListener('click', toTitle);
$('intro-back').addEventListener('click', toTitle);
$('endless').addEventListener('click', () => game.mode !== 'loading' && openSetup());
$('howto').addEventListener('click', () => show('help'));
$('opts').addEventListener('click', () => show('settings'));
$('settings-back').addEventListener('click', () => {
  show('title');
  setFocus($('opts'));
});

// Your stars, on the settings screen: backups to a file (Files, iCloud Drive,
// Google Drive), and moving progress between Safari and the iPad home screen
// app, which keep separate storage, as a code on the clipboard (or typed into
// the box if the clipboard won't play). Ported from push-pump-pop.
function setupMove() {
  let ls = null;
  try {
    ls = localStorage;
  } catch {
    /* no storage: nothing to move */
  }
  const box = $('movecode');
  const say = (t) => {
    $('movemsg').textContent = t;
  };
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  // A brand new home screen app: point at the stars left in Safari.
  if (standalone && ls && !hasProgress(ls)) say('Got stars in Safari? Press COPY MY STARS there, then PASTE MY STARS here.');
  const take = (text) => {
    if (!ls) {
      say('This browser can\u2019t save stars.');
      return false;
    }
    const n = importCode(ls, text);
    if (n < 0) return false;
    say(n ? `Got your stars from ${n} level${n === 1 ? '' : 's'}!` : 'Done! There were no stars to bring yet.');
    box.classList.add('hidden');
    box.blur();
    setTimeout(() => location.reload(), 1500);
    return true;
  };
  $('movesave').addEventListener('click', async () => {
    if (!ls) return say('This browser can\u2019t save stars.');
    const day = new Date().toISOString().slice(0, 10);
    const file = new File([`Powerslide stars backup, ${day}. Load it with LOAD BACKUP on the Settings screen.\n${exportCode(ls)}\n`],
      `powerslide-stars-${day}.txt`, { type: 'text/plain' });
    // The share sheet has Save to Files on the iPad and Drive on Android; elsewhere, download it.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        say('Saved! Keep that file safe.');
      } catch (e) {
        if (e.name !== 'AbortError') say('Couldn\u2019t save the backup. Try again?');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    say('Saved to your downloads! Keep that file safe.');
  });
  const picker = $('movefile');
  $('moveload').addEventListener('click', () => {
    picker.value = '';
    picker.click();
  });
  picker.addEventListener('change', async () => {
    const f = picker.files?.[0];
    if (f && !take(await f.text())) say('Hmm, that file isn\u2019t a stars backup.');
  });
  const notStars = () => say(`Hmm, that wasn\u2019t stars. Press COPY MY STARS in the other one first.`);
  $('movecopy').addEventListener('click', async () => {
    if (!ls) return say('This browser can\u2019t save stars.');
    const code = exportCode(ls);
    try {
      await navigator.clipboard.writeText(code);
      say(standalone ? 'Copied! Now open Safari and press PASTE MY STARS.' : 'Copied! Now open the app and press PASTE MY STARS.');
    } catch {
      box.value = code;
      box.classList.remove('hidden');
      box.select();
      say('Copy all of this text, then paste it in the other one.');
    }
  });
  $('movepaste').addEventListener('click', async () => {
    try {
      if (!take(await navigator.clipboard.readText())) notStars();
    } catch {
      box.value = '';
      box.classList.remove('hidden');
      box.focus();
      say('Press in the box and choose Paste.');
    }
  });
  box.addEventListener('input', () => {
    if (box.value.trim() && !take(box.value)) notStars();
  });
  // Esc or B leaves the box so the menus work again.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') box.blur();
  });
}
setupMove();

$('help-back').addEventListener('click', () => {
  show('title');
  setFocus($('howto'));
});
$('resume').addEventListener('click', () => togglePause());
$('quit').addEventListener('click', () => {
  togglePause();
  toTitle();
});
$('restart').addEventListener('click', restart);
// In-run buttons (top right, outside the touch steering area, which is the
// canvas underneath). They never take focus, so Space can't press them.
for (const [id, act] of [['run-menu', () => game.mode === 'play' && togglePause()], ['run-restart', restart]]) {
  $(id).addEventListener('pointerdown', (e) => e.preventDefault());
  $(id).addEventListener('click', act);
}

// Back to the top of the level (or a fresh endless run) from a run or the pause menu.
async function restart() {
  if (game.mode !== 'play' && game.mode !== 'paused') return;
  if (game.mode === 'paused') audio.setPaused(false);
  // Endless drops scenery behind the rider, so the top of the road is rebuilt.
  if (!game.level) await loadWorld(null);
  startRun('start');
}

function togglePause() {
  game.mode = game.mode === 'play' ? 'paused' : 'play';
  if (game.mode === 'play') input.tilt.calibrate();
  show(game.mode === 'paused' ? 'pause' : null);
  audio.setPaused(game.mode === 'paused');
}

// ---------------------------------------------------------------- camera
const cam = {
  heading: player.yaw,
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  init: false,
};
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function updateCamera(dt, t) {
  const p = player.pos;
  const v = player.speed;
  // Follow the direction of travel (not the deck) so slides read clearly.
  let travel = v > 1.5 ? Math.atan2(player.vel.x, -player.vel.y) : player.yaw;
  if (player.crashed) travel = cam.heading;
  let dh = Math.atan2(Math.sin(travel - cam.heading), Math.cos(travel - cam.heading));
  cam.heading += dh * (1 - Math.exp(-dt * 3.5));
  const fx = Math.sin(cam.heading), fz = -Math.cos(cam.heading);

  let dist, height, lookAhead, lookH;
  if (game.mode === 'title' || game.mode === 'intro' || game.mode === 'loading') {
    const a = t * 0.12;
    dist = 7;
    height = 2.2;
    const ox = Math.sin(a) * dist, oz = Math.cos(a) * dist;
    cam.pos.set(p.x + ox, p.y + height, p.z + oz);
    cam.look.set(p.x, p.y + 0.9, p.z);
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  if (game.camMode === 2 && !player.crashed) {
    // Helmet cam.
    const hw = player.model.head.getWorldPosition(_v);
    camera.position.copy(hw).add(_w.set(fx * 0.15, 0.05, fz * 0.15));
    cam.look.set(hw.x + fx * 20, hw.y - 1.6, hw.z + fz * 20);
    camera.lookAt(cam.look);
    camera.fov = 78 + Math.min(v, 30) * 0.4;
    camera.updateProjectionMatrix();
    cam.init = false;
    return;
  }
  if (game.camMode === 1) {
    dist = 3.2 + v * 0.03;
    height = 0.7 + v * 0.01;
    lookAhead = 8;
    lookH = 0.6;
  } else {
    dist = 4.6 + v * 0.06;
    height = 1.8 + v * 0.025;
    lookAhead = 5 + v * 0.2;
    lookH = 0.9;
  }
  if (player.crashed) {
    // Pull back and watch the tumble.
    dist = 5;
    height = 2.3;
    lookAhead = 0;
    lookH = 0.2;
  }
  const target = _v.set(p.x - fx * dist, p.y + height, p.z - fz * dist);
  // Keep the camera above the ground.
  const ground = Math.max(terrain.heightAt(target.x, target.z), road.project(target.x, target.z, player.s, {}).y);
  target.y = Math.max(target.y, ground + 0.6);
  if (!cam.init) {
    cam.pos.copy(target);
    cam.init = true;
  }
  cam.pos.lerp(target, 1 - Math.exp(-dt * 8));
  cam.look.set(p.x + fx * lookAhead, p.y + lookH, p.z + fz * lookAhead);
  camera.position.copy(cam.pos);
  const shake = player.shake * 0.12 + Math.max(0, v - 20) * 0.0025 + (player.surface === 'gravel' ? 0.03 : 0);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }
  camera.lookAt(cam.look);
  const fov = 62 + Math.min(v, 32) * 0.55 + player.tuck * 3;
  camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 3));
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- HUD
function updateHud(dt) {
  $('speed-val').textContent = fmtSpeed(player.crashed ? 0 : player.speed);
  $('speed-unit').textContent = game.mph ? 'mph' : 'km/h';
  $('score').textContent = score();
  if (game.level) {
    const len = road.finish - road.start;
    const done = Math.max(0, Math.min(1, (player.s - road.start) / len));
    $('stat2-label').textContent = 'Time';
    $('stat2').textContent = fmtTime(game.time);
    $('stat3-label').textContent = 'To go';
    $('stat3').textContent = `${((1 - done) * len / 1000).toFixed(2)} km`;
    $('progress-bar').style.width = `${(done * 100).toFixed(1)}%`;
  } else {
    $('stat2-label').textContent = 'Distance';
    $('stat2').textContent = `${((player.distance - game.runStartDist) / 1000).toFixed(2)} km`;
    $('stat3-label').textContent = 'Best';
    $('stat3').textContent = Math.max(game.best, score());
  }
  $('progress').classList.toggle('hidden', !game.level);
  let st = '';
  if (player.slideMode) st = 'SLIDE';
  else if (player.sliding) st = 'DRIFT';
  else if (player.tuck > 0.6) st = 'TUCK';
  else if (player.airbrake > 0.6) st = 'AIR BRAKE';
  else if (player.brake > 0.5) st = 'FOOTBRAKE';
  if (player.fakie) st = (st ? st + ' · ' : '') + 'FAKIE';
  if (game.combo > 1) st += `  x${game.combo}`;
  const wobbling = player.wobble > 0.3 && !player.crashed;
  const risk = player.highsideRisk;
  if (risk) st = 'SLIDE · CLOSE IT BEFORE LETTING GO';
  if (wobbling) st = 'WOBBLE!';
  else if (player.dirt > 0.3 && !player.crashed) st = 'GRIT';
  $('state').textContent = st;
  $('state').classList.toggle('warn', wobbling || risk || st === 'GRIT');
  if (game.hintTimer > 0) {
    game.hintTimer -= dt;
    if (game.hintTimer <= 0) $('hint').textContent = '';
  }
}

function hint(text, time = 4) {
  $('hint').textContent = text;
  game.hintTimer = time;
}

// ---------------------------------------------------------------- resolution
function updateResolution(dt) {
  res.acc += dt;
  res.frames++;
  if (res.acc < 1.5) return;
  const avg = res.acc / res.frames;
  const fps = 1 / avg;
  res.acc = 0;
  res.frames = 0;
  if (game.showFps) $('fps').textContent = `${fps.toFixed(0)} fps · ${res.ratio.toFixed(2)}x · ${Q.label}`;
  const max = Math.min(devicePixelRatio, Q.maxPixelRatio);
  let next = res.ratio;
  if (fps < 48) next = Math.max(Q.minPixelRatio, res.ratio - 0.15);
  else if (fps > 57) next = Math.min(max, res.ratio + 0.1);
  if (Math.abs(next - res.ratio) > 0.01) {
    res.ratio = next;
    renderer.setPixelRatio(next);
    post.setPixelRatio(next);
  }
}

// Past the finish: hold the lane and footbrake to a stop.
const _f = {};
function runOut() {
  const f = road.sample(player.s, _f);
  const travel = Math.atan2(player.vel.x, -player.vel.y) - f.heading;
  return { steer: Math.max(-1, Math.min(1, -0.25 * (player.d - 1.75) - 1.5 * travel)), down: player.speed > 1 };
}

// ---------------------------------------------------------------- loop
const wheelPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const glovePos = new THREE.Vector3();
const trafficEvents = [];
const extraEvents = [];
let last = performance.now();
let time = 0;
// The speed hump under the board last frame, and the speed (m/s, 47 km/h)
// above which hitting one throws you off.
let lastHump = null;
const HUMP_CRASH = 13;

function frame(now) {
  bakeClouds();
  requestAnimationFrame(frame);
  let dt = debug.dt || Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.mode === 'loading' || debug.freeze) return;

  const state = input.update(dt);
  const pad = (i) => input.wasPressed(`Pad${i}`);

  // Global keys.
  if (input.wasPressed('KeyM')) {
    game.muted = !game.muted;
    audio.setMuted(game.muted);
    store.set('powerslide.muted', game.muted);
  }
  if (input.wasPressed('KeyU')) {
    setUnits(!game.mph);
  }
  if (input.wasPressed('KeyF')) {
    game.showFps = !game.showFps;
    $('fps').classList.toggle('hidden', !game.showFps);
  }
  if (input.wasPressed('KeyC') || (pad(3) && game.mode === 'play')) game.camMode = (game.camMode + 1) % 3;
  if ((input.wasPressed('KeyP') || input.wasPressed('Escape') || pad(9)) && (game.mode === 'play' || game.mode === 'paused')) {
    togglePause();
  } else if ((input.wasPressed('KeyR') || pad(8)) && (game.mode === 'play' || game.mode === 'paused')) {
    restart();
  } else if (game.mode !== 'play' && !(game.mode === 'crashed' && player.crashTime < 1)) {
    menuInput(dt);
  }

  if (game.mode === 'paused') {
    input.endFrame();
    post.render();
    return;
  }
  time += dt;

  if (game.mode === 'play' || game.mode === 'crashed' || game.mode === 'finished') {
    const wasCrashed = player.crashed;
    player.water = structures.waterAt(player.s);
    player.update(dt, game.mode === 'play' ? state : game.mode === 'finished' ? runOut() : { steer: 0 });
    if (structures.rattleAt(player.s) && !player.crashed) player.shake = Math.max(player.shake, 0.45);
    audio.onGrid = structures.rattleAt(player.s) && !player.crashed;
    // Speed humps: a jolt and some speed lost, or over you go if you hit
    // one flat out.
    const hump = structures.bumpAt(player.s);
    if (hump && hump !== lastHump && !player.crashed) {
      const v = player.speed;
      if (v > HUMP_CRASH) player.crash('Hit the speed hump too fast');
      else {
        player.shake = Math.max(player.shake, 0.3 + (0.7 * v) / HUMP_CRASH);
        player.vel.multiplyScalar(1 - (0.12 * v) / HUMP_CRASH);
      }
    }
    lastHump = hump;
    if (game.mode === 'play' && !player.crashed) game.time += dt;
    // Past the finish, coast to a stop.
    if (game.mode === 'finished' && !player.crashed) player.vel.multiplyScalar(Math.exp(-dt * 0.8));
    for (const e of player.events) {
      if (e === 'rail') audio.rail();
      if (e === 'crash') audio.crash();
      if (e === 'fakie') {
        popup('180!', '+150');
        game.bonus += 150;
      }
    }
    if (!wasCrashed && player.crashed) {
      game.slidePts = 0;
      game.combo = 0;
    }
    if (player.crashed && game.mode === 'play' && player.crashTime > 3) endRun();
    if (game.level && game.mode === 'play' && !player.crashed) {
      const cps = road.checkpoints;
      if (game.cpNext < cps.length && player.s >= cps[game.cpNext]) {
        game.checkpoint = { s: cps[game.cpNext], time: game.time, bonus: game.bonus };
        game.cpNext++;
        popup('CHECKPOINT', fmtTime(game.time));
        audio.ding();
      }
      if (player.s >= road.finish) finishRun();
    }
    trafficEvents.length = 0;
    traffic.update(dt, player, trafficEvents);
    for (const e of trafficEvents) {
      if (e.type === 'nearMiss') {
        game.combo = game.comboTimer > 0 ? game.combo + 1 : 1;
        game.comboTimer = 6;
        const pts = Math.round((150 + e.rel * 10) * game.combo);
        game.bonus += pts;
        game.nearMisses++;
        audio.ding();
        popup('CLOSE CALL', `+${pts}${game.combo > 1 ? ` · x${game.combo}` : ''}`);
      } else if (e.type === 'honk') {
        audio.honk(Math.hypot(e.car.x - player.pos.x, e.car.z - player.pos.z), e.car);
      } else if (e.type === 'carHit') {
        audio.carHit();
      }
    }
    game.comboTimer -= dt;
    if (game.comboTimer <= 0 && game.combo > 0 && !player.crashed) game.combo = 0;

    // Endless specials: boost pads, bonus stars and a road that gets wilder.
    extraEvents.length = 0;
    extras.update(dt, player, traffic.cars, extraEvents, game.mode === 'play', game.mph);
    for (const e of extraEvents) {
      if (e.type === 'cone') {
        audio.cone();
        popup('CONE!');
      } else if (e.type === 'cleanWorks') {
        game.bonus += e.points;
        audio.ding();
        popup('CLEAN THROUGH THE ROADWORKS', `+${e.points}`);
      } else if (e.type === 'radar') {
        game.bonus += e.points;
        audio.ding();
        popup(`${fmtSpeed(e.speed)} ${game.mph ? 'MPH' : 'KM/H'} PAST THE SIGN`, `+${e.points}`);
      }
    }
    if (!game.level && game.mode === 'play' && road.shape.wilder) {
      const w = road.wildness(player.s);
      traffic.density = game.trafficBase * (1 + w);
      const step = Math.floor((player.s - road.start) / 2000);
      if (step > game.wildStep && w < 1) {
        game.wildStep = step;
        popup(`${step * 2} KM`, 'The mountain gets wilder…');
      }
    }

    // Slide scoring: banked when the wheels hook back up.
    const slidingNow = !player.crashed && (player.slideMode || player.sliding) && player.speed > 3;
    if (slidingNow) {
      if (!game.wasSliding) {
        game.slideStartSpeed = player.speed;
        game.slideHand = false;
      }
      game.slideHand ||= player.slideMode && player.handDown;
      game.slidePts += player.speed * dt * 4 * Math.abs(Math.sin(player.slip));
    } else if (game.wasSliding && !player.crashed) {
      const pts = Math.round(game.slidePts);
      if (pts >= 25) {
        game.bonus += pts;
        const unit = game.mph ? 'mph' : 'km/h';
        popup(`${game.slideHand ? 'HAND-DOWN' : 'SLIDE'} +${pts}`, `${fmtSpeed(game.slideStartSpeed)} → ${fmtSpeed(player.speed)} ${unit}`);
      }
      game.slidePts = 0;
    }
    game.wasSliding = slidingNow;

    if (!game.hintShown && player.speed > 16 && game.mode === 'play') {
      game.hintShown = true;
      hint(
        document.body.classList.contains('is-touch') && !document.body.classList.contains('has-pad')
          ? 'Getting fast! Ease back to air brake, or flick back to powerslide'
          : 'Getting fast! Hold SPACE to powerslide and scrub speed before bends',
      );
    }
  } else {
    // Menus: let the rider idle on the road.
    player.animate(dt);
    traffic.update(dt, player, trafficEvents);
    extras.update(dt, player, traffic.cars, [], false, game.mph);
  }

  // Marks & dust.
  if (!player.boardLoose) {
    for (let i = 0; i < 4; i++) {
      player.model.wheels[i].getWorldPosition(wheelPos[i]);
      wheelPos[i].y -= WHEEL_R;
    }
  }
  const markSliding = !player.crashed && player.speed > 2 && (player.slideMode || player.sliding) && Math.abs(Math.sin(player.slip)) > 0.2;
  marks.update(dt, markSliding, wheelPos, Math.min(1, player.speed / 15), player.vel);
  const glove = player.gloveOnRoad(glovePos);
  sparks.update(dt, glove, player.vel, glove ? glove.y - 0.05 : 0);

  road.ensure(player.s + 7000);
  if (scenery.update(player.s)) props.update(player.pos.x, player.pos.z, true);
  roadMesh.update(player.s);
  terrain.update(player.pos.x, player.pos.z, 4);
  forest.update(player.pos.x, player.pos.z);
  boulders.update();
  props.update(player.pos.x, player.pos.z);
  structures.update(dt);
  grass.update(player.pos.x, player.pos.z, now / 1000);

  // Sun & shadows follow the rider.
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 150);
  sun.target.position.copy(player.pos);
  sky.position.copy(camera.position);
  if (dt > 0) camVel.subVectors(camera.position, camPrev).divideScalar(dt);
  camPrev.copy(camera.position);
  precip.update(now / 1000, camVel);

  updateResolution(dt);
  updateCamera(dt, time);
  audio.riding = game.mode === 'play';
  audio.onRoad = game.mode === 'play' || game.mode === 'crashed' || game.mode === 'finished';
  audio.update(player, traffic.cars, camera);
  traffic.draw(camera);
  if (game.mode === 'play' || game.mode === 'crashed' || game.mode === 'finished') updateHud(dt);
  input.endFrame();
  post.render();
}

// ---------------------------------------------------------------- boot
async function boot() {
  await texturesReady();
  await loadWorld(bootLevel);
  // Warm up: settle the rider pose and a few cars.
  if (traffic.density > 0) for (let i = 0; i < 4; i++) traffic.spawn(player.s, i % 2 ? 1 : -1);
  player.animate(0.016);
  // Tidy a share link or a biome reload out of the address bar, so reloading
  // the page later doesn't bring them back.
  if (wanted === 'endless' && location.search !== '?level=endless') history.replaceState(null, '', '?level=endless');
  if (wanted === 'endless' && params.get('go')) {
    game.mode = 'intro';
    rideEndless(false);
  }
  else if (wanted) showIntro();
  else toTitle();
}

requestAnimationFrame(frame);
boot();

// Exposed for debugging in the console.
const debug = { freeze: false, dt: 0 }; // dt: a fixed frame time, for screenshots
// Updates: offer a reload when a newer build is live, with what's new (src/version.js).
watchForUpdates({
  inRun: () => game.mode === 'play' || game.mode === 'paused',
  leaveRun: () => {
    if (game.mode === 'paused') audio.setPaused(false);
    toTitle();
  },
  showNews: () => show('whatsnew'),
  hideNews: () => {
    show('title');
    setFocus($('newsbtn'));
  },
  onMenu: () => game.mode === 'title' && !$('title').classList.contains('hidden'),
});
registerOffline();
keepSaves();

window.__powerslide = Object.assign(debug, { game, player, audio, extras, road, roadMesh, sun, SUN_DIR, terrain, traffic, camera, renderer, scene, settings, post, forest, boulders, grass, precip, ENV, bakeClouds, sparks, props, structures, renderFrame: () => post.render() });
