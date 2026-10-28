// Procedural mountain road. The centreline is sampled every DS metres and grows
// on demand. Heading is measured from -Z (the overall downhill direction) and is
// kept within +/-MAX_HEADING so the road never doubles back on itself; that keeps
// sample z strictly decreasing, which lets terrain do fast nearest-road lookups.
//
// A level (see src/levels/) replaces the random segment and grade rolls with
// its own list of pieces. The road then runs on as a straight run-out past the
// finish before going back to random rolls, so there is always road ahead.

import { createNoise2D, mulberry32, clamp, smoothstep } from './noise.js';

export const DS = 1; // metres between centreline samples
// Road widths. A biome may narrow them (setRoadWidth) once at start-up, before
// anything reads them.
export let LANE_WIDTH = 3.5;
export let HALF_WIDTH = 4.25; // asphalt half width (two lanes + thin shoulder)
export let GRAVEL_EDGE = 6.2; // where the gravel shoulder ends
export let RAIL_OFFSET = 4.9; // guardrail lateral offset

// Sets the lane width; the asphalt, verge and guardrail follow it.
export function setRoadWidth(lane = 3.5) {
  LANE_WIDTH = lane;
  HALF_WIDTH = lane + 0.75;
  GRAVEL_EDGE = HALF_WIDTH + 1.95;
  RAIL_OFFSET = HALF_WIDTH + 0.65;
}
export const MAX_HEADING = 1.15; // ~66 degrees
export const START_S = 400; // where a run starts; the road behind is the approach
const RUNOUT = 600; // straight past a level's finish
export const RAIL_THRESHOLD = 0.3; // |cliff| above this gets a guardrail on the valley side

// Which side gets a guardrail for a cliff value: the valley side (-1 left,
// +1 right), or 0 for none.
export function railSide(cliff) {
  if (cliff > RAIL_THRESHOLD) return -1; // mountain right -> drop on the left
  if (cliff < -RAIL_THRESHOLD) return 1;
  return 0;
}

// Feature types that are structures carrying or covering the road; each
// replaces the guardrail and verge along its stretch (see src/structures.js).
export const SPAN_TYPES = { bridge: 'parapet', covered: 'wall', gallery: 'wall', stream: 'parapet', walls: 'wall', hedge: 'hedge bank', street: 'kerb', railbridge: 'bridge', tunneltree: 'giant redwood', logbridge: 'log rail', arch: 'rock arch', slot: 'canyon wall', dam: 'parapet', raildeck: 'parapet' };
// Of those, the ones that stand on the ground beside the road (on one side
// with "side": "left" or "right") rather than carry it.
export const GROUND_SPANS = new Set(['walls', 'hedge', 'street', 'railbridge', 'slot']);

export class Road {
  constructor(seed = 1337, level = null) {
    this.reset(seed, level);
  }

  // shape (endless mode, see src/endless.js) scales the random rolls: steep
  // multiplies the grade, corners how often bends come (0 = all straights,
  // 2 = no straights), sharp how tight they are (0 = sweepers only, 2 = tight
  // bends and hairpins) and grit how often grit washes onto the road. With
  // wilder set, the road gets steeper and twistier the further it goes.
  reset(seed = 1337, level = null, shape = {}) {
    this.shape = { steep: 1, corners: 1, sharp: 1, grit: 1, wilder: false, ...shape };
    this.rand = mulberry32(seed);
    this.noise = createNoise2D(seed + 7);
    if (!this.x) {
      this.cap = 1 << 16;
      for (const key of ['x', 'y', 'z', 'h', 'k', 'g', 'c']) this[key] = new Float64Array(this.cap);
    }
    // x, y, z: position. h: heading. k: curvature (1/m), + = turning right.
    // g: grade, + = downhill. c: cliff side, + = mountain on the right.
    this.count = 0;
    // Patches of gravel/sand washed onto the asphalt, sorted by s.
    this.patches = [];
    // Bridges, galleries and other structures along the road: { type, s0, s1, f }.
    this.spans = [];
    this.level = level;
    this.start = START_S;
    this.finish = null;
    this.checkpoints = [];
    this.queue = null;
    this.headingOver = 0; // furthest |heading| past MAX_HEADING, for the level checker
    // Which side traffic keeps to: 1 right, -1 left, and whether drops get
    // guardrails (main.js sets both per biome).
    this.drive = 1;
    this.rails = true;

    const grade = level ? level.pieces.find((p) => p.grade !== undefined)?.grade ?? 0.06 : 0.06 * this.shape.steep;
    this.state = {
      x: 0, y: 0, z: 0, heading: 0, kappa: 0, kappaTarget: 0, segLeft: 120,
      grade, gradeTarget: level ? grade : 0.07 * this.shape.steep, gradeLeft: 200, gradeRate: 0.0004,
    };
    if (level) {
      let len = 0;
      for (const p of level.pieces) len += pieceLength(p);
      this.finish = this.start + len;
      this.checkpoints = (level.checkpoints || []).map((at) => this.start + at);
      this.queue = [{ straight: this.start }, ...level.pieces, { straight: RUNOUT, grade: 0.02 }];
      for (const f of level.features || []) {
        if (f.type === 'grit') {
          this.patches.push({ s: this.start + f.at, d: f.d ?? 0, len: f.len ?? 6, width: f.width ?? 1.5 });
        } else if (SPAN_TYPES[f.type]) {
          const [a, b] = spanRange(f);
          const side = f.side === 'left' ? -1 : f.side === 'right' ? 1 : 0;
          this.spans.push({ type: f.type, s0: this.start + a, s1: this.start + b, side, f });
        }
      }
      this.patches.sort((a, b) => a.s - b.s);
      this.pickSegment();
    }
    this.push();
  }

