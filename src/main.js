import * as THREE from 'three';
import { Road, START_S } from './road.js';
import { Terrain } from './terrain.js';
import { RoadMesh } from './roadmesh.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { SlideMarks } from './marks.js';
import { Sparks } from './sparks.js';
import { createSky, SUN_DIR, ATMOSPHERE } from './sky.js';
import { Post } from './post.js';
import { texturesReady, GROUND_SETS } from './ground.js';
import { MARKINGS } from './roadmat.js';
import { Forest } from './forest.js';
import { Boulders } from './boulders.js';
import { Grass } from './grass.js';
import { WHEEL_R } from './rider.js';
import { lerp } from './noise.js';
import { watchForUpdates } from './version.js';
import { registerOffline, keepSaves } from './pwa.js';
import { store, loadSettings, QUALITY, QUALITY_ORDER, ENDLESS_TRAFFIC, autoQuality } from './settings.js';
import { lookOf } from './biomes.js';
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
const look = lookOf(bootLevel && biomeOf(bootLevel));
const pick = (map, key) => map[key] || map.alpine;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 12000);
const { sky, sun } = createSky(scene, renderer, Q, pick(ATMOSPHERE, look.atmosphere));
const post = new Post(renderer, scene, camera, Q);

// The world is rebuilt for each level (see loadWorld); start with a stub road.
const road = new Road(1);
road.ensure(START_S + 200);
const terrain = new Terrain(scene, road, 12, Q, renderer, pick(GROUND_SETS, look.ground));
const forest = new Forest(scene, renderer, Q, look.species);
terrain.forest = forest;
const boulders = new Boulders(scene, renderer, pick(GROUND_SETS, look.ground));
terrain.boulders = boulders;
const grass = new Grass(scene, renderer, terrain, Q);
const roadMesh = new RoadMesh(scene, road, renderer, pick(MARKINGS, look.markings));
const player = new Player(scene, road, terrain);
const traffic = new Traffic(scene, road);
const input = new Input();
const audio = new Audio();
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
const BEST_KEY = 'powerslide.best.endless';
game.best = store.get(BEST_KEY, store.get('powerslide.best.pro', 0));

// ---------------------------------------------------------------- world
const PANELS = ['loading', 'title', 'help', 'whatsnew', 'settings', 'intro', 'crash', 'finish', 'pause'];
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
  grass.fill(player.pos.x, player.pos.z);
  game.mode = prevMode;
}

// Swaps in the road for a level (or a fresh random road for endless).
async function loadWorld(level) {
  game.level = level;
  game.seed = level ? level.seed : Math.floor(Math.random() * 1e9);
  road.reset(game.seed, level);
  road.ensure(START_S + 7000);
  terrain.reset(game.seed + 11);
  grass.clear();
  roadMesh.clear();
  marks.clear();
  sparks.clear();
  traffic.configure(level ? level.traffic : ENDLESS_TRAFFIC, game.seed);
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
  if (JSON.stringify(lookOf(level && biomeOf(level))) !== JSON.stringify(look)) {
    // Another biome's look: reload into it.
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
  } else {
    $('intro-where').textContent = 'Endless';
    $('intro-name').textContent = 'The Long Way Down';
    $('intro-hint').textContent = 'A mountain road that never ends. Ride as far as you can.';
    $('intro-targets').innerHTML = '';
    $('intro-best').textContent = game.best ? `Best ${game.best} points` : '';
  }
  show('intro');
}

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
        scene.remove(c.mesh);
        traffic.cars.splice(traffic.cars.indexOf(c), 1);
      }
    }
    game.bonus = 0;
  }
  game.mode = 'play';
  show(null);
  game.combo = 0;
  game.slidePts = 0;
  game.wasSliding = false;
  game.nearMisses = 0;
  game.runStartDist = player.distance;
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
      store.set(BEST_KEY, sc);
    }
    $('crash-stats').innerHTML = `Score <b>${sc}</b>${isBest ? ' — new best!' : ''}<br>
      Distance <b>${((player.distance - game.runStartDist) / 1000).toFixed(2)} km</b><br>
      Top speed <b>${fmtSpeed(player.topSpeed)} ${unit}</b><br>
      Near misses <b>${game.nearMisses}</b>`;
    $('again').textContent = 'RIDE AGAIN';
  }
  $('from-cp').classList.toggle('hidden', !game.checkpoint);
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
  }
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
  if (best) setFocus(best, true);
}

const stickNav = { x: 0, y: 0, t: 0 };
function menuInput(dt) {
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
  if (game.mode === 'paused') togglePause();
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
$('endless').addEventListener('click', () => selectLevel(null));
$('howto').addEventListener('click', () => show('help'));
$('opts').addEventListener('click', () => show('settings'));
$('settings-back').addEventListener('click', () => {
  show('title');
  setFocus($('opts'));
});
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
  if (game.mode === 'paused') audio.ctx?.resume();
  if (!game.level) {
    player.reset(road.start);
    cam.init = false;
    await buildTiles();
  }
  startRun('start');
}

function togglePause() {
  game.mode = game.mode === 'play' ? 'paused' : 'play';
  show(game.mode === 'paused' ? 'pause' : null);
  if (audio.ctx) game.mode === 'paused' ? audio.ctx.suspend() : audio.ctx.resume();
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
    dist = 7;
    height = 3;
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
let last = performance.now();
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
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
    player.update(dt, game.mode === 'play' ? state : game.mode === 'finished' ? runOut() : { steer: 0 });
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
    if (player.crashed && game.mode === 'play' && player.crashTime > 2.2) endRun();
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
        audio.honk(Math.hypot(e.car.x - player.pos.x, e.car.z - player.pos.z));
      } else if (e.type === 'carHit') {
        audio.crash();
      }
    }
    game.comboTimer -= dt;
    if (game.comboTimer <= 0 && game.combo > 0 && !player.crashed) game.combo = 0;

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
  roadMesh.update(player.s);
  terrain.update(player.pos.x, player.pos.z, 4);
  forest.update(player.pos.x, player.pos.z);
  boulders.update();
  grass.update(player.pos.x, player.pos.z, now / 1000);

  // Sun & shadows follow the rider.
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 150);
  sun.target.position.copy(player.pos);
  sky.position.copy(camera.position);

  updateResolution(dt);
  updateCamera(dt, time);
  audio.update(player, traffic.cars, camera);
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
  if (wanted) showIntro();
  else toTitle();
}

requestAnimationFrame(frame);
boot();

// Exposed for debugging in the console.
const debug = { freeze: false };
// Updates: offer a reload when a newer build is live, with what's new (src/version.js).
watchForUpdates({
  inRun: () => game.mode === 'play' || game.mode === 'paused',
  leaveRun: () => {
    if (game.mode === 'paused') audio.ctx?.resume();
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

window.__powerslide = Object.assign(debug, { game, player, road, roadMesh, sun, SUN_DIR, terrain, traffic, camera, renderer, scene, settings, post, forest, boulders, grass, sparks, renderFrame: () => post.render() });
