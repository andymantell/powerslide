// Sparks off a glove's slide puck scraping the tarmac: short glowing streaks
// in one additive LineSegments draw. The pool size comes from the quality
// preset, so phones and iPads only pay for a handful.
import * as THREE from 'three';

const G = 9.81;
const LIFE = 0.35; // s, longest a spark glows
const STREAK = 0.04; // s of travel each streak shows

// Hot white-yellow cooling to orange-red, then out (additive, so black is invisible).
const HOT = new THREE.Color('#fff2b0');
const COOL = new THREE.Color('#ff5a10');

export class Sparks {
  constructor(scene, count) {
    this.n = Math.max(0, count | 0);
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.floor = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.next = 0;
    this.acc = 0; // fractional sparks owed to the next frame
    if (!this.n) return;
    const geo = new THREE.BufferGeometry();
    this.line = new Float32Array(this.n * 6);
    this.color = new Float32Array(this.n * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.line, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  clear() {
    this.life.fill(0);
    this.acc = 0;
  }

  // at: the glove's world position (or null), vel: the rider's velocity
  // (Vector2, x/z), roadY: the road height under the glove.
  update(dt, at, vel, roadY) {
    if (!this.n) return;
    const speed = Math.hypot(vel.x, vel.y);
    if (at && speed > 3) {
      // Faster scraping, more sparks: the whole pool at about 60 km/h.
      this.acc += dt * (this.n / LIFE) * Math.min(1, speed / 17);
      while (this.acc >= 1) {
        this.acc -= 1;
        this.emit(at, vel, roadY);
      }
    } else {
      this.acc = 0;
    }
    const p = this.pos, v = this.vel, L = this.line, C = this.color;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3, o6 = i * 6;
      if (this.life[i] <= 0) {
        C.fill(0, o6, o6 + 6);
        continue;
      }
      this.life[i] -= dt;
      v[o + 1] -= G * dt;
      v[o] *= 1 - dt * 1.5;
      v[o + 2] *= 1 - dt * 1.5;
      p[o] += v[o] * dt;
      p[o + 1] += v[o + 1] * dt;
      p[o + 2] += v[o + 2] * dt;
      if (p[o + 1] < this.floor[i]) {
        // Skip off the road, losing most of the bounce.
        p[o + 1] = this.floor[i];
        v[o + 1] = Math.abs(v[o + 1]) * 0.3;
      }
      L[o6] = p[o];
      L[o6 + 1] = p[o + 1];
      L[o6 + 2] = p[o + 2];
      L[o6 + 3] = p[o] - v[o] * STREAK;
      L[o6 + 4] = Math.max(this.floor[i], p[o + 1] - v[o + 1] * STREAK);
      L[o6 + 5] = p[o + 2] - v[o + 2] * STREAK;
      const k = Math.max(0, this.life[i] / LIFE);
      const r = COOL.r + (HOT.r - COOL.r) * k, g = COOL.g + (HOT.g - COOL.g) * k, b = COOL.b + (HOT.b - COOL.b) * k;
      const head = Math.min(1, k * 2.5), tail = head * 0.35;
      C[o6] = r * head;
      C[o6 + 1] = g * head;
      C[o6 + 2] = b * head;
      C[o6 + 3] = r * tail;
      C[o6 + 4] = g * tail;
      C[o6 + 5] = b * tail;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  emit(at, vel, roadY) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const o = i * 3;
    this.floor[i] = roadY + 0.005;
    this.pos[o] = at.x;
    this.pos[o + 1] = roadY + 0.02;
    this.pos[o + 2] = at.z;
    // Torn off the road moving with the glove but slower, so they spray out
    // behind the rider, fanning sideways and kicking up.
    const keep = 0.35 + Math.random() * 0.45;
    const spread = 1.5 + Math.hypot(vel.x, vel.y) * 0.08;
    this.vel[o] = vel.x * keep + (Math.random() - 0.5) * spread;
    this.vel[o + 1] = 0.6 + Math.random() * 2.2;
    this.vel[o + 2] = vel.y * keep + (Math.random() - 0.5) * spread;
    this.life[i] = LIFE * (0.45 + Math.random() * 0.55);
  }
}