  grow() {
    for (const key of ['x', 'y', 'z', 'h', 'k', 'g', 'c']) {
      const a = new Float64Array(this.cap * 2);
      a.set(this[key]);
      this[key] = a;
    }
    this.cap *= 2;
  }

  push() {
    if (this.count >= this.cap) this.grow();
    const s = this.state;
    const i = this.count++;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.z[i] = s.z;
    this.h[i] = s.heading;
    this.k[i] = s.kappa;
    this.g[i] = s.grade;
    const n = this.noise(i * DS / 700, 3.3) * 1.4 + this.noise(i * DS / 230, 9.1) * 0.35;
    this.c[i] = clamp(n, -1, 1);
  }

  pickSegment() {
    const s = this.state;
    if (this.queue) {
      const p = this.queue.shift();
      if (!this.queue.length) this.queue = null;
      s.kappaTarget = p.bend ? (p.bend === 'right' ? 1 : -1) / p.radius : 0;
      s.segLeft = pieceLength(p);
      if (p.grade !== undefined) s.gradeTarget = p.grade;
      // The grade eases in at 0.04% per metre, or within `ramp` metres.
      s.gradeRate = p.grade !== undefined && p.ramp ? Math.max(0.0004, Math.abs(p.grade - s.grade) / p.ramp) : 0.0004;
      // Hold this grade until the queue runs out.
      s.gradeLeft = Infinity;
      return;
    }
    if (s.gradeLeft === Infinity) s.gradeLeft = 0;
    s.gradeRate = 0.0004;
    const { corners, sharp } = this.shapeHere();
    // Chances of a straight, big sweeper and tight bend (the rest are
    // near-hairpins): 0.14, 0.44, 0.28, 0.14 with the default shape.
    const pStraight = corners <= 1 ? 1 - 0.86 * corners : 0.14 * (2 - corners);
    const wBig = 0.44 * (2 - sharp), wTight = 0.28, wHair = 0.14 * sharp;
    const bendScale = (1 - pStraight) / (wBig + wTight + wHair);
    const pBig = pStraight + wBig * bendScale;
    const pTight = pBig + wTight * bendScale;
    const r = this.rand();
    let radius = Infinity;
    let len;
    if (r < pStraight) {
      len = (50 + this.rand() * 130) * (corners > 1 ? 1 / corners : 1);
    } else if (r < pBig) {
      radius = 90 + this.rand() * 230; // big sweepers
      len = 90 + this.rand() * 200;
    } else if (r < pTight) {
      radius = 32 + this.rand() * 35; // tight bends
      len = 40 + this.rand() * 70;
    } else {
      radius = 17 + this.rand() * 12; // near-hairpins: slide or bail
      len = 30 + this.rand() * 40;
    }
    let sign = this.rand() < 0.5 ? -1 : 1;
    // Steer back towards the mean direction when the road wanders.
    if (Math.abs(s.heading) > 0.35 && this.rand() < 0.5 + Math.abs(s.heading) * 0.5) {
      sign = -Math.sign(s.heading);
    }
    let kappa = radius === Infinity ? 0 : sign / radius;
    if (kappa !== 0) {
      // Limit the turn so the final heading stays within range.
      const room = sign > 0 ? MAX_HEADING - s.heading : MAX_HEADING + s.heading;
      len = Math.min(len, Math.max(20, (room / Math.abs(kappa)) * 0.85));
    }
    s.kappaTarget = kappa;
    s.segLeft = len;
  }

