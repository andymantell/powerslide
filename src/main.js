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
import { WHEEL_R } from './rider.js';
import { lerp } from './noise.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 12000);
const { sky, sun } = createSky(scene);

const seed = Math.floor(Math.random() * 1e9);
const road = new Road(seed);
road.ensure(7000);
const terrain = new Terrain(scene, road, seed + 11);
const roadMesh = new RoadMesh(scene, road, renderer);
const player = new Player(scene, road, terrain);
const traffic = new Traffic(scene, road);
const input = new Input();
const audio = new Audio();
const marks = new SlideMarks(scene);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
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
  best: store.get('powerslide.best', 0),
  mph: store.get('powerslide.mph', false),
  muted: store.get('powerslide.muted', false),
  camMode: 0,
  runStartDist: 0,
  nearMisses: 0,
  hintTimer: 0,
  hintShown: false,
};
audio.muted = game.muted;

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
    store.set('powerslide.best', sc);
  }
  $('crash-reason').textContent = player.crashReason;
  const unit = game.mph ? 'mph' : 'km/h';
  $('crash-stats').innerHTML = `Score <b>${sc}</b>${isBest ? ' — new best!' : ''}<br>
    Distance <b>${((player.distance - game.runStartDist) / 1000).toFixed(2)} km</b><br>
    Top speed <b>${fmtSpeed(player.topSpeed)} ${unit}</b><br>
    Near misses <b>${game.nearMisses}</b>`;
  $('crash').classList.remove('hidden');
}

$('start').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);

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
  else if (player.brake > 0.5) st = 'FOOTBRAKE';
  if (player.fakie) st = (st ? st + ' · ' : '') + 'FAKIE';
  if (game.combo > 1) st += `  x${game.combo}`;
  $('state').textContent = st;
  if (game.hintTimer > 0) {
    game.hintTimer -= dt;
    if (game.hintTimer <= 0) $('hint').textContent = '';
  }
}

function hint(text, time = 4) {
  $('hint').textContent = text;
  game.hintTimer = time;
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
  if (game.mode === 'loading') return;

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
  if (input.wasPressed('KeyC')) game.camMode = (game.camMode + 1) % 3;
  if ((input.wasPressed('KeyP') || input.wasPressed('Escape')) && (game.mode === 'play' || game.mode === 'paused')) {
    game.mode = game.mode === 'play' ? 'paused' : 'play';
    $('pause').classList.toggle('hidden', game.mode !== 'paused');
    if (audio.ctx) game.mode === 'paused' ? audio.ctx.suspend() : audio.ctx.resume();
  }
  if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) {
    if (game.mode === 'title') startRun();
    else if (game.mode === 'crashed' && player.crashTime > 1) startRun();
  }

  const state = input.update(dt);
  if (game.mode === 'paused') {
    input.endFrame();
    renderer.render(scene, camera);
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
      hint('Getting fast! Hold SPACE to powerslide and scrub speed before bends');
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

  updateCamera(dt, time);
  audio.update(player, traffic.cars, camera);
  if (game.mode !== 'title') updateHud(dt);
  input.endFrame();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
async function boot() {
  roadMesh.update(player.s);
  let done = false;
  let built = 0;
  const total = 9 * 9 + 7 * 7;
  while (!done) {
    const before = terrain.near.size + terrain.far.size;
    done = terrain.update(player.pos.x, player.pos.z, 30);
    built += terrain.near.size + terrain.far.size - before;
    $('load-pct').textContent = `${Math.min(100, Math.round((built / total) * 100))}%`;
    await new Promise((r) => setTimeout(r, 0));
  }
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
window.__powerslide = { game, player, road, terrain, traffic, camera, renderer, scene };
