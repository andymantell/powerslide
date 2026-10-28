// Two-way traffic. Downhill vehicles share the rider's lane and slow for
// bends, so a fast rider has to pick a gap to overtake; uphill ones come at
// you in the other lane. Which side is "your" lane depends on the country:
// biomes with `drive: 'left'` keep left.
//
// Each biome has its own mix of vehicles (MIXES), and every vehicle gets its
// own paint, trim and wheels. Recent spawns are remembered so the same type,
// or the same type in the same colour, doesn't come past twice in a row.

import * as THREE from 'three';
import { LANE_WIDTH, HALF_WIDTH } from './road.js';
import { clamp, mulberry32 } from './noise.js';
import { VehicleFleet } from './vehicles.js';

const G = 9.81;

// Paint palettes, roughly in proportion to what's on the road: lots of grey,
// black, white and silver, then blues and reds, and the odd bright one.
const CAR_PAINT = [
  ['#c9ccd0', 9], ['#7d8288', 9], ['#2b2e33', 8], ['#0c0c0e', 8], ['#f1f1ee', 9], ['#1d3557', 5], ['#2f5c8f', 4],
  ['#8d1b1b', 4], ['#c22a1f', 3], ['#41484f', 4], ['#24402f', 2], ['#5a6b3c', 1], ['#e2b33a', 1], ['#d95d1a', 1],
  ['#6a2a4f', 1], ['#7ab6d8', 1], ['#a8a08a', 2], ['#4b2e20', 1],
];
const VAN_PAINT = [['#f4f4f2', 14], ['#c9ccd0', 3], ['#1d3557', 2], ['#2b2e33', 2], ['#8d1b1b', 1], ['#e2b33a', 1], ['#2d6a3e', 1]];
const LORRY_PAINT = [['#f4f4f2', 6], ['#1d3557', 2], ['#8d1b1b', 2], ['#2d6a3e', 1], ['#e08a1c', 1], ['#c9ccd0', 2]];
const TRACTOR_PAINT = [['#2f6b2a', 4], ['#b8241c', 4], ['#1f4f8f', 2], ['#d9822b', 1], ['#c9b531', 1]];
const UTILITY_PAINT = [['#2f4a35', 4], ['#c9ccd0', 2], ['#3f5a6e', 2], ['#e8e4d4', 2], ['#1a1a1a', 2], ['#7c6d4e', 1]];
const BIKE_PAINT = [['#c22a1f', 3], ['#0c0c0e', 4], ['#f1f1ee', 2], ['#1f4f8f', 2], ['#3a8f2f', 1], ['#e2b33a', 1], ['#d95d1a', 1], ['#7d8288', 2]];
const BUS_PAINT = [['#b8241c', 1], ['#1f4f8f', 1], ['#e2b33a', 1], ['#2d6a3e', 1]];
const TAXI_PAINT = [['#f1c21b', 1]];
const CAMPER_PAINT = [['#f1f1ee', 3], ['#e2b33a', 1], ['#7ab6d8', 1], ['#d95d1a', 1], ['#5f8f6a', 1]];

// Trim (bumper inserts, grilles, rails): black, dark grey or bright.
const TRIM_CAR = [['#141516', 6], ['#2a2c2f', 2], ['#b9bcc0', 2], ['body', 1]];
const TRIM_BOX = [['#f4f4f2', 6], ['#c9ccd0', 2], ['#1d3557', 1], ['#8d1b1b', 1], ['#2d6a3e', 1]];
const TRIM_LEATHERS = [['#141516', 6], ['#2a2c2f', 2], ['#3a4250', 2], ['#5a1d1d', 1], ['#e8e6e0', 1]];
const RIMS = [['#c9ccd0', 5], ['#3a3c40', 3], ['#16171a', 2], ['#8f9398', 2]];