  step() {
    const s = this.state;
    s.segLeft -= DS;
    if (s.segLeft <= 0) this.pickSegment();
    s.gradeLeft -= DS;
    if (s.gradeLeft <= 0) {
      s.gradeTarget = Math.min(0.3, (0.05 + this.rand() * 0.09) * this.shapeHere().steep);
      s.gradeLeft = 150 + this.rand() * 300;
    }
    // Clothoid-style transition: curvature changes linearly with distance.
    let target = s.kappaTarget;
    if (Math.abs(s.heading) > MAX_HEADING) {
      target = -Math.sign(s.heading) / 120;
      if (this.queue) this.headingOver = Math.max(this.headingOver, Math.abs(s.heading) - MAX_HEADING);
    }
    const dk = 0.0016 * DS;
    s.kappa += clamp(target - s.kappa, -dk, dk);
    s.grade += clamp(s.gradeTarget - s.grade, -s.gradeRate * DS, s.gradeRate * DS);

    s.heading += s.kappa * DS;
    s.x += Math.sin(s.heading) * DS;
    s.z -= Math.cos(s.heading) * DS;
    s.y -= s.grade * DS;
    this.push();
    // Grit collects on the inside of tight bends more than on straights.
    // Levels place their own grit.
    const chance = Math.abs(s.kappa) > 1 / 70 ? 0.006 : 0.0007;
    if (!this.level && this.count > 500 && this.rand() < chance * this.shape.grit * DS) {
      const inside = Math.sign(s.kappa) || (this.rand() < 0.5 ? -1 : 1);
      this.patches.push({
        s: (this.count - 1) * DS,
        d: inside * (0.5 + this.rand() * 3.2),
        len: 3 + this.rand() * 7,
        width: 0.8 + this.rand() * 1.6,
      });
    }
  }

  // 0..1: how far the wilder ramp has got here, full after 12 km.
  wildness(s = this.count * DS) {
    return this.shape.wilder ? Math.min(1, Math.max(0, (s - START_S) / 12000)) : 0;
  }

  // The shape at the end of the road so far, with the wilder ramp applied.
  shapeHere() {
    const w = this.wildness();
    const { steep, corners, sharp } = this.shape;
    if (!w) return this.shape;
    return {
      steep: steep * (1 + 0.45 * w),
      corners: Math.min(2, corners + 0.7 * w),
      sharp: Math.min(2, sharp + 0.8 * w),
    };
  }

  // The bridge or gallery at s, if any.
  spanAt(s) {
    for (const sp of this.spans) if (s >= sp.s0 && s <= sp.s1) return sp;
    return null;
  }

  // The guardrail side drawn at sample i (structures bring their own walls).
  railAt(i) {
    if (!this.rails) return 0;
    return this.spans.length && this.spanAt(i * DS) ? 0 : railSide(this.c[i]);
  }

  // What stops you running off the road at s on a side (-1 left, +1 right):
  // 'guardrail', a structure's 'wall' or 'parapet', or null for open verge.
  barrierAt(s, side) {
    const sp = this.spans.length ? this.spanAt(s) : null;
    if (sp) return !sp.side || sp.side === side ? SPAN_TYPES[sp.type] : null;
    if (!this.rails) return null;
    return railSide(this.c[clamp(Math.round(s / DS), 0, this.count - 1)]) === side ? 'guardrail' : null;
  }

