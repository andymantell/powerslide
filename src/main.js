import * as THREE from 'three';
import { Road } from './road.js';
import { Terrain } from './terrain.js';
import { RoadMesh } from './roadmesh.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { SlideMarks } from './marks.js';
import { createSky, SUN_DIR } from './sky.js';
import { Post } from './post.js';
import { texturesReady } from './ground.js';
import { WHEEL_R } from './rider.js';
import { lerp } from './noise.js';
import { store, loadSettings, QUALITY, QUALITY_ORDER, DIFFICULTY, autoQuality } from './settings.js';

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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 12000);
const { sky, sun } = createSky(scene, renderer, Q);
const post = new Post(renderer, scene, camera, Q);

const seed = Math.floor(Math.random() * 1e9);
const road = new Road(seed);
road.ensure(7000);
const terrain = new Terrain(scene, road, seed + 11, Q, renderer);
const roadMesh = new RoadMesh(scene, road, renderer);
const player = new Player(scene, road, terrain, DIFFICULTY[settings.difficulty]);
const traffic = new Traffic(scene, road, DIFFICULTY[settings.difficulty]);
const input = new Input();
const audio = new Audio();
const marks = new SlideMarks(scene);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- game state
const game = {
  mode: 'loading', // loading | title | play | crashed | paused
  bonus: 0,
  combo: 0,
  comboTimer: 0,
  slidePts: 0,
  slideStartSpeed: 0,
  wasSliding: false,
  difficulty: settings.difficulty,
  best: 0,
  showFps: false,
  mph: store.get('powerslide.mph', false),
  muted: store.get('powerslide.muted', false),
  camMode: 0,
  runStartDist: 0,
  nearMisses: 0,
  hintTimer: 0,
  hintShown: false,
};
audio.muted = game.muted;
const bestKey = () => `powerslide.best.${game.difficulty}`;
game.best = store.get(bestKey(), 0);

// ---------------------------------------------------------------- menus
function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  $('toast').replaceChildren(el);
  setTimeout(() => el.remove(), 2700);
}