// type: kind, paint, trim, speed range (m/s), rims (style -> alternatives).
const TYPES = {
  city: { kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [12, 18], wheels: { alloy: ['alloy', 'steel', 'alloy2'] } },
  hatch: { kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [13, 20], wheels: { alloy: ['alloy', 'alloy2', 'steel'] } },
  saloon: { kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [14, 21], wheels: { alloy: ['alloy', 'alloy2'] } },
  estate: { kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [13, 20], wheels: { alloy: ['alloy', 'alloy2'] } },
  coupe: { kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [16, 24], wheels: { alloy: ['alloy2', 'alloy'] } },
  suv: { sound: 'suv', kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [13, 20], wheels: { alloy: ['alloy', 'alloy2'] } },
  utility: { sound: 'suv', kind: 'car', paint: UTILITY_PAINT, trim: [['#141516', 1]], speed: [11, 17], wheels: { alloy: ['steel'] }, name: 'a 4x4' },
  pickup: { sound: 'pickup', kind: 'car', paint: CAR_PAINT, trim: TRIM_CAR, speed: [12, 19], wheels: { alloy: ['alloy', 'steel'] }, name: 'a pickup' },
  taxi: { sound: 'taxi', kind: 'car', paint: TAXI_PAINT, trim: [['#141516', 1]], speed: [13, 19], wheels: { alloy: ['alloy'] }, name: 'a taxi' },
  van: { kind: 'van', paint: VAN_PAINT, trim: TRIM_CAR, speed: [12, 18], name: 'a van' },
  minibus: { kind: 'van', paint: VAN_PAINT, trim: TRIM_CAR, speed: [11, 16], name: 'a minibus' },
  camper: { sound: 'camper', kind: 'van', paint: CAMPER_PAINT, trim: [['#f1f1ee', 2], ['#c9ccd0', 1]], speed: [10, 15], name: 'a camper van' },
  lorry: { kind: 'lorry', paint: LORRY_PAINT, trim: TRIM_BOX, speed: [10, 15], name: 'a lorry' },
  tipper: { kind: 'lorry', paint: LORRY_PAINT, trim: [['#e08a1c', 2], ['#c9b531', 1], ['#7d8288', 2], ['#8d1b1b', 1]], speed: [9, 14], name: 'a tipper lorry' },
  logger: { sound: 'lorry', kind: 'lorry', paint: LORRY_PAINT, trim: [['#2a2c2f', 3], ['#5a5d61', 1], ['#8d1b1b', 1]], speed: [8, 13], name: 'a logging truck' },
  postbus: { sound: 'bus', kind: 'bus', paint: [['#f2c200', 1]], trim: [['#c4161c', 1]], speed: [9, 14], name: 'a post bus' },
  bus: { kind: 'bus', paint: BUS_PAINT, trim: [['#f1f1ee', 1]], speed: [9, 14], name: 'a bus' },
  tractor: { kind: 'tractor', paint: TRACTOR_PAINT, trim: [['#3a3c40', 1]], rims: [['#c9b531', 3], ['#b8241c', 2], ['#5a5d61', 1]], speed: [6, 9], name: 'a tractor' },
  police: { sound: 'police', kind: 'car', paint: [['#f1f1ee', 3], ['#c9ccd0', 1]], trim: [['#141516', 1]], speed: [16, 23], wheels: { alloy: ['alloy'] }, name: 'a police car', emergency: true },
  ambulance: { sound: 'ambulance', kind: 'van', paint: [['#e6e23a', 1]], trim: [['#141516', 1]], speed: [15, 21], name: 'an ambulance', emergency: true },
  fire: { sound: 'fire', kind: 'lorry', paint: [['#c4161c', 1]], trim: [['#c4161c', 1]], rims: [['#c9ccd0', 1]], speed: [13, 18], name: 'a fire engine', emergency: true },
  icecream: { sound: 'icecream', kind: 'van', paint: [['#f6f3ea', 3], ['#f4c6d6', 1], ['#bfe3f2', 1]], trim: [['#e86fa0', 2], ['#4fa3d9', 2], ['#7cc576', 1]], speed: [9, 13], name: 'an ice cream van' },
  horsebox: { sound: 'horsebox', kind: 'lorry', paint: [['#f4f4f2', 3], ['#1d3557', 1], ['#24402f', 1]], trim: [['#f4f4f2', 2], ['#7c6d4e', 1], ['#24402f', 1], ['#1d3557', 1]], speed: [9, 13], name: 'a horsebox' },
  decker: { kind: 'bus', paint: [['#c4161c', 3], ['#1f4f8f', 1], ['#2d6a3e', 1]], trim: [['#f1f1ee', 1]], speed: [9, 13], name: 'a double-decker bus' },
  supercar: { kind: 'car', paint: [['#e2b33a', 2], ['#c22a1f', 3], ['#2fa84f', 1], ['#f1f1ee', 1], ['#0c0c0e', 2], ['#d95d1a', 2], ['#7ab6d8', 1]], trim: [['#141516', 1]], rims: [['#16171a', 2], ['#3a3c40', 1], ['#c9ccd0', 1]], speed: [19, 28], wheels: { alloy: ['alloy2'] }, name: 'a supercar' },
  roadster: { kind: 'car', paint: [['#c22a1f', 3], ['#1d3557', 2], ['#24402f', 2], ['#f1f1ee', 1], ['#c9ccd0', 1]], trim: [['#b9bcc0', 2], ['#141516', 1]], speed: [16, 23], wheels: { alloy: ['alloy', 'steel'] }, name: 'a sports car' },
  gt: { kind: 'car', paint: [['#1d3557', 2], ['#7d8288', 2], ['#0c0c0e', 2], ['#8d1b1b', 2], ['#2a5f3a', 1], ['#f1f1ee', 1], ['#d95d1a', 1]], trim: [['#141516', 2], ['#b9bcc0', 1]], speed: [17, 25], wheels: { alloy: ['alloy2', 'alloy'] }, name: 'a sports car' },
  bike_sport: { kind: 'bike', paint: BIKE_PAINT, trim: TRIM_LEATHERS, speed: [16, 25], name: 'a motorbike' },
  bike_tourer: { kind: 'bike', paint: BIKE_PAINT, trim: TRIM_LEATHERS, speed: [14, 21], name: 'a motorbike' },
};

