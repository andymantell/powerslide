// Endless scenery: the campaign's set pieces and roadside furniture (from
// structures.js, props.js and dressing.js), placed along the endless road as
// it is generated. The road is dressed a stretch at a time, far enough ahead
// that the terrain tiles and road mesh there aren't built yet, since bridges,
// lakes and villages reshape the ground. Everything comes from the road seed,
// so a shared road code gets the same scenery.
//
// Set pieces: stone viaducts over gorges, covered timber bridges, streams and
// waterfalls under little arch bridges, avalanche galleries, lakes, villages
// and farms. Furniture: bend chevrons and warning signs, shrines, benches,
// snow poles, fences, cows and hay bales. Each biome lists what suits it.

import { mulberry32 } from './noise.js';
import { SPAN_TYPES, START_S } from './road.js';
import { PLANS } from './structures.js';
import { PROP_TYPES } from './props.js';
import { dressRange } from './dressing.js';

const AHEAD = 2300; // dressed this far in front of the rider
const STRETCH = 300; // dressed this much at a time
const BEHIND = 700; // structures and props this far back are dropped

// pieces: set pieces and how often each comes. animals and plants are
// scattered in the fields; verge props stand by the road; houses line a
// village, with `centre` props in the middle of it; fence runs along farms.
const PALETTES = {
  alpine: {
    pieces: { bridge: 1, covered: 1, stream: 1.3, gallery: 1, lake: 0.8, village: 0.7, farm: 1 },
    animals: ['cow', 'cow_pied', 'cow_dun'],
    hay: true,
    verge: ['shrine', 'bench', 'shrine'],
    snowpoles: true,
    houses: ['chalet', 'chalet_small', 'chalet_tall'],
    centre: [['church', 28], ['fountain', 11.5], ['bench', 8.4]],
    farm: ['farmhouse', 'barn', 'churns'],
    fence: 'fence',
  },
  // Narrow lanes between stone walls and hedge banks, cattle grids, tors,
  // ponies and sheep on the open moor.
  dartmoor: {
    pieces: { walls: 1.4, hedge: 1, grid: 0.8, stream: 1, village: 0.6, farm: 0.8, tors: 1 },
    animals: ['pony', 'pony_dark', 'pony_grey', 'sheep', 'sheep', 'sheep_dark'],
    plants: ['gorse', 'gorse_big', 'bracken', 'bracken', 'hawthorn'],
    verge: ['fingerpost', 'sign_pony', 'whitepost'],
    houses: ['cottage', 'cottage_b', 'cottage_slate'],
    centre: [['church_uk', 28], ['inn', 20], ['phonebox', 7.5]],
    farm: ['cottage', 'ruin_a', 'tractor'],
    fence: 'fieldwall',
    tors: ['tor_big', 'tor', 'tor_small'],
  },
  // Biomes without their own list yet: the plainer pieces only.
  other: {
    pieces: { stream: 1, farm: 1 },
    animals: ['cow', 'cow_dun'],
    verge: ['bench'],
    farm: ['farmhouse', 'barn'],
    fence: 'fence',
  },
};

export class Scenery {
  constructor(road, terrain, props, structures) {
    this.road = road;
    this.terrain = terrain;
    this.props = props;
    this.structures = structures;
    this.on = false;
  }

  // biome: the biome's id. rate: how often set pieces come (1 = normal).
  reset(seed, biome, rate = 1) {
    this.on = true;
    this.rand = mulberry32(seed + 9091);
    this.palette = PALETTES[biome] || PALETTES.other;
    this.rate = rate;
    this.next = START_S - 300;
    this.pieceFrom = START_S + 250 + this.rand() * 400; // no set piece before this
    this.pruneAt = 0;
  }

  clear() {
    this.on = false;
  }

  // Dresses the road ahead of s and tidies up behind it. Returns true if
  // anything new went in.
  update(s) {
    if (!this.on) return false;
    let added = false;
    while (this.next < s + AHEAD) {
      this.dress(this.next, this.next + STRETCH);
      this.next += STRETCH;
      added = true;
    }
    if (s > this.pruneAt) {
      this.pruneAt = s + 400;
      this.structures.prune(s, BEHIND);
      const road = this.road;
      road.spans = road.spans.filter((sp) => sp.s1 > s - BEHIND);
      const f = road.sample(s, {});
      this.props.prune(f.x, f.z, 2500);
    }
    return added;
  }