function renderOptions() {
  const diff = $('opt-diff');
  diff.replaceChildren(
    ...Object.entries(DIFFICULTY).map(([key, d]) => {
      const b = document.createElement('button');
      b.textContent = d.label;
      b.className = key === game.difficulty ? 'on' : '';
      b.onclick = () => setDifficulty(key);
      return b;
    }),
  );
  $('diff-blurb').textContent = DIFFICULTY[game.difficulty].blurb;
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

function setDifficulty(key) {
  if (game.mode !== 'title' || key === game.difficulty) return;
  game.difficulty = key;
  store.set('powerslide.difficulty', key);
  const d = DIFFICULTY[key];
  player.diff = d;
  traffic.density = d.trafficDensity;
  traffic.speedScale = d.trafficSpeed;
  game.best = store.get(bestKey(), 0);
  renderOptions();
}

function setQuality(key) {
  if (key === settings.qualityChoice) return;
  store.set('powerslide.quality', key);
  // Antialiasing and terrain detail are fixed at start-up, so reload.
  location.reload();
}

function toTitle() {
  $('crash').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('title').classList.remove('hidden');
  player.reset(player.s);
  game.mode = 'title';
  renderOptions();
}

renderOptions();
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

function score() {
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

function startRun() {
  audio.start();
  $('title').classList.add('hidden');
  $('crash').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (game.mode === 'crashed') {
    player.reset(player.s);
    for (const c of [...traffic.cars]) {
      if (Math.abs(c.s - player.s) < 90) {
        scene.remove(c.mesh);
        traffic.cars.splice(traffic.cars.indexOf(c), 1);
      }
    }
  }
  game.mode = 'play';
  game.bonus = 0;
  game.combo = 0;
  game.slidePts = 0;
  game.nearMisses = 0;
  game.runStartDist = player.distance;
  player.topSpeed = 0;
}

function endRun() {
  game.mode = 'crashed';
  const sc = score();
  const isBest = sc > game.best;
  if (isBest) {
    game.best = sc;
    store.set(bestKey(), sc);
  }
  $('crash-reason').textContent = player.crashReason;
  const unit = game.mph ? 'mph' : 'km/h';
  $('crash-stats').innerHTML = `${DIFFICULTY[game.difficulty].label} · Score <b>${sc}</b>${isBest ? ' — new best!' : ''}<br>
    Distance <b>${((player.distance - game.runStartDist) / 1000).toFixed(2)} km</b><br>
    Top speed <b>${fmtSpeed(player.topSpeed)} ${unit}</b><br>
    Near misses <b>${game.nearMisses}</b>`;
  $('crash').classList.remove('hidden');
}

$('start').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);
$('menu').addEventListener('click', toTitle);

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
  if (game.mode === 'title') {
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
  $('dist').textContent = `${((player.distance - game.runStartDist) / 1000).toFixed(2)} km`;
  $('best').textContent = Math.max(game.best, score());
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
  if (risk) st = 'SLIDE · STEER OUT TO CLOSE IT';
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

// ---------------------------------------------------------------- loop
const wheelPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
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
    game.mph = !game.mph;
    store.set('powerslide.mph', game.mph);
  }
  if (input.wasPressed('KeyF')) {
    game.showFps = !game.showFps;
    $('fps').classList.toggle('hidden', !game.showFps);
  }
  if (input.wasPressed('KeyC') || (pad(3) && game.mode === 'play')) game.camMode = (game.camMode + 1) % 3;
  if ((input.wasPressed('KeyP') || input.wasPressed('Escape') || pad(9)) && (game.mode === 'play' || game.mode === 'paused')) {
    game.mode = game.mode === 'play' ? 'paused' : 'play';
    $('pause').classList.toggle('hidden', game.mode !== 'paused');
    if (audio.ctx) game.mode === 'paused' ? audio.ctx.suspend() : audio.ctx.resume();
  } else if (game.mode === 'title') {
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || pad(0) || pad(9)) startRun();
    else if (pad(2)) setDifficulty(game.difficulty === 'pro' ? 'cruiser' : 'pro');
    else if (pad(3)) setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(settings.qualityChoice) + 1) % QUALITY_ORDER.length]);
  } else if (game.mode === 'crashed' && player.crashTime > 1) {
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || pad(0) || pad(9)) startRun();
    else if (input.wasPressed('Escape') || pad(1)) toTitle();
  }

  if (game.mode === 'paused') {
    input.endFrame();
    post.render();
    return;
  }
  time += dt;

  if (game.mode === 'play' || game.mode === 'crashed') {
    const wasCrashed = player.crashed;
    player.update(dt, game.mode === 'play' ? state : { steer: 0 });
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
      if (!game.wasSliding) game.slideStartSpeed = player.speed;
      game.slidePts += player.speed * dt * 4 * Math.abs(Math.sin(player.slip));
    } else if (game.wasSliding && !player.crashed) {
      const pts = Math.round(game.slidePts);
      if (pts >= 25) {
        game.bonus += pts;
        const unit = game.mph ? 'mph' : 'km/h';
        popup(`SLIDE +${pts}`, `${fmtSpeed(game.slideStartSpeed)} → ${fmtSpeed(player.speed)} ${unit}`);
      }
      game.slidePts = 0;
    }
    game.wasSliding = slidingNow;

    if (!game.hintShown && player.speed > 16 && game.mode === 'play') {
      game.hintShown = true;
      hint(
        document.body.classList.contains('is-touch') && !document.body.classList.contains('has-pad')
          ? 'Getting fast! Slide back to air brake, or hold a second finger to powerslide'
          : 'Getting fast! Hold SPACE to powerslide and scrub speed before bends',
      );
    }
  } else {
    // Title: let the rider idle on the road.
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

  road.ensure(player.s + 7000);
  roadMesh.update(player.s);
  terrain.update(player.pos.x, player.pos.z, 4);

  // Sun & shadows follow the rider.
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 150);
  sun.target.position.copy(player.pos);
  sky.position.copy(camera.position);

  updateResolution(dt);
  updateCamera(dt, time);
  audio.update(player, traffic.cars, camera);
  if (game.mode !== 'title') updateHud(dt);
  input.endFrame();
  post.render();
}

// ---------------------------------------------------------------- boot
async function boot() {
  roadMesh.update(player.s);
  let done = false;
  let built = 0;
  const total = terrain.tileCount;
  while (!done) {
    const before = terrain.near.size + terrain.far.size;
    done = terrain.update(player.pos.x, player.pos.z, 30);
    built += terrain.near.size + terrain.far.size - before;
    $('load-pct').textContent = `${Math.min(100, Math.round((built / total) * 100))}%`;
    await new Promise((r) => setTimeout(r, 0));
  }
  await texturesReady();
  $('loading').classList.add('hidden');
  $('controls').classList.remove('hidden');
  game.mode = 'title';
  // Warm up: settle the rider pose and a few cars.
  for (let i = 0; i < 4; i++) traffic.spawn(player.s, i % 2 ? 1 : -1);
  player.animate(0.016);
  $('best').textContent = game.best;
}

requestAnimationFrame(frame);
boot();

// Exposed for debugging in the console.
const debug = { freeze: false };
window.__powerslide = Object.assign(debug, { game, player, road, terrain, traffic, camera, renderer, scene, settings, post, renderFrame: () => post.render() });