  // 0..1 amount of grit under the wheels at (s, d).
  dirtAt(s, d) {
    const P = this.patches;
    let lo = 0;
    let hi = P.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (P[mid].s < s - 8) lo = mid + 1;
      else hi = mid;
    }
    let amount = 0;
    for (let i = lo; i < P.length && P[i].s < s + 8; i++) {
      const p = P[i];
      const u = (s - p.s) / (p.len / 2);
      const v = (d - p.d) / (p.width / 2);
      const r = u * u + v * v;
      if (r < 1) amount = Math.max(amount, 1 - r * r);
    }
    return amount;
  }

  ensure(distance) {
    const need = Math.ceil(distance / DS) + 2;
    while (this.count < need) this.step();
  }

  get length() {
    return (this.count - 1) * DS;
  }

  // Interpolated frame at distance s along the road.
  sample(s, out = {}) {
    let f = s / DS;
    f = clamp(f, 0, this.count - 1.0001);
    const i = Math.floor(f);
    const t = f - i;
    const j = i + 1;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
    out.heading = this.h[i] + (this.h[j] - this.h[i]) * t;
    out.kappa = this.k[i] + (this.k[j] - this.k[i]) * t;
    out.grade = this.g[i] + (this.g[j] - this.g[i]) * t;
    out.cliff = this.c[i] + (this.c[j] - this.c[i]) * t;
    out.dirX = Math.sin(out.heading);
    out.dirZ = -Math.cos(out.heading);
    out.rightX = -out.dirZ;
    out.rightZ = out.dirX;
    return out;
  }

  // Project a world XZ point onto the road near a hint distance.
  // Returns s (distance along) and d (signed lateral offset, + = right).
  project(px, pz, hintS, out = {}) {
    const hint = clamp(Math.round(hintS / DS), 0, this.count - 2);
    let best = Infinity;
    let bestI = hint;
    for (let i = Math.max(0, hint - 40); i <= Math.min(this.count - 2, hint + 40); i++) {
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bestI = i;
      }
    }
    // Refine on the segment either side of the closest sample.
    let bestS = bestI * DS;
    let bestD2 = Infinity;
    for (let i = Math.max(0, bestI - 1); i <= Math.min(this.count - 2, bestI); i++) {
      const ax = this.x[i], az = this.z[i];
      const bx = this.x[i + 1], bz = this.z[i + 1];
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez;
      const t = clamp(((px - ax) * ex + (pz - az) * ez) / len2, 0, 1);
      const qx = ax + ex * t - px, qz = az + ez * t - pz;
      const d2 = qx * qx + qz * qz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = (i + t) * DS;
      }
    }
    const f = this.sample(bestS, out);
    out.s = bestS;
    out.d = (px - f.x) * f.rightX + (pz - f.z) * f.rightZ;
    return out;
  }

  // First index whose z is <= z (z decreases with index).
  indexForZ(z) {
    let lo = 0;
    let hi = this.count - 1;
    if (z >= this.z[0]) return 0;
    if (z <= this.z[hi]) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.z[mid] > z) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // Smooth "road field" used by terrain: distance to road, signed side,
  // a softly averaged road height and cliff side. Smooth averaging avoids
  // height steps where two parts of the road are equally close.
  field(px, pz, out) {
    const X = this.x, Z = this.z, Y = this.y, C = this.c;
    const n = this.count;
    const z0 = this.indexForZ(pz);
    // Pass 1: expand outwards from the sample with matching z. Because z is
    // monotonic, once |dz| exceeds the best distance nothing further can win.
    let minD2 = Infinity;
    let minI = z0;
    const stride = 2;
    for (let i = z0; i < n; i += stride) {
      const dz = pz - Z[i];
      if (dz * dz > minD2) break;
      const dx = px - X[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) { minD2 = d2; minI = i; }
    }
    for (let i = z0 - 1; i >= 0; i -= stride) {
      const dz = pz - Z[i];
      if (dz * dz > minD2) break;
      const dx = px - X[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) { minD2 = d2; minI = i; }
    }
    for (let i = Math.max(0, minI - stride); i <= Math.min(n - 1, minI + stride); i++) {
      const dx = px - X[i];
      const dz = pz - Z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) { minD2 = d2; minI = i; }
    }
    const minD = Math.sqrt(minD2);
    // Pass 2: soft-min weighted average of height & cliff side over the
    // samples that are nearly as close as the closest one.
    const sigma = 6 + minD * 0.3;
    const cutoff = Math.min(minD + sigma * 3.5, minD + 350);
    const cutoff2 = cutoff * cutoff;
    const lo = this.indexForZ(pz + cutoff);
    const hi = this.indexForZ(pz - cutoff);
    const stride2 = minD < 50 ? 1 : minD < 200 ? 3 : 8;
    let wSum = 0, hSum = 0, cSum = 0;
    for (let i = lo; i <= hi; i += stride2) {
      const dx = px - X[i];
      const dz = pz - Z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 > cutoff2) continue;
      const w = Math.exp(-(Math.sqrt(d2) - minD) / sigma);
      wSum += w;
      hSum += w * Y[i];
      cSum += w * C[i];
    }
    const hx = Math.sin(this.h[minI]);
    const hz = -Math.cos(this.h[minI]);
    const side = (px - X[minI]) * -hz + (pz - Z[minI]) * hx;
    // Precise lateral distance near the road for clean shoulders.
    let dist = minD;
    if (minD < 40 && minI > 0 && minI < n - 2) {
      const p = this.project(px, pz, minI * DS, this._tmp || (this._tmp = {}));
      dist = Math.abs(p.d);
    }
    out.dist = dist;
    out.side = side >= 0 ? 1 : -1;
    out.roadY = wSum > 0 ? hSum / wSum : Y[minI];
    out.cliff = wSum > 0 ? cSum / wSum : C[minI];
    out.index = minI;
    // Fade near the centreline so the uphill side changes smoothly across it.
    out.uphill = out.cliff * out.side * smoothstep(0, 4, dist);
    return out;
  }
}

// A structure feature's stretch, in metres from the start: from/to, or a
// short span centred on `at` (a stream's bridge).
export function spanRange(f) {
  if (f.from !== undefined) return [f.from, f.to];
  const half = (f.span ?? 18) / 2;
  return [f.at - half, f.at + half];
}

export function pieceLength(p) {
  return p.straight ?? p.length;
}