  dress(a, b) {
    const road = this.road;
    const rand = this.rand;
    const S = road.start;
    const props = this.props;
    const pal = this.palette;
    props.begin();
    const entries = [];
    const jobs = [];
    const feature = (f) => {
      if (!PLANS[f.type]) return;
      if (SPAN_TYPES[f.type]) {
        const half = (f.span ?? 18) / 2;
        const [s0, s1] = f.from !== undefined ? [f.from, f.to] : [f.at - half, f.at + half];
        const side = f.side === 'left' ? -1 : f.side === 'right' ? 1 : 0;
        road.spans.push({ type: f.type, s0: S + s0, s1: S + s1, side, f });
      }
      const job = this.structures.add(f);
      if (job) jobs.push(job);
    };

    // A set piece now and then.
    if (a >= this.pieceFrom && this.rate > 0) {
      const piece = this.pickPiece(a, b);
      if (piece) {
        piece(feature, entries);
        this.pieceFrom = this.pieceEnd + (500 + rand() * 900) / this.rate;
      }
    }

    // Furniture: something by the road, animals (and hay or gorse) in the
    // fields, and snow poles along the higher stretches.
    const at = (s) => s - S;
    if (rand() < 0.35) {
      const s = a + rand() * STRETCH;
      const side = rand() < 0.6 ? road.drive || 1 : -(road.drive || 1);
      if (road.barrierAt(s, side) === null && !road.spanAt(s)) entries.push({ type: pick(rand, pal.verge), at: at(s), d: side * 7.2 });
    }
    if (rand() < 0.4) entries.push({ scatter: pal.animals, from: at(a), to: at(b), near: 15, far: 70, count: 2 + Math.floor(rand() * 5) });
    if (pal.hay && rand() < 0.2) entries.push({ scatter: ['haybale'], from: at(a), to: at(b), near: 15, far: 80, count: 3 + Math.floor(rand() * 5) });
    if (pal.plants && rand() < 0.7) entries.push({ scatter: pal.plants, from: at(a), to: at(b), near: 7, far: 70, count: 6 + Math.floor(rand() * 10) });
    if (pal.snowpoles && road.wildness(a) > 0.4 && rand() < 0.5) entries.push({ row: 'snowpole', from: at(a), to: at(b), d: 6.6, every: 22, both: true });

    dressRange(road, props, a, b, entries.filter((e) => [].concat(e.type || e.row || e.scatter || []).every((t) => PROP_TYPES[t])), rand);
    // Nothing on another stretch of road (the leg below a hairpin).
    const q = {};
    props.list = props.list.filter((p) => {
      const g = road.field(p.x, p.z, q);
      return g.dist > 8 + (PROP_TYPES[p.type].r || 0) || (g.index > a - 150 && g.index < a + 800);
    });
    props.shape();
    for (const job of jobs) this.structures.buildJob(job);
    props.finish(true);
  }

