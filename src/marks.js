// Urethane "thane lines" left on the asphalt during slides, plus wheel dust.
import * as THREE from 'three';
import { makeSoftDotTexture } from './textures.js';

const MAX_QUADS = 3000;
const PARTICLES = 400;

export class SlideMarks {
  constructor(scene) {
    const pos = new Float32Array(MAX_QUADS * 4 * 3);
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({
      color: '#d9b48a',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.last = [null, null, null, null];

    const ppos = new Float32Array(PARTICLES * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    this.pgeo = pgeo;
    this.pv = new Float32Array(PARTICLES * 3);
    this.life = new Float32Array(PARTICLES);
    this.alpha = new Float32Array(PARTICLES);
    pgeo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const pmat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTex: { value: makeSoftDotTexture() } },
      vertexShader: `attribute float alpha; varying float vA;
        void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.0 - alpha) * 260.0 / -mv.z + 30.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 0.8, 0.74), t.a * vA * 0.45); }`,
    });
    this.points = new THREE.Points(pgeo, pmat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pNext = 0;
  }

  addQuad(a, b, width) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = (-dz / len) * width;
    const nz = (dx / len) * width;
    const p = this.geo.attributes.position.array;
    const o = this.next * 12;
    p.set([a.x + nx, a.y, a.z + nz, a.x - nx, a.y, a.z - nz, b.x + nx, b.y, b.z + nz, b.x - nx, b.y, b.z - nz], o);
    this.next = (this.next + 1) % MAX_QUADS;
    this.geo.attributes.position.needsUpdate = true;
  }

  // wheels: array of 4 world positions (Vector3) on the road surface.
  update(dt, sliding, wheels, intensity, vel) {
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (sliding && w) {
        const pt = { x: w.x, y: w.y + 0.012, z: w.z };
        const l = this.last[i];
        if (l && Math.hypot(pt.x - l.x, pt.z - l.z) > 0.25) {
          this.addQuad(l, pt, 0.025);
          this.last[i] = pt;
        } else if (!l) this.last[i] = pt;
        if (Math.random() < intensity * dt * 30) this.emit(w, vel);
      } else {
        this.last[i] = null;
      }
    }
    const pp = this.pgeo.attributes.position.array;
    for (let i = 0; i < PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      pp[i * 3] += this.pv[i * 3] * dt;
      pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt;
      pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      this.pv[i * 3] *= 1 - dt * 2;
      this.pv[i * 3 + 2] *= 1 - dt * 2;
      this.alpha[i] = Math.max(0, this.life[i] / 0.9);
    }
    this.pgeo.attributes.position.needsUpdate = true;
    this.pgeo.attributes.alpha.needsUpdate = true;
  }

  emit(p, vel) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % PARTICLES;
    const pp = this.pgeo.attributes.position.array;
    pp[i * 3] = p.x;
    pp[i * 3 + 1] = p.y + 0.05;
    pp[i * 3 + 2] = p.z;
    this.pv[i * 3] = vel.x * 0.5 + (Math.random() - 0.5);
    this.pv[i * 3 + 1] = 0.4 + Math.random() * 0.5;
    this.pv[i * 3 + 2] = vel.y * 0.5 + (Math.random() - 0.5);
    this.life[i] = 0.9;
  }
}
