// Endless-only things by the road (the campaign levels never have these):
//
// - Roadworks: a stretch where the road is being resurfaced. Cones close off
//   the edge of the road, so the line through the bends gets tighter, and
//   fresh loose chippings lie on the asphalt. Clip a cone and it goes flying.
//   Getting through without touching one scores a bonus.
// - Speed signs: the flashing "YOUR SPEED" radar signs you see on real roads.
//   They read out how fast you are going, and the faster you pass, the more
//   points you get.
//
// Both are placed from the road seed as the rider goes, so a shared road code
// gets the same ones.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { HALF_WIDTH, START_S } from './road.js';

const AHEAD = 2000; // past the road mesh's reach, so chippings are in its grit
const BEHIND = 80;
const MAX_CONES = 160;
const CONE_GAP = 6; // m between cones along a closure
const CONE_LINE = 3.15; // |d| of the cones; the lanes stay clear (cars are 1.8 m wide)
const CONE_R = 0.2; // cone base radius, for hits
const SIGN_D = 5.4; // speed signs stand just off the right-hand verge

const _f = {};
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function coneGeometry() {
  // A traffic cone: square black base, orange body with two white reflective
  // bands. Each band is its own ring of faces, so the colours stay sharp.
  const base = new THREE.BoxGeometry(0.42, 0.04, 0.42);
  base.translate(0, 0.02, 0);
  const black = new THREE.Color('#1b1b1b');
  const orange = new THREE.Color('#ff5a12');
  const white = new THREE.Color('#f2f2f2');
  const r = (y) => 0.17 + ((0.035 - 0.17) * (y - 0.04)) / 0.62;
  const bands = [[0.04, 0.3, orange], [0.3, 0.41, white], [0.41, 0.47, orange], [0.47, 0.56, white], [0.56, 0.66, orange]];
  const parts = [[base, black]];
  for (const [y0, y1, c] of bands) {
    const g = new THREE.CylinderGeometry(r(y1), r(y0), y1 - y0, 16, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    parts.push([g, c]);
  }
  // Merge by hand, with a colour per vertex.
  const flat = parts.map(([g, c]) => [g.toNonIndexed(), c]);
  const count = flat.reduce((n, [g]) => n + g.attributes.position.count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  let o = 0;
  for (const [g, c] of flat) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) color.set([c.r, c.g, c.b], (o + i) * 3);
    o += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return merged;
}

// Canvas for a sign face. Returns { canvas, ctx, tex }.
function face(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, tex };
}