  // Chooses a set piece that fits the road just ahead of a, or null. Each
  // returns a function that adds its features and props.
  pickPiece(a, b) {
    const road = this.road;
    const rand = this.rand;
    const S = road.start;
    const pal = this.palette;
    const types = Object.entries(pal.pieces).filter(([t]) => (t === 'village' || t === 'farm' ? PLANS.flat : t === 'tors' ? pal.tors : PLANS[t]));
    let total = 0;
    for (const [, w] of types) total += w;
    let r = rand() * total;
    let type = types[0]?.[0];
    for (const [t, w] of types) {
      if ((r -= w) <= 0) {
        type = t;
        break;
      }
    }
    if (!type) return null;
    const s0 = a + rand() * (b - a) * 0.5;
    const straight = (from, to, k) => {
      for (let s = from; s <= to; s += 4) if (Math.abs(road.k[Math.round(s)]) > k) return false;
      return true;
    };
    const mountain = (from, to) => {
      let c = 0, n = 0;
      for (let s = from; s <= to; s += 5, n++) c += road.c[Math.round(s)];
      return Math.abs(c / n) > 0.4;
    };
    // Open ground on one side: no other stretch of road within `far` m.
    const clear = (from, to, side, far) => {
      const f = {}, q = {};
      for (let s = from; s <= to; s += 30) {
        road.sample(s, f);
        for (let d = 30; d <= far; d += 30) {
          const g = road.field(f.x + f.rightX * d * side, f.z + f.rightZ * d * side, q);
          if (g.dist < d * 0.6 && Math.abs(g.index - s) > 80) return false;
        }
      }
      return true;
    };
    const valley = (from, to) => {
      let c = 0;
      for (let s = from; s <= to; s += 5) c += road.c[Math.round(s)];
      return c >= 0 ? -1 : 1;
    };
    const done = (end) => {
      this.pieceEnd = end;
    };

    switch (type) {
      case 'bridge': {
        const len = 70 + rand() * 70;
        if (!straight(s0 - 10, s0 + len + 10, 1 / 70)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'bridge', from: s0 - S, to: s0 + len - S, depth: 18 + rand() * 16 });
      }
      case 'covered': {
        const len = 26 + rand() * 6;
        if (!straight(s0 - 15, s0 + len + 15, 1 / 90)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'covered', from: s0 - S, to: s0 + len - S });
      }
      case 'stream': {
        if (!straight(s0 - 15, s0 + 15, 1 / 45)) return null;
        done(s0 + 10);
        const fall = mountain(s0 - 30, s0 + 30) && rand() < 0.6;
        return (feature) => feature({ type: 'stream', at: s0 - S, fall });
      }
      case 'gallery': {
        const len = 90 + rand() * 70;
        if (!straight(s0, s0 + len, 1 / 35) || !mountain(s0, s0 + len)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'gallery', from: s0 - S, to: s0 + len - S });
      }
      case 'lake': {
        const len = 260 + rand() * 200;
        const side = valley(s0, s0 + len);
        if (!clear(s0, s0 + len, side, 240)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'lake', from: s0 - S, to: s0 + len - S, side: side > 0 ? 'right' : 'left' });
      }
      case 'village': {
        const len = 220 + rand() * 120;
        if (!clear(s0, s0 + len, 1, 60) || !clear(s0, s0 + len, -1, 60)) return null;
        done(s0 + len);
        return (feature, entries) => {
          feature({ type: 'flat', from: s0 - S, to: s0 + len - S, width: 60 });
          let side = rand() < 0.5 ? -1 : 1;
          for (let s = s0 + 15; s < s0 + len - 15; s += 32 + rand() * 18) {
            entries.push({ type: pick(rand, pal.houses || ['farmhouse']), at: s - S, d: side * (17 + rand() * 3) });
            side = -side;
          }
          const mid = s0 + len / 2;
          (pal.centre || []).forEach(([type, d], i) => {
            entries.push({ type, at: mid + i * 16 - S, d: (i % 2 ? 1 : -1) * d });
          });
        };
      }
      case 'farm': {
        const len = 260 + rand() * 200;
        const side = rand() < 0.5 ? -1 : 1;
        if (!clear(s0, s0 + len, side, 90) || !clear(s0, s0 + len, -side, 30)) return null;
        done(s0 + len);
        return (feature, entries) => {
          feature({ type: 'flat', from: s0 - S, to: s0 + len - S, width: 70 });
          const fence = pal.fence === 'fieldwall' ? { d: 26, every: 4 } : { d: 8.8, every: 3 };
          entries.push({ row: pal.fence, from: s0 + 10 - S, to: s0 + len - 10 - S, d: fence.d, every: fence.every, both: true });
          const mid = s0 + len * (0.3 + rand() * 0.4);
          const [house, barn, small] = pal.farm;
          entries.push({ type: house, at: mid - S, d: side * 44 });
          if (barn) entries.push({ type: barn, at: mid + 45 - S, d: side * 40 });
          if (small) entries.push({ type: small, at: mid - 15 - S, d: side * 12, yaw: 'along' });
          entries.push({ scatter: pal.animals, from: s0 + 20 - S, to: s0 + len - 20 - S, near: 13, far: 70, count: 10 + Math.floor(rand() * 10) });
        };
      }
      case 'walls':
      case 'hedge': {
        const len = 150 + rand() * 250;
        done(s0 + len);
        const r = rand();
        const side = r < 0.6 ? undefined : r < 0.8 ? 'left' : 'right';
        return (feature) => feature({ type, from: s0 - S, to: s0 + len - S, ...(side ? { side } : {}) });
      }
      case 'grid': {
        if (!straight(s0 - 25, s0 + 25, 1 / 150)) return null;
        done(s0 + 60);
        // Walls run up to the grid on both sides, as on the moor's edge.
        return (feature) => {
          feature({ type: 'walls', from: s0 - 70 - S, to: s0 - 7 - S });
          feature({ type: 'grid', at: s0 - S });
          feature({ type: 'walls', from: s0 + 7 - S, to: s0 + 60 - S });
        };
      }
      case 'tors': {
        done(s0 + 300);
        return (feature, entries) => {
          const side = rand() < 0.5 ? -1 : 1;
          entries.push({ type: pal.tors[0], at: s0 + 120 - S, d: side * (70 + rand() * 50), scale: 1 + rand() * 0.7 });
          entries.push({ scatter: pal.tors.slice(1), from: s0 - S, to: s0 + 300 - S, near: 25, far: 120, count: 3 + Math.floor(rand() * 4) });
        };
      }
    }
    return null;
  }
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}
