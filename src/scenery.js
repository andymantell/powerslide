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
// Pieces that aren't a plan of their own, and the plan each is built on.
const NEEDS = { village: 'flat', farm: 'flat', yard: 'clearing', camp: 'flat', town: 'flat', hospice: 'flat', rockgallery: 'gallery', tors: 'flat' };

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
  // Kerbed streets of semis, bungalows and terraces with bins out, a brick
  // railway bridge, zebra crossings and a park pond.
  suburbs: {
    pieces: { street: 3, railbridge: 1, lake: 0.5 },
    gap: 0.6,
    verge: ['bench', 'tpole', 'busstop'],
    rows: [
      [['semi', 'semi_b', 'semi_c'], 16.2, 16],
      [['bungalow', 'bungalow_b'], 16.2, 15],
      [['terrace_b', 'terrace'], 13, 10.2],
    ],
    kerbside: [['bin_black', 4.55], ['bin_green', 4.55], ['bin_blue', 4.55], ['postbox', 4.9], ['busstop', 5.45], ['tpole', 6.3], ['oak', 14]],
    centre: [['shops', 22], ['church_hall', 22]],
    street: {},
  },
  // Logging country: a road through a giant redwood, an old timber trestle,
  // log bridges, firebreaks, burnt stretches, logging yards and cabins.
  forest: {
    pieces: { tunneltree: 1, trestle: 1, logbridge: 0.8, firebreak: 0.8, burnt: 0.6, yard: 0.8, camp: 0.8, lake: 0.6 },
    verge: ['sign_fire', 'sign_forestry', 'sign_forestry_b', 'picnic_table', 'bear_bin'],
    plants: ['stump', 'fallen_log', 'fallen_log_b', 'sapling', 'fireweed'],
    camp: ['log_cabin', 'log_cabin_b', 'ranger_hut', 'picnic_table', 'picnic_table', 'water_tower'],
  },
  // Desert roads: rock arches, slot canyons, a freight line alongside or
  // under the road, blowing sand and little Western towns.
  canyon: {
    pieces: { arch: 1, slot: 1, railway: 1, raildeck: 0.8, town: 0.8, dust: 0.6, lake: 0.4 },
    verge: ['viewpoint', 'rusty_pump', 'windmill', 'crossbuck'],
    plants: ['tumbleweed', 'boulder_red', 'boulder_red_b', 'sagebrush'],
    town: ['motel', 'diner', 'gas_station', 'saloon', 'store', 'trading_post'],
    townSmall: ['hitching_rail', 'wagon_wheel', 'pickup', 'pickup_b', 'water_tank_west'],
  },
  // Lit city streets of blocks, Victorian rows and neon, with trams,
  // strings of lights, an underpass and the docks.
  city: {
    pieces: { street: 3.5, underpass: 0.8, harbour: 0.6 },
    gap: 0.4,
    verge: ['busstop', 'hydrant'],
    rows: [
      [['block_a', 'block_b', 'block_c', 'block_d', 'block_e', 'block_f'], 20, 26],
      [['victorian_a', 'victorian_b', 'victorian_c', 'victorian_d', 'victorian_e', 'victorian_f'], 16.85, 15],
      [['neon_a', 'neon_b', 'neon_c', 'neon_d'], 15.5, 25],
    ],
    kerbside: [['hydrant', 4.6], ['busstop', 5.45], ['street_tree', 5.4]],
    towers: ['tower_a', 'tower_b', 'tower_c', 'tower_d', 'tower_e'],
    street: { style: 'city' },
    harbour: { near: 30, cranes: 3 },
  },
  // Clifftop farmland: field walls, sheep and gorse, wind turbines, and
  // fishing villages round a little harbour.
  coast: {
    pieces: { turbines: 1, harbour: 0.8, village: 0.8, farm: 1, walls: 0.8, lake: 0.4 },
    animals: ['sheep', 'sheep', 'sheep_dark'],
    plants: ['gorse', 'gorse_big', 'bracken'],
    verge: ['fingerpost', 'bench_sea', 'camper', 'sign_wind'],
    houses: ['fisher_a', 'fisher_b', 'fisher_c', 'fisher_d', 'fisher_e', 'fisher_f', 'fisher_g', 'fisher_h'],
    houseD: 11,
    centre: [['cafe', 26], ['phonebox', 7.5], ['ice_cream_van', 9]],
    farm: ['cottage', 'cottage_b', 'tractor'],
    fence: 'fieldwall',
    harbour: { near: 14, style: 'fishing', arm: 70 },
  },
  // The high pass: galleries blasted through the rock, snow cuttings,
  // meltwater across the road, rockfall and the hospice at the top.
  pass: {
    pieces: { rockgallery: 1, gallery: 0.6, snowwalls: 1, melt: 1, debris: 1, hospice: 0.6, lake: 0.6 },
    animals: ['ibex', 'ibex_b', 'marmot', 'marmot'],
    verge: ['shrine', 'panorama', 'sign_rockfall'],
    snowpoles: true,
    far: ['summitcross'],
    hospice: [['hospice', 26], ['chapel', 24], ['kennel', 14], ['souvenir_a', 10], ['souvenir_b', 10], ['stbernard', 9.5], ['pass_sign', 8.4]],
  },
  // Anything else: the plainer pieces only.
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
      // Props and building terraces go with the set pieces whose ground
      // they stood on (anything left would hang where the ground was).
      const q = {};
      const keep = (x, z) => road.field(x, z, q).index > s - BEHIND;
      this.props.prune(keep);
      const t = this.terrain;
      t.mods = t.mods.filter((m) => !m.pad || keep(m.pad[0], m.pad[1]));
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
        this.pieceFrom = this.pieceEnd + ((500 + rand() * 900) * (pal.gap ?? 1)) / this.rate;
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
    if (pal.animals && rand() < 0.4) entries.push({ scatter: pal.animals, from: at(a), to: at(b), near: 15, far: 70, count: 2 + Math.floor(rand() * 5) });
    if (pal.hay && rand() < 0.2) entries.push({ scatter: ['haybale'], from: at(a), to: at(b), near: 15, far: 80, count: 3 + Math.floor(rand() * 5) });
    if (pal.plants && rand() < 0.7) entries.push({ scatter: pal.plants, from: at(a), to: at(b), near: 7, far: 70, count: 6 + Math.floor(rand() * 10) });
    if (pal.far && rand() < 0.08) entries.push({ scatter: pal.far, from: at(a), to: at(b), near: 40, far: 90, count: 1 });
    if (pal.snowpoles && road.wildness(a) > 0.4 && rand() < 0.5) entries.push({ row: 'snowpole', from: at(a), to: at(b), d: 6.6, every: 22, both: true });

    dressRange(road, props, a, b, entries.filter((e) => [].concat(e.type || e.row || e.scatter || []).every((t) => PROP_TYPES[t])), rand);
    // Nothing on another stretch of road (the leg below a hairpin).
    const q = {};
    props.list = props.list.filter((p) => {
      const g = road.field(p.x, p.z, q);
      return g.dist > 8 + (PROP_TYPES[p.type].r || 0) || (g.index > a - 150 && g.index < a + 800);
    });
    props.shape();
    // Buildings' terraces last, so the next stretch's set pieces (whose
    // ground reaches back a little) can't lift or sink a house already level.
    const mods = this.terrain.mods;
    mods.splice(0, mods.length, ...mods.filter((m) => !m.pad), ...mods.filter((m) => m.pad));
    // Where two terraces overlap (a row of houses down a steep street, or
    // round the inside of a bend) the later one wins: settle each building
    // on the ground it ended up with, or leave it out if that's far off.
    props.list = props.list.filter((p) => {
      if (!p.padded) return true;
      const h = this.terrain.heightAt(p.x, p.z);
      if (Math.abs(h - p.y) > 1.5) return false;
      p.y = h;
      return true;
    });
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
    const types = Object.entries(pal.pieces).filter(([t]) => PLANS[NEEDS[t] ?? t] && (t !== 'tors' || pal.tors));
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
            entries.push({ type: pick(rand, pal.houses || ['farmhouse']), at: s - S, d: side * ((pal.houseD ?? 17) + rand() * 3) });
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
      case 'street': {
        // As far as the road stays fairly straight, and houses only on a
        // side with room for them.
        let len = 0;
        const want = 200 + rand() * 260;
        while (len < want && Math.abs(road.k[Math.round(s0 + len)]) < 1 / 60) len += 4;
        if (len < 120) return null;
        const sides = [-1, 1].filter((side) => clear(s0, s0 + len, side, 45));
        if (!sides.length) return null;
        done(s0 + len);
        return (feature, entries) => {
          const one = sides.length === 1 ? { side: sides[0] > 0 ? 'right' : 'left' } : {};
          feature({ type: 'street', from: s0 - S, to: s0 + len - S, ...pal.street, ...one });
          // Each side gets its own kind of house, leaving a gap for anything
          // in the middle.
          const mid = s0 + len / 2;
          const cs = sides[sides.length - 1];
          const centre = pal.centre && rand() < 0.5 ? pick(rand, pal.centre) : null;
          const gaps = centre ? [[mid - 22, mid + 22]] : [];
          for (const side of sides) {
            const [types, d, every] = pick(rand, pal.rows);
            const pieces = centre && side === cs ? [[s0 + 10, mid - 24], [mid + 24, s0 + len - 10]] : [[s0 + 10, s0 + len - 10]];
            for (const [from, to] of pieces) if (to - from > every) entries.push({ row: types, from: from - S, to: to - S, d: side * d, every, face: 'road' });
            for (const [type, kd] of pal.kerbside) {
              if (rand() < 0.5) continue;
              const s = s0 + 15 + rand() * (len - 30);
              if (!gaps.some(([g0, g1]) => s > g0 && s < g1)) entries.push({ type, at: s - S, d: side * kd, yaw: type.startsWith('bin') || type === 'postbox' ? 0 : 'along' });
            }
          }
          if (centre) entries.push({ type: centre[0], at: mid - S, d: cs * centre[1] });
          if (pal.towers) entries.push({ scatter: pal.towers, from: s0 - S, to: s0 + len - S, near: 70, far: 220, count: 2 + Math.floor(rand() * 3), face: 'road' });
          if (pal.street.style === 'city') {
            if (rand() < 0.4) feature({ type: 'tram', from: s0 + 20 - S, to: s0 + len - 20 - S });
            if (rand() < 0.4) feature({ type: 'lights', from: s0 + 40 - S, to: s0 + Math.min(len - 40, 240) - S, every: 7, style: rand() < 0.5 ? 'lanterns' : 'fairy' });
          } else if (rand() < 0.5 && straight(mid + 60, mid + 90, 1 / 300)) feature({ type: 'zebra', at: mid + 75 - S });
        };
      }
      case 'railbridge': {
        if (!straight(s0 - 40, s0 + 40, 1 / 100)) return null;
        done(s0 + 40);
        return (feature) => feature({ type: 'railbridge', at: s0 - S, span: 12, every: 16 + rand() * 10, phase: rand() * 10 });
      }
      case 'underpass': {
        const len = 160 + rand() * 120;
        if (!straight(s0 - 70, s0 + len + 70, 1 / 120)) return null;
        done(s0 + len + 60);
        return (feature) => feature({ type: 'underpass', from: s0 - S, to: s0 + len - S });
      }
      case 'harbour': {
        const h = pal.harbour;
        const len = h.style === 'fishing' ? 170 + rand() * 60 : 300 + rand() * 120;
        const side = rand() < 0.5 ? -1 : 1;
        if (!straight(s0 - 30, s0 + len + 30, 1 / 120) || !clear(s0 - 60, s0 + len + 60, side, 420)) return null;
        done(s0 + len + 40);
        return (feature, entries) => {
          feature({ type: 'harbour', from: s0 - S, to: s0 + len - S, side: side > 0 ? 'right' : 'left', ...h });
          // Cottages on the landward side of a fishing harbour.
          if (pal.houses) entries.push({ row: pal.houses, from: s0 + 10 - S, to: s0 + len - 10 - S, d: -side * (pal.houseD ?? 17), every: 14, face: 'road' });
        };
      }
      case 'tunneltree':
      case 'arch': {
        if (!straight(s0 - 30, s0 + 30, 1 / 160)) return null;
        done(s0 + 30);
        return (feature) => feature({ type, at: s0 - S, span: type === 'arch' ? 12 : 14 });
      }
      case 'trestle': {
        if (!straight(s0 - 30, s0 + 30, 1 / 80)) return null;
        done(s0 + 30);
        return (feature) => feature({ type: 'trestle', at: s0 - S, height: 13 + rand() * 4 });
      }
      case 'logbridge': {
        const len = 26 + rand() * 8;
        if (!straight(s0 - 15, s0 + len + 15, 1 / 100)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'logbridge', from: s0 - S, to: s0 + len - S });
      }
      case 'firebreak': {
        if (!straight(s0 - 20, s0 + 20, 1 / 60)) return null;
        done(s0 + 40);
        return (feature) => feature({ type: 'firebreak', at: s0 - S, width: 40 + rand() * 30 });
      }
      case 'burnt': {
        const len = 400 + rand() * 400;
        done(s0 + len);
        return (feature, entries) => {
          feature({ type: 'burnt', from: s0 - S, to: s0 + len - S, far: 240 });
          entries.push({ scatter: ['snag', 'snag_b', 'snag_c', 'stump_burnt'], from: s0 - S, to: s0 + len - S, near: 8, far: 200, count: 40 + Math.floor(rand() * 30) });
        };
      }
      case 'yard': {
        const len = 180 + rand() * 80;
        const side = rand() < 0.5 ? -1 : 1;
        if (!clear(s0, s0 + len, side, 90)) return null;
        done(s0 + len);
        return (feature, entries) => {
          feature({ type: 'flat', from: s0 - S, to: s0 + len - S, width: 70 });
          feature({ type: 'clearing', from: s0 - S, to: s0 + len - S, far: 65 });
          entries.push({ row: ['log_stack', 'log_stack_b', 'timber_stack', 'timber_stack_b'], from: s0 + 20 - S, to: s0 + len - 40 - S, d: side * 14, every: 22 });
          entries.push({ type: 'log_loader', at: s0 + len - 30 - S, d: side * 30, yaw: 'along' });
          entries.push({ type: pick(rand, ['logging_truck', 'logging_truck_b']), at: s0 + len / 2 - S, d: side * 26, yaw: 'along' });
          entries.push({ type: 'sign_trucks', at: s0 - 40 - S, d: (road.drive || 1) * 6.5 });
        };
      }
      case 'camp':
      case 'town':
      case 'hospice': {
        const len = 160 + rand() * 80;
        if (!straight(s0, s0 + len, 1 / 60) || !clear(s0, s0 + len, 1, 60) || !clear(s0, s0 + len, -1, 60)) return null;
        done(s0 + len);
        return (feature, entries) => {
          feature({ type: 'flat', from: s0 - S, to: s0 + len - S, width: 55 });
          if (type === 'hospice') {
            // The hospice at the top of the pass, with its chapel, dogs and stalls.
            const side = rand() < 0.5 ? -1 : 1;
            pal.hospice.forEach(([t, d], i) => entries.push({ type: t, at: s0 + 30 + i * 18 - S, d: (i % 2 ? -side : side) * d }));
            return;
          }
          const list = type === 'town' ? pal.town : pal.camp;
          let side = rand() < 0.5 ? -1 : 1;
          for (let s = s0 + 20; s < s0 + len - 20; s += 36 + rand() * 14) {
            const t = pick(rand, list);
            const r = PROP_TYPES[t]?.r ?? 5;
            entries.push({ type: t, at: s - S, d: side * (8 + r + rand() * 3) });
            side = -side;
          }
          if (pal.townSmall) entries.push({ scatter: pal.townSmall, from: s0 - S, to: s0 + len - S, near: 7, far: 14, count: 4 + Math.floor(rand() * 4), face: 'road' });
        };
      }
      case 'slot': {
        const len = 200 + rand() * 250;
        if (!straight(s0, s0 + len, 1 / 45)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'slot', from: s0 - S, to: s0 + len - S, height: 35 + rand() * 15 });
      }
      case 'railway': {
        const len = 600 + rand() * 300;
        const side = rand() < 0.5 ? -1 : 1;
        if (!straight(s0, s0 + len, 1 / 90) || !clear(s0, s0 + len + 200, side, 90)) return null;
        done(s0 + len + 100);
        return (feature) => feature({ type: 'railway', from: s0 - S, to: s0 + len - S, d: side * 26, every: 40 + rand() * 20, speed: 14 + rand() * 4, phase: rand() * 10 });
      }
      case 'raildeck': {
        if (!straight(s0 - 30, s0 + 30, 1 / 120) || !clear(s0 - 60, s0 + 60, 1, 150) || !clear(s0 - 60, s0 + 60, -1, 150)) return null;
        done(s0 + 40);
        return (feature) => feature({ type: 'raildeck', at: s0 - S, span: 18, angle: 60 + rand() * 30, every: 25 + rand() * 15 });
      }
      case 'dust': {
        done(s0 + 60);
        return (feature) => feature({ type: 'dust', at: s0 - S, wind: rand() < 0.5 ? 'left' : 'right' });
      }
      case 'turbines': {
        const len = 400 + rand() * 400;
        const side = rand() < 0.5 ? -1 : 1;
        if (!clear(s0, s0 + len, side, 150)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'turbines', from: s0 - S, to: s0 + len - S, side: side > 0 ? 'right' : 'left', d: 80, every: 120 + rand() * 30 });
      }
      case 'rockgallery': {
        const len = 130 + rand() * 80;
        if (!straight(s0, s0 + len, 1 / 35) || !mountain(s0, s0 + len)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'gallery', from: s0 - S, to: s0 + len - S, style: 'rock' });
      }
      case 'snowwalls': {
        const len = 180 + rand() * 320;
        done(s0 + len);
        return (feature) => feature({ type: 'snowwalls', from: s0 - S, to: s0 + len - S, height: 3.6 + rand() * 2 });
      }
      case 'melt': {
        if (!straight(s0 - 20, s0 + 20, 1 / 40) || !mountain(s0 - 20, s0 + 20)) return null;
        done(s0 + 20);
        return (feature) => feature({ type: 'melt', at: s0 - S, width: 2.5 + rand() * 1.5 });
      }
      case 'debris': {
        const len = 220 + rand() * 80;
        if (!mountain(s0, s0 + len)) return null;
        done(s0 + len);
        return (feature) => feature({ type: 'debris', from: s0 - S, to: s0 + len - S, nets: rand() < 0.7 });
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