// Each biome's traffic, as relative weights.
const MIXES = {
  alpine: { hatch: 4, saloon: 3, estate: 4, suv: 4, city: 2, coupe: 1, van: 2, camper: 2, pickup: 1, minibus: 1, lorry: 1, tipper: 1, bike_sport: 1.5, bike_tourer: 2, police: 0.3, ambulance: 0.25, fire: 0.15, icecream: 0.3, supercar: 0.5, roadster: 1, gt: 0.6 },
  dartmoor: { hatch: 3, estate: 3, suv: 2, utility: 4, pickup: 3, tractor: 3, van: 2, camper: 2, city: 2, saloon: 1, minibus: 1, bike_tourer: 1.5, bike_sport: 0.5, tipper: 0.5, horsebox: 1.2, police: 0.25, ambulance: 0.25, fire: 0.1, icecream: 0.4, roadster: 0.6, gt: 0.3 },
  suburbs: { city: 4, hatch: 5, saloon: 3, estate: 3, suv: 3, van: 3, minibus: 1, coupe: 1, pickup: 0.5, lorry: 1, bike_tourer: 1, bike_sport: 0.5, taxi: 0.5, icecream: 1, decker: 0.6, police: 0.5, ambulance: 0.4, fire: 0.25, roadster: 0.4, gt: 0.4, supercar: 0.2 },
  forest: { hatch: 3, estate: 4, suv: 4, pickup: 3, utility: 2, van: 2, lorry: 1, logger: 3.5, tipper: 1, camper: 1, bike_tourer: 1, saloon: 2, horsebox: 0.3, police: 0.25, ambulance: 0.2, fire: 0.2, gt: 0.4 },
  canyon: { pickup: 5, suv: 4, coupe: 2, saloon: 2, camper: 3, lorry: 2, tipper: 1, bike_tourer: 2, bike_sport: 2, hatch: 1, gt: 1.5, supercar: 1, roadster: 0.6, police: 0.4, ambulance: 0.2, fire: 0.15 },
  city: { taxi: 5, saloon: 3, hatch: 3, city: 3, bus: 2, van: 2, suv: 2, coupe: 1, lorry: 1, bike_sport: 2, bike_tourer: 1.5, minibus: 1, decker: 2, police: 1, ambulance: 0.7, fire: 0.4, supercar: 1, gt: 0.8, roadster: 0.4 },
  coast: { hatch: 3, estate: 3, camper: 4, suv: 2, coupe: 2, city: 2, van: 1, bus: 1, tractor: 0.6, lorry: 0.5, bike_tourer: 2, bike_sport: 1, saloon: 2, icecream: 1, roadster: 1.5, gt: 0.8, supercar: 0.8, police: 0.3, ambulance: 0.25, fire: 0.1 },
  pass: { bike_sport: 4, bike_tourer: 4, camper: 4, hatch: 3, estate: 3, suv: 3, saloon: 1, coupe: 1.5, postbus: 1.2, bus: 0.4, minibus: 0.6, supercar: 1.2, gt: 1, roadster: 1.2, police: 0.2, ambulance: 0.2, fire: 0.05 },
};

const TRAFFIC_SCALE = 2 / 3;

const VERB = { car: 'a car', van: 'a van', lorry: 'a lorry', bus: 'a bus', tractor: 'a tractor', bike: 'a motorbike' };