// A red-bordered warning triangle with a digger, as on the approach to works.
function worksTexture() {
  const { ctx, tex } = face(128, 128);
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(124, 116);
  ctx.lineTo(4, 116);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#d0021b';
  ctx.lineJoin = 'round';
  ctx.stroke();
  // A workman with a shovel, very roughly.
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(60, 52, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(52, 61, 12, 24);
  ctx.fillRect(48, 85, 8, 18);
  ctx.fillRect(60, 85, 8, 18);
  ctx.fillRect(64, 66, 20, 5);
  ctx.beginPath();
  ctx.moveTo(84, 66);
  ctx.lineTo(96, 100);
  ctx.lineTo(90, 102);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(70, 98, 30, 6);
  return tex;
}

export class Extras {
  constructor(scene, road) {
    this.scene = scene;
    this.road = road;
    this.cones = new THREE.InstancedMesh(coneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), MAX_CONES);
    this.cones.castShadow = true;
    this.cones.frustumCulled = false;
    this.cones.count = 0;
    scene.add(this.cones);
    this.postGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8);
    this.postGeo.translate(0, 1.45, 0);
    this.postMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.7, roughness: 0.5 });
    this.worksMat = new THREE.MeshStandardMaterial({ map: worksTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
    this.zones = [];
    this.signs = [];
    this.props = []; // posts and sign boards, removed as they fall behind
    this.on = false;
  }

  // opts: works 0..2 (how often roadworks come) and radar (speed signs on).
  reset(seed, opts = {}) {
    this.clear();
    this.on = true;
    this.rand = mulberry32(seed + 4242);
    this.worksRate = opts.works ?? 1;
    this.radar = opts.radar ?? true;
    this.nextWorks = START_S + 700 + this.rand() * 600;
    this.nextSign = START_S + 500 + this.rand() * 500;
  }

  clear() {
    this.on = false;
    for (const p of this.props) this.scene.remove(p.obj);
    for (const sg of this.signs) sg.tex.dispose();
    this.props.length = 0;
    this.zones.length = 0;
    this.signs.length = 0;
    this.cones.count = 0;
  }

  // Lays things out ahead, drops them behind and handles the rider passing.
  // live: the rider is riding (not in a menu), so passing things counts.
  // mph: which units the speed signs read in.
  update(dt, player, cars, events, live, mph) {
    if (!this.on) return;
    this.live = live;
    const s = player.s;
    this.place(s);
    while (this.zones.length && this.zones[0].end < s - BEHIND) this.zones.shift();
    for (let i = this.props.length - 1; i >= 0; i--) {
      if (this.props[i].s < s - BEHIND) {
        this.scene.remove(this.props[i].obj);
        this.props.splice(i, 1);
      }
    }
    while (this.signs.length && this.signs[0].s < s - BEHIND) this.signs.shift().tex.dispose();

    // Cones: knocked by the rider or a car, then tumble until they settle.
    let n = 0;
    for (const z of this.zones) {
      for (const c of z.cones) {
        if (!c.hit) {
          const hitter = this.hitBy(c, player, cars);
          if (hitter) {
            c.hit = true;
            const vx = hitter.vx, vz = hitter.vz;
            c.vel = new THREE.Vector3(vx * 0.9 + (this.rand() - 0.5) * 2, 2 + Math.hypot(vx, vz) * 0.12, vz * 0.9 + (this.rand() - 0.5) * 2);
            c.spin = new THREE.Vector3((this.rand() - 0.5) * 14, (this.rand() - 0.5) * 6, (this.rand() - 0.5) * 14);
            if (hitter.rider) {
              z.clean = false;
              player.vel.multiplyScalar(0.96);
              player.shake = Math.max(player.shake, 0.35);
              events.push({ type: 'cone' });
            }
          }
        }
        if (c.vel) {
          c.vel.y -= 9.81 * dt;
          c.pos.addScaledVector(c.vel, dt);
          c.rot.x += c.spin.x * dt;
          c.rot.y += c.spin.y * dt;
          c.rot.z += c.spin.z * dt;
          const ground = this.road.sample(c.s, _f).y;
          if (c.pos.y < ground) {
            c.pos.y = ground;
            c.vel.multiplyScalar(0.4);
            c.vel.y = Math.abs(c.vel.y) * 0.3;
            c.spin.multiplyScalar(0.5);
            if (c.vel.lengthSq() < 0.05) {
              // Lying on its side.
              c.vel = null;
              c.rot.x = Math.PI / 2;
              c.rot.z = 0;
              c.pos.y = ground + 0.17;
            }
          }
        }
        if (n < MAX_CONES) this.cones.setMatrixAt(n++, _m.compose(c.pos, _q.setFromEuler(_e.copy(c.rot)), _s));
      }
      // Through the works without touching a cone.
      if (!z.scored && s > z.end) {
        z.scored = true;
        if (z.clean && live && !player.crashed && z.entered) events.push({ type: 'cleanWorks', points: 250 });
      }
      if (s > z.start && s < z.end) z.entered = true;
    }
    this.cones.count = n;
    this.cones.instanceMatrix.needsUpdate = true;

    // Speed signs: light up as the rider comes, score on the way past.
    for (const sg of this.signs) {
      const gap = sg.s - s;
      if (gap < 220 && gap > -20) {
        const v = player.crashed ? 0 : player.speed;
        const shown = Math.round(mph ? v * 2.23694 : v * 3.6);
        if (shown !== sg.shown) this.drawSign(sg, shown, mph, v > 13.4);
      }
      if (!sg.passed && gap < 0) {
        sg.passed = true;
        if (live && !player.crashed && player.speed > 5) {
          const kmh = player.speed * 3.6;
          events.push({ type: 'radar', speed: player.speed, points: Math.round(kmh * kmh * 0.08) });
        }
      }
    }
  }

  // The rider or a car touching cone c; returns { vx, vz } of whoever did.
  hitBy(c, player, cars) {
    if (this.live && !player.crashed && Math.abs(player.s - c.s) < 0.55 && Math.abs(player.d - c.d) < CONE_R + 0.3 && player.speed > 1) {
      return { vx: player.vel.x, vz: player.vel.y, rider: true };
    }
    for (const car of cars) {
      if (Math.abs(car.s - c.s) < car.L / 2 + CONE_R && Math.abs(car.lane - c.d) < car.W / 2 + CONE_R) {
        const f = this.road.sample(car.s, _f);
        return { vx: f.dirX * car.v * car.dir, vz: f.dirZ * car.v * car.dir };
      }
    }
    return null;
  }

  drawSign(sg, value, mph, fast) {
    sg.shown = value;
    const { ctx, tex } = sg;
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = '#ffd400';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOUR SPEED', 128, 34);
    // LED digits: green under 30 mph, red and flashing SLOW DOWN above.
    ctx.fillStyle = fast ? '#ff2a1a' : '#29ff5a';
    ctx.font = 'bold 104px monospace';
    ctx.fillText(String(value), 128, 136);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(fast ? 'SLOW DOWN' : mph ? 'MPH' : 'KM/H', 128, 176);
    tex.needsUpdate = true;
  }

  // Adds a post with a board on it at road distance s, offset d.
  addSign(s, d, mat, w, h, top) {
    const road = this.road;
    const f = road.sample(s, _f);
    const group = new THREE.Group();
    group.position.set(f.x + f.rightX * d, f.y, f.z + f.rightZ * d);
    // Face up the road, towards the rider coming down.
    group.rotation.y = -f.heading + Math.PI;
    const post = new THREE.Mesh(this.postGeo, this.postMat);
    post.castShadow = true;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    board.position.set(0, top - h / 2, -0.06);
    board.rotation.y = Math.PI;
    group.add(post, board);
    this.scene.add(group);
    this.props.push({ s, obj: group });
    return board;
  }

  place(s) {
    const road = this.road;
    const rand = this.rand;
    while (this.worksRate > 0 && this.nextWorks < s + AHEAD) {
      const start = this.nextWorks;
      const len = 90 + rand() * 120;
      this.nextWorks += len + (900 + rand() * 1400) / this.worksRate;
      // Close the left or right edge; cones taper in over 24 m and out over 12.
      const side = rand() < 0.5 ? -1 : 1;
      // Not on a bridge or in a gallery.
      let span = false;
      for (let a = start - 30; a < start + len + 30; a += 10) if (road.spanAt(a)) span = true;
      if (span) continue;
      const z = { start, end: start + len, cones: [], clean: true, scored: false, entered: false };
      for (let a = 0; a <= len; a += CONE_GAP / (a < 24 || a > len - 12 ? 2 : 1)) {
        const into = Math.min(1, a / 24, (len - a) / 12);
        const d = side * (HALF_WIDTH + 0.3 - (HALF_WIDTH + 0.3 - CONE_LINE) * into);
        const at = start + a;
        const f = road.sample(at, _f);
        z.cones.push({ s: at, d, hit: false, vel: null, pos: new THREE.Vector3(f.x + f.rightX * d, f.y, f.z + f.rightZ * d), rot: new THREE.Euler(0, -f.heading, 0) });
      }
      this.zones.push(z);
      // Fresh chippings over the closed side and spilling into the lane.
      for (let a = 10; a < len - 6; a += 6 + rand() * 10) {
        const patch = { s: start + a, d: side * (2.4 + rand() * 1.4), len: 4 + rand() * 6, width: 1.2 + rand() * 1.8 };
        const i = road.patches.findIndex((p) => p.s > patch.s);
        road.patches.splice(i < 0 ? road.patches.length : i, 0, patch);
      }
      this.addSign(start - 90, side * SIGN_D, this.worksMat, 1.1, 1, 2.5);
    }
    while (this.radar && this.nextSign < s + AHEAD) {
      const at = this.nextSign;
      this.nextSign += 1200 + rand() * 1800;
      if (this.zones.some((z) => at > z.start - 120 && at < z.end + 20) || road.spanAt(at)) continue;
      const { canvas, ctx, tex } = face(256, 192);
      if (!ctx) continue;
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.4 });
      this.addSign(at, SIGN_D, mat, 1.6, 1.2, 2.9);
      const sg = { s: at, canvas, ctx, tex, shown: null, passed: false };
      this.drawSign(sg, 0, true, false);
      this.signs.push(sg);
    }
  }
}
