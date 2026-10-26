// Two-way traffic. Downhill cars share the rider's lane (right-hand traffic)
// and slow for bends, so a fast rider has to pick a gap to overtake; uphill
// cars come at you in the other lane.

import * as THREE from 'three';
import { LANE_WIDTH } from './road.js';
import { clamp, mulberry32 } from './noise.js';

const G = 9.81;
const PAINT = ['#c0392b', '#2c3e50', '#ecf0f1', '#16a085', '#f39c12', '#7f8c8d', '#1f4e79', '#111111', '#8e44ad', '#d35400'];

function carMesh(rand) {
  const kind = rand() < 0.18 ? 'van' : 'car';
  const L = kind === 'van' ? 5.0 : 4.4;
  const W = kind === 'van' ? 1.95 : 1.8;
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: PAINT[Math.floor(rand() * PAINT.length)], metalness: 0.5, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2430', metalness: 0.9, roughness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.7, L), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);
  const cabinL = kind === 'van' ? L * 0.78 : L * 0.5;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, kind === 'van' ? 0.95 : 0.55, cabinL), paint);
  cabin.position.set(0, kind === 'van' ? 1.42 : 1.22, kind === 'van' ? 0.25 : 0.25);
  cabin.castShadow = true;
  group.add(cabin);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, kind === 'van' ? 0.7 : 0.45, 0.05), glass);
  wind.position.set(0, cabin.position.y + 0.02, cabin.position.z - cabinL / 2 - 0.01);
  group.add(wind);
  const side = new THREE.Mesh(new THREE.BoxGeometry(W * 0.93, kind === 'van' ? 0.5 : 0.38, cabinL * 0.85), glass);
  side.position.set(0, cabin.position.y + 0.08, cabin.position.z);
  group.add(side);
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) {
    for (const z of [-L / 2 + 0.8, L / 2 - 0.8]) {
      const w = new THREE.Mesh(wheelGeo, black);
      w.position.set(x, 0.33, z);
      group.add(w);
    }
  }
  const head = new THREE.MeshStandardMaterial({ color: '#fffbe6', emissive: '#fff4c0', emissiveIntensity: 1.5 });
  const tail = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0.4 });
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.05), head);
    h.position.set(x, 0.72, -L / 2 - 0.01);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.05), tail);
    t.position.set(x, 0.75, L / 2 + 0.01);
    group.add(h, t);
  }
  return { group, L, W, tail };
}

export class Traffic {
  constructor(scene, road, diff = {}) {
    this.scene = scene;
    this.road = road;
    this.cars = [];
    this.rand = mulberry32(2024);
    this.frame = {};
    this.spawnTimer = 0;
    this.density = diff.trafficDensity ?? 1;
    this.speedScale = diff.trafficSpeed ?? 1;
  }

  clear() {
    for (const c of this.cars) this.scene.remove(c.mesh);
    this.cars.length = 0;
  }

  spawn(playerS, dir) {
    const r = this.rand;
    const m = carMesh(r);
    const s = dir < 0 ? playerS + 550 + r() * 250 : playerS + 220 + r() * 380;
    // Keep a sensible gap to cars already in that lane.
    for (const c of this.cars) if (c.dir === dir && Math.abs(c.s - s) < 45) return;
    const car = {
      mesh: m.group,
      tail: m.tail,
      L: m.L,
      W: m.W,
      s,
      dir,
      lane: dir > 0 ? LANE_WIDTH / 2 : -LANE_WIDTH / 2,
      vmax: (dir > 0 ? 13 + r() * 7 : 14 + r() * 9) * this.speedScale,
      v: 0,
      passed: false,
      minGap: Infinity,
      honked: false,
      lastLz: null,
    };
    car.v = car.vmax * 0.8;
    this.scene.add(car.mesh);
    this.cars.push(car);
  }

  update(dt, player, events) {
    const ps = player.s;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = (1.4 + this.rand() * 2.2) / this.density;
      const down = this.cars.filter((c) => c.dir > 0).length;
      const up = this.cars.length - down;
      const dir = this.rand() < 0.62 ? -1 : 1;
      if (dir < 0 ? up < 5 : down < 3) this.spawn(ps, dir);
    }
    const f = this.frame;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      // Corner speed: drivers keep lateral acceleration modest.
      let vt = c.vmax;
      const look = c.s + c.dir * 25;
      this.road.sample(look, f);
      const k = Math.abs(f.kappa);
      if (k > 1e-4) vt = Math.min(vt, Math.sqrt((0.32 * G) / k));
      // Follow the car ahead in the same lane.
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        const gap = (o.s - c.s) * c.dir;
        if (gap > 0 && gap < 40) vt = Math.min(vt, o.v * (gap < 15 ? 0.7 : 1));
      }
      // Slow down for a rider stopped/slow in their lane ahead.
      const gapP = (ps - c.s) * c.dir;
      if (gapP > 0 && gapP < 35 && Math.abs(player.d - c.lane) < 2.2 && !player.crashed) {
        vt = Math.min(vt, Math.max(0, player.speed * (c.dir > 0 ? 1 : 0) + (gapP - 8) * 0.3));
      }
      const braking = vt < c.v - 0.3;
      c.v += clamp(vt - c.v, -6 * dt, 2.2 * dt);
      c.s += c.v * c.dir * dt;
      c.tail.emissiveIntensity = braking ? 2.2 : 0.4;

      const fr = this.road.sample(c.s, f);
      const x = fr.x + fr.rightX * c.lane;
      const z = fr.z + fr.rightZ * c.lane;
      c.mesh.position.set(x, fr.y, z);
      const yaw = fr.heading + (c.dir < 0 ? Math.PI : 0);
      c.mesh.rotation.set(0, -yaw, 0);
      c.mesh.rotateX(-Math.atan(fr.grade) * c.dir);
      c.x = x;
      c.z = z;
      c.yaw = yaw;

      if (c.s < ps - 220 || c.s > ps + 1000) {
        this.scene.remove(c.mesh);
        this.cars.splice(i, 1);
        continue;
      }
      if (!player.crashed) this.interact(c, player, events);
    }
  }

  interact(c, player, events) {
    const dx = player.pos.x - c.x;
    const dz = player.pos.z - c.z;
    if (dx * dx + dz * dz > 400) {
      c.lastLz = null;
      return;
    }
    // Player in car-local coordinates (lz forward along the car).
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const lz = dx * fx + dz * fz;
    const lx = dx * -fz + dz * fx;
    const hx = c.W / 2 + 0.3;
    const hz = c.L / 2 + 0.3;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz && Math.abs(player.pos.y - c.mesh.position.y) < 2) {
      // Thrown back off the bumper at roughly the car's speed.
      player.crash(c.dir < 0 ? 'Head-on with a car' : 'Rear-ended a car', {
        x: fx * c.v * 1.1 - Math.sign(lz) * fx * 2,
        z: fz * c.v * 1.1 - Math.sign(lz) * fz * 2,
      });
      events.push({ type: 'carHit' });
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