function pick(rand, list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rand() * total;
  for (const e of list) {
    r -= e[1];
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

// A vehicle's paint, trim, rims and wheel style (paintHex: a chosen paint).
export function sampleLook(type, r, paintHex = pick(r, TYPES[type].paint)[0]) {
  const T = TYPES[type];
  // A little variation in shade so two silver cars still differ.
  const paint = new THREE.Color(paintHex).offsetHSL(0, (r() - 0.5) * 0.06, (r() - 0.5) * 0.05);
  const trimHex = pick(r, T.trim)[0];
  const trim = trimHex === 'body' ? paint.clone() : new THREE.Color(trimHex);
  const rim = new THREE.Color(pick(r, T.rims || RIMS)[0]);
  const wheelStyle = {};
  if (T.wheels) for (const [from, alts] of Object.entries(T.wheels)) wheelStyle[from] = alts[Math.floor(r() * alts.length)];
  return { paint, trim, rim, wheelStyle };
}

export class Traffic {
  // opts: density (spawn rate scale) and speed (car speed scale).
  constructor(scene, road, q = {}) {
    this.scene = scene;
    this.road = road;
    this.fleet = new VehicleFleet(scene, q);
    this.cars = [];
    this.frame = {};
    this.side = 1; // +1 drive on the right, -1 on the left
    this.mix = MIXES.alpine;
    this.sideRoads = [];
    this.parked = [];
    this.drawn = [];
    this.configure();
  }

  // Parked cars: still traffic models, placed by the level's props.
  clearParked() {
    this.parked.length = 0;
    this.parkRand = mulberry32(911);
    this.heightAt = null; // known once the level's terrain is final
  }

  // type: a model name, or 'any' for an everyday car. yaw as props use it.
  park(type, x, z, yaw, y = null) {
    const r = this.parkRand || (this.parkRand = mulberry32(911));
    if (!TYPES[type]) {
      const any = ['hatch', 'hatch', 'saloon', 'estate', 'suv', 'city', 'city', 'coupe', 'van'];
      type = any[Math.floor(r() * any.length)];
    }
    const T = TYPES[type];
    const meta = this.fleet.meta(type) || { L: 4.4, W: 1.8 };
    const look = sampleLook(type, r);
    this.parked.push({
      type, cls: T.kind, kind: T.sound || T.kind, name: 'a parked car', L: meta.L, W: meta.W,
      s: 0, dir: 1, lane: 0, v: 0, x, y: y ?? 0, z, yaw: -yaw, pitch: 0, roll: 0, spin: 0,
      settle: y === null, ...look, lamps: { head: 0, tail: 0, amber: 0 },
      passed: true, minGap: Infinity, honked: true, lastLz: null,
    });
    // Endless adds them as it goes, on finished terrain; keep the list short.
    if (this.heightAt) this.settleParked(this.heightAt);
    if (this.parked.length > 160) this.parked.splice(0, this.parked.length - 160);
  }

  // Sits parked cars on the ground (once the terrain is final), tilted to it.
  settleParked(heightAt) {
    this.heightAt = heightAt;
    for (const c of this.parked) {
      if (!c.settle) continue;
      c.settle = false;
      const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      const a = c.L * 0.32, b = c.W * 0.4;
      const hf = heightAt(c.x + fx * a, c.z + fz * a), hr = heightAt(c.x - fx * a, c.z - fz * a);
      const hl = heightAt(c.x + fz * b, c.z - fx * b), hrt = heightAt(c.x - fz * b, c.z + fx * b);
      c.y = (hf + hr + hl + hrt) / 4;
      c.pitch = Math.atan2(hf - hr, 2 * a);
      c.roll = Math.atan2(hl - hrt, 2 * b) * -1;
    }
  }

  // Side roads (Structures.sideRoads) that cars pull out of.
  setSideRoads(list) {
    this.sideRoads = list || [];
  }

  // Headlamp level: 0 in daylight, 1 at night.
  get lights() {
    return this.fleet.night || 0;
  }

  set lights(v) {
    this.fleet.setNight(v);
  }

  // Which country's roads: biome id for the mix, drive 'left' or 'right'.
  setPlace(biomeId, drive) {
    this.mix = MIXES[biomeId] || MIXES.alpine;
    this.side = drive === 'left' ? -1 : 1;
  }

  // Clears the road and restarts the spawn sequence, so a level's traffic
  // plays out the same way on every attempt.
  configure(opts = {}, seed = 2024) {
    this.clear();
    this.rand = mulberry32(seed);
    this.spawnTimer = 0;
    this.joinTimer = 4;
    // Two thirds of the level's (or endless setting's) density: Andy found a
    // third less traffic plays better.
    this.density = (opts.density ?? 1) * TRAFFIC_SCALE;
    this.speedScale = opts.speed ?? 1;
    this.recent = []; // last spawns: { type, paint }
  }

  clear() {
    this.cars.length = 0;
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  // Picks a type from the biome's mix, steering away from recent ones.
  pickType(dir) {
    const r = this.rand;
    const list = [];
    for (const [type, w] of Object.entries(this.mix)) {
      if (!this.fleet.meta(type) && this.fleet.types && Object.keys(this.fleet.types).length) continue;
      let k = w;
      const last = this.recent.findIndex((e) => e.type === type);
      if (last === 0) k *= 0.04;
      else if (last > 0 && last < 3) k *= 0.25;
      else if (last >= 3) k *= 0.6;
      // Slow vehicles mostly travel downhill in your lane (more to overtake).
      if (dir < 0 && (type === 'tractor' || type === 'tipper')) k *= 0.5;
      list.push([type, k]);
    }
    return pick(r, list)[0];
  }

  pickPaint(type, list) {
    // Avoid a colour this type wore recently, and the very last car's colour.
    const used = new Set(this.recent.filter((e, i) => e.type === type || i === 0).map((e) => e.paint));
    const fresh = list.length > 2 ? list.filter(([c]) => !used.has(c)) : list;
    return pick(this.rand, fresh.length ? fresh : list)[0];
  }

  spawn(playerS, dir, at, join) {
    const r = this.rand;
    let type = this.pickType(dir);
    // Nothing big squeezes out of a side street.
    if (join && !['car', 'van', 'bike'].includes(TYPES[type].kind)) type = 'hatch';
    const T = TYPES[type];
    const meta = this.fleet.meta(type) || { L: 4.4, W: 1.8, kind: T.kind };
    // Emergency vehicles mostly have their blue lights on. They keep to
    // their lane, so the rider always has a way through.
    const siren = !!T.emergency && r() < 0.75 && !join;
    const s = at ?? (dir < 0 ? playerS + 550 + r() * 250 : playerS + 220 + r() * 380);
    // Keep a sensible gap to vehicles already in that lane.
    for (const c of this.cars) if (c.dir === dir && Math.abs(c.s - s) < 30 + (c.L + meta.L) * 1.5) return;
    const paintHex = this.pickPaint(type, T.paint);
    const { paint, trim, rim, wheelStyle } = sampleLook(type, r, paintHex);
    this.recent.unshift({ type, paint: paintHex });
    this.recent.length = Math.min(this.recent.length, 8);
    const [v0, v1] = T.speed;
    const bike = T.kind === 'bike';
    const car = {
      type,
      cls: T.kind, // driving class: car, van, lorry, bus, tractor, bike
      kind: T.sound || { bike: 'motorbike' }[T.kind] || T.kind, // what it sounds like (audio.js)
      name: T.name || VERB[T.kind],
      L: meta.L,
      W: meta.W,
      s,
      dir,
      // Bikes ride a little towards the middle of the lane.
      lane: dir * this.side * (LANE_WIDTH / 2 - (bike ? 0.35 : 0)),
      home: dir * this.side * (LANE_WIDTH / 2 - (bike ? 0.35 : 0)),
      laneRate: 0,
      siren,
      flash: r(),
      vmax: (v0 + r() * (v1 - v0)) * (dir > 0 ? 0.9 : 1) * this.speedScale * (siren ? 1.3 : 1),
      v: 0,
      passed: false,
      minGap: Infinity,
      honked: false,
      lastLz: null,
      paint,
      trim,
      rim,
      wheelStyle,
      spin: r() * 10,
      roll: 0,
      pitch: 0,
      lamps: { head: 0, tail: 0, amber: 0 },
      braking: false,
      beacon: type === 'tractor' ? r() * 6 : -1,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    };
    car.v = car.vmax * 0.8;
    if (join) {
      car.join = join;
      car.v = 0;
      this.placeJoin(car);
    } else this.place(car, 0);
    this.cars.push(car);
    return car;
  }

  // Now and then a car waits at a side road ahead of the rider, then pulls
  // out into either lane when the gap is clear.
  pullOut(ps) {
    const r = this.rand;
    const ahead = this.sideRoads.filter((j) => j.s > ps + 60 && j.s < ps + 260);
    if (!ahead.length) return;
    const j = ahead[Math.floor(r() * ahead.length)];
    if (this.cars.some((c) => c.join && c.join.road === j)) return;
    const dir = r() < 0.5 ? 1 : -1;
    // Nearside: the lane on the side road's own side of the main road.
    const near = dir * this.side === j.side;
    const car = this.spawn(ps, dir, j.s, { road: j, phase: 'wait', u: 0, wait: 1.5 + r() * 2, near });
    if (car) car.vmax = Math.min(car.vmax, 15);
  }

  // A joining car's path: a curve from the give-way line on the side road
  // into its lane on the main road. Returns x, z (and the tangent) at u 0..1.
  joinPath(c, u) {
    const j = c.join.road;
    const at = (t, n) => [j.ox + j.ux * t + j.vx * n, j.oz + j.uz * t + j.vz * n];
    // On the side road it keeps to its side (left when driving on the left).
    // Its right, heading in along -u, is (uz, -ux); keep to the driving side.
    const n0 = this.side * (j.uz * j.vx - j.ux * j.vz) * (LANE_WIDTH / 2);
    const t0 = HALF_WIDTH + 1.2 + c.L / 2;
    const d = c.dir;
    const lane = c.home; // lateral offset on the main road (right of +s)
    const side = j.side; // +1: side road on the right of +s, so t = lane * side
    // Points in (t out along the side road, n along the main road) terms.
    const P = [
      [t0, n0],
      [t0 - c.L * 0.6, n0],
      [lane * side, d * 4],
      [lane * side, d * (9 + c.L / 2)],
    ];
    const v = 1 - u;
    const b = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
    const db = [-3 * v * v, 3 * v * v - 6 * v * u, 6 * v * u - 3 * u * u, 3 * u * u];
    let t = 0, n = 0, dt = 0, dn = 0;
    for (let i = 0; i < 4; i++) {
      t += b[i] * P[i][0]; n += b[i] * P[i][1];
      dt += db[i] * P[i][0]; dn += db[i] * P[i][1];
    }
    const [x, z] = at(t, n);
    return { x, z, t, dx: j.ux * dt + j.vx * dn, dz: j.uz * dt + j.vz * dn };
  }

  placeJoin(c) {
    const j = c.join.road;
    const p = this.joinPath(c, c.join.u);
    c.x = p.x;
    c.z = p.z;
    const fr = this.road.sample(j.s, this.frame);
    const tw = Math.max(0, p.t);
    c.y = tw > HALF_WIDTH ? j.y(tw) : fr.y;
    c.yaw = Math.atan2(p.dx, -p.dz);
    c.pitch = 0;
    // Where it is in main-road terms, so following and the
    // rider's collision checks all see it.
    const rx = p.x - j.ox, rz = p.z - j.oz;
    c.s = j.s + rx * j.vx + rz * j.vz;
    c.lane = rx * fr.rightX + rz * fr.rightZ;
  }

  // Waits for a gap, then follows the curve out; hands over to the normal
  // driving at the end of it.
  driveJoin(c, ps, player, dt) {
    const J = c.join;
    if (J.phase === 'wait') {
      J.wait -= dt;
      const busy = this.cars.some((o) => o !== c && !o.join && Math.abs(o.s - J.road.s) < 45 + o.v * 1.5);
      // It gives way to the rider too, unless you're still a long way off.
      const riderGap = J.road.s - ps;
      const riderClose = riderGap > -6 && riderGap < 45 + player.speed * 1.2;
      if (J.wait <= 0 && !busy && !riderClose) J.phase = 'go';
      c.braking = true;
      c.v = 0;
    } else {
      c.braking = false;
      c.v = Math.min(c.v + 2.2 * dt, 7);
      const len = 14 + c.L;
      J.u = Math.min(1, J.u + (c.v * dt) / len);
      if (J.u >= 1) {
        c.join = null;
        c.lane = c.home;
        this.place(c, dt);
        return;
      }
    }
    this.placeJoin(c);
    c.spin -= c.v * dt;
  }

  // Positions a vehicle from the road under its front and rear axles, so
  // long ones follow bends and crests instead of hanging off them.
  place(car, dt) {
    const f = this.frame;
    const half = Math.min(car.L * 0.32, 3.2);
    const sf = car.s + car.dir * half;
    const sr = car.s - car.dir * half;
    // During a lane change the nose leads: offset the axles along the move.
    const lead = car.laneRate * car.dir * half / Math.max(4, car.v);
    let fr = this.road.sample(sf, f);
    const fx = fr.x + fr.rightX * (car.lane + lead), fz = fr.z + fr.rightZ * (car.lane + lead), fy = fr.y;
    fr = this.road.sample(sr, f);
    const rx = fr.x + fr.rightX * (car.lane - lead), rz = fr.z + fr.rightZ * (car.lane - lead), ry = fr.y;
    const dx = fx - rx, dz = fz - rz;
    const len = Math.hypot(dx, dz) || 1;
    car.x = (fx + rx) / 2;
    car.z = (fz + rz) / 2;
    car.y = (fy + ry) / 2;
    car.yaw = Math.atan2(dx, -dz);
    car.pitch = Math.atan2(fy - ry, len);
    if (car.cls === 'bike') {
      // Lean into bends: tan(lean) = v^2 k / g, signed by the turn direction.
      this.road.sample(car.s, f);
      const want = clamp(Math.atan((car.v * car.v * f.kappa) / G), -0.6, 0.6) * car.dir;
      car.roll += (want - car.roll) * Math.min(1, dt * 4);
    }
    car.spin -= car.v * dt;
  }

  update(dt, player, events) {
    const ps = player.s;
    this.dt = dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.density > 0) {
      this.spawnTimer = (1.4 + this.rand() * 2.2) / this.density;
      const down = this.cars.filter((c) => c.dir > 0).length;
      const up = this.cars.length - down;
      const dir = this.rand() < 0.62 ? -1 : 1;
      if (dir < 0 ? up < 5 : down < 3) this.spawn(ps, dir);
    }
    if (this.sideRoads.length && this.density > 0) {
      this.joinTimer -= dt;
      if (this.joinTimer <= 0) {
        this.joinTimer = (5 + this.rand() * 7) / this.density;
        this.pullOut(ps);
      }
    }
    const f = this.frame;
    const night = this.lights;
    if (!player.crashed) for (const c of this.parked) this.interact(c, player, events);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.join) {
        this.driveJoin(c, ps, player, dt);
        this.lampsFor(c, night, dt);
        if (c.s < ps - 220) this.cars.splice(i, 1);
        else if (!player.crashed) this.interact(c, player, events);
        continue;
      }
      // Corner speed: drivers keep lateral acceleration modest (big ones more so).
      let vt = c.vmax;
      const look = c.s + c.dir * 25;
      this.road.sample(look, f);
      const k = Math.abs(f.kappa);
      const latG = c.cls === 'lorry' || c.cls === 'bus' ? 0.22 : c.cls === 'bike' ? 0.42 : 0.32;
      if (k > 1e-4) vt = Math.min(vt, Math.sqrt((latG * G) / k));
      // Ease right down for a mini roundabout and round the dome.
      for (const j of this.sideRoads) {
        if (!j.roundabout || j.side < 0) continue;
        const ahead = (j.s - c.s) * c.dir;
        if (ahead > -6 && ahead < 40) vt = Math.min(vt, 6 + Math.max(0, ahead - 12) * 0.35);
      }
      // Follow the vehicle ahead in the same lane; pull over for a siren behind.
      let blocker = null;
      let pullOver = false;
      for (const o of this.cars) {
        if (o === c) continue;
        // Something pulling out across or into this lane ahead: stop for it.
        if (o.join && o.join.phase === 'go') {
          const ahead = (o.s - c.s) * c.dir;
          if (ahead > 0 && ahead < 40 && Math.abs(o.lane - c.lane) < 2.4) vt = Math.min(vt, Math.max(0, (ahead - c.L / 2 - 6) * 0.5));
          continue;
        }
        if (o.dir !== c.dir) continue;
        const gap = (o.s - c.s) * c.dir - (o.L + c.L) / 2;
        if (Math.abs(o.lane - c.lane) < 1.6 && gap > 0 && gap < 36) {
          vt = Math.min(vt, o.v * (gap < 12 ? 0.7 : 1));
          if (!blocker || gap < blocker.gap) blocker = { gap, v: o.v };
        }
        if (o.siren && gap < 0 && gap > -70 && !c.siren) pullOver = true;
      }
      // Slow down for a rider stopped/slow in their lane ahead.
      const gapP = (ps - c.s) * c.dir - c.L / 2;
      const riderAhead = gapP > 0 && gapP < 33 && Math.abs(player.d - c.lane) < 2.2 && !player.crashed;
      if (riderAhead && c.dir > 0 && (!blocker || gapP < blocker.gap)) blocker = { gap: gapP, v: player.speed, rider: true };
      if (riderAhead) {
        vt = Math.min(vt, Math.max(0, player.speed * (c.dir > 0 ? 1 : 0) + (gapP - 6) * 0.3));
      }
      if (pullOver) {
        // Let the blue lights through: tuck in towards the verge and ease off.
        vt *= 0.6;
        this.steerTo(c, c.home * 1.3, dt);
      } else this.steerTo(c, c.home, dt);
      c.braking = vt < c.v - 0.3;
      const accel = c.cls === 'lorry' || c.cls === 'bus' || c.cls === 'tractor' ? 1.1 : c.cls === 'bike' ? 3.5 : 2.2;
      c.v += clamp(vt - c.v, -6 * dt, accel * dt);
      c.s += c.v * c.dir * dt;
      this.place(c, dt);
      this.lampsFor(c, night, dt);

      if (c.s < ps - 220 || c.s > ps + 1000) {
        this.cars.splice(i, 1);
        continue;
      }
      if (!player.crashed) this.interact(c, player, events);
    }
  }

  lampsFor(c, night, dt) {
    c.lamps.head = 0.06 + night * 3.5;
    c.lamps.tail = (c.braking ? 2.6 : 0.35) + night * 0.9;
    if (c.beacon >= 0) {
      c.beacon += dt;
      c.lamps.amber = (c.beacon % 0.9) < 0.3 ? 4 : 0.1;
    } else if (c.siren) {
      // Blue lights: a quick double flash.
      c.flash += dt;
      const ph = c.flash % 0.7;
      c.lamps.amber = ph < 0.08 || (ph > 0.16 && ph < 0.24) ? 6 : 0.15;
    } else if (c.join && c.join.phase === 'wait') {
      // Indicating: which way it's about to turn.
      c.flash += dt;
      c.lamps.amber = c.flash % 0.8 < 0.4 ? 3 : 0.1;
    } else c.lamps.amber = TYPES[c.type].emergency ? 0.15 : 0.3 + night;
  }

  // Eases a vehicle towards a lateral position (m from the centreline).
  steerTo(c, target, dt) {
    const want = clamp((target - c.lane) * 1.6, -1.8, 1.8);
    c.laneRate += clamp(want - c.laneRate, -3 * dt, 3 * dt);
    c.lane += c.laneRate * dt;
  }

  // Draws the traffic; call once a frame after update.
  draw(camera) {
    const d = this.drawn;
    d.length = 0;
    for (const c of this.cars) d.push(c);
    for (const c of this.parked) d.push(c);
    this.fleet.update(d, camera);
  }

  interact(c, player, events) {
    const dx = player.pos.x - c.x;
    const dz = player.pos.z - c.z;
    const reach = c.L / 2 + 14;
    if (dx * dx + dz * dz > reach * reach) {
      c.lastLz = null;
      return;
    }
    // Player in vehicle-local coordinates (lz forward along it).
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const lz = dx * fx + dz * fz;
    const lx = dx * -fz + dz * fx;
    const hx = c.W / 2 + 0.3;
    const hz = c.L / 2 + 0.3;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz && Math.abs(player.pos.y - c.y) < 2.5) {
      // Thrown back off the bumper at roughly its speed.
      const front = lz > 0;
      const what = c.name;
      const reason = c.dir < 0 && front ? `Head-on with ${what}` : front ? `Hit by ${what}` : `Rear-ended ${what}`;
      player.crash(reason, {
        x: fx * c.v * 1.1 - Math.sign(lz) * fx * 2,
        z: fz * c.v * 1.1 - Math.sign(lz) * fz * 2,
      });
      events.push({ type: 'carHit', car: c });
      return;
    }
    if (Math.abs(lz) < hz + 0.5) c.minGap = Math.min(c.minGap, Math.abs(lx) - c.W / 2);
    if (c.lastLz !== null && Math.sign(lz) !== Math.sign(c.lastLz) && !c.passed) {
      c.passed = true;
      const rel = Math.abs(player.speed - c.v * c.dir);
      if (c.minGap < 1.3 && player.speed > 6) {
        events.push({ type: 'nearMiss', gap: c.minGap, rel });
      }
    }
    c.lastLz = lz;
    // Oncoming drivers lean on the horn if you're in their lane.
    if (!c.honked && c.dir < 0 && lz > 10 && lz < 45 && Math.abs(lx) < 1.6) {
      c.honked = true;
      events.push({ type: 'honk', car: c });
    }
  }
}

// Headlamp level for the page's sky: atmo from sky.js atmosphereFor() and
// its ENV (night 0..1, precip 0..1). Full at night, partly at dusk and dawn,
// dipped in rain, snow and thick mist.
export function carLights(atmo = {}, env = {}) {
  const dim = clamp((1.2 - (atmo.sunIntensity ?? 3)) / 1.0, 0, 1);
  const misty = (atmo.fogScale ?? 1) > 1.5 ? 0.15 : 0;
  return Math.max(env.night ?? 0, (env.precip ?? 0) * 0.4, dim, misty);
}
