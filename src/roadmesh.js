// Builds road surface, embankment skirts and guardrails in chunks along the
// centreline, streaming them in ahead of the player and dropping them behind.

import * as THREE from 'three';
import { DS, HALF_WIDTH, RAIL_OFFSET } from './road.js';
import { ROAD_TEX_LENGTH, makeAsphaltTexture, makeGritTexture } from './textures.js';

const CHUNK = 160; // samples per chunk
const AHEAD = 1600; // metres
const BEHIND = 250;
export const RAIL_THRESHOLD = 0.3; // |cliff| above this gets a guardrail on the valley side

export class RoadMesh {
  constructor(scene, road, renderer) {
    this.scene = scene;
    this.road = road;
    this.chunks = new Map();
    this.roadMat = new THREE.MeshStandardMaterial({
      map: makeAsphaltTexture(renderer),
      roughness: 0.92,
      metalness: 0,
    });
    this.skirtMat = new THREE.MeshLambertMaterial({ color: '#5b5550' });
    this.railMat = new THREE.MeshStandardMaterial({ color: '#c9cdd1', metalness: 0.6, roughness: 0.4 });
    this.postMat = new THREE.MeshLambertMaterial({ color: '#6b5a48' });
    this.gritMat = new THREE.MeshLambertMaterial({
      map: makeGritTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14);
    this.postGeo.translate(0, 0.25, 0);
  }

  // Lateral position of the guardrail at sample i (0 when none).
  static railSide(cliff) {
    if (cliff > RAIL_THRESHOLD) return -1; // mountain right -> drop on the left
    if (cliff < -RAIL_THRESHOLD) return 1;
    return 0;
  }

  buildChunk(ci) {
    const road = this.road;
    const i0 = ci * CHUNK;
    const i1 = Math.min(i0 + CHUNK, road.count - 1);
    const n = i1 - i0 + 1;
    const across = [-HALF_WIDTH, -HALF_WIDTH * 0.5, 0, HALF_WIDTH * 0.5, HALF_WIDTH];
    const crown = (u) => -0.04 * (u / HALF_WIDTH) ** 2; // slight camber for drainage
    const pos = [];
    const uv = [];
    const idx = [];
    const skirtPos = [];
    const skirtIdx = [];
    const f = {};
    for (let a = 0; a < n; a++) {
      const s = (i0 + a) * DS;
      road.sample(s, f);
      for (let b = 0; b < across.length; b++) {
        const u = across[b];
        pos.push(f.x + f.rightX * u, f.y + crown(u), f.z + f.rightZ * u);
        uv.push((u + HALF_WIDTH) / (HALF_WIDTH * 2), s / ROAD_TEX_LENGTH);
      }
      for (const side of [-1, 1]) {
        const u = side * HALF_WIDTH;
        const u2 = side * (HALF_WIDTH + 0.6);
        skirtPos.push(f.x + f.rightX * u, f.y + crown(u), f.z + f.rightZ * u);
        skirtPos.push(f.x + f.rightX * u2, f.y - 1.6, f.z + f.rightZ * u2);
      }
    }
    const w = across.length;
    for (let a = 0; a < n - 1; a++) {
      for (let b = 0; b < w - 1; b++) {
        const p0 = a * w + b;
        const p1 = p0 + 1;
        const p2 = p0 + w;
        const p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2);
      }
      const k = a * 4;
      const kn = k + 4;
      // left skirt (vertices k, k+1), right skirt (k+2, k+3)
      skirtIdx.push(k, k + 1, kn, kn, k + 1, kn + 1);
      skirtIdx.push(k + 2, kn + 2, k + 3, k + 3, kn + 2, kn + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.roadMat);
    mesh.receiveShadow = true;
    // Lift slightly so it never z-fights with terrain underneath.
    mesh.position.y = 0.02;

    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
    sgeo.setIndex(skirtIdx);
    sgeo.computeVertexNormals();
    const skirt = new THREE.Mesh(sgeo, this.skirtMat);
    skirt.material.side = THREE.DoubleSide;
    skirt.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh, skirt);
    this.buildRails(group, i0, i1);
    this.buildGrit(group, i0, i1);
    return group;
  }

  buildRails(group, i0, i1) {
    const road = this.road;
    const f = {};
    const railPos = [];
    const railIdx = [];
    const posts = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let run = -1;
    const profile = [
      [0, 0.55], [0.08, 0.6], [0.08, 0.75], [0, 0.8],
    ];
    for (let i = i0; i <= i1; i++) {
      road.sample(i * DS, f);
      const side = RoadMesh.railSide(road.c[i]);
      if (side === 0) {
        run = -1;
        continue;
      }
      const base = railPos.length / 3;
      for (const [o, hgt] of profile) {
        const u = side * (RAIL_OFFSET - o);
        railPos.push(f.x + f.rightX * u, f.y + hgt, f.z + f.rightZ * u);
      }
      if (run >= 0 && RoadMesh.railSide(road.c[i - 1]) === side) {
        for (let p = 0; p < profile.length - 1; p++) {
          const a = run + p, b = run + p + 1, c = base + p, d = base + p + 1;
          railIdx.push(a, c, b, b, c, d);
        }
      }
      run = base;
      if (i % 4 === 0) {
        const u = side * (RAIL_OFFSET + 0.08);
        q.setFromAxisAngle(up, -f.heading);
        m.compose(new THREE.Vector3(f.x + f.rightX * u, f.y, f.z + f.rightZ * u), q, new THREE.Vector3(1, 1, 1));
        posts.push(m.clone());
      }
    }
    if (railIdx.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
      geo.setIndex(railIdx);
      geo.computeVertexNormals();
      const mat = this.railMat;
      mat.side = THREE.DoubleSide;
      const rail = new THREE.Mesh(geo, mat);
      rail.castShadow = true;
      group.add(rail);
    }
    if (posts.length) {
      const im = new THREE.InstancedMesh(this.postGeo, this.postMat, posts.length);
      posts.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  buildGrit(group, i0, i1) {
    const pos = [];
    const uv = [];
    const idx = [];
    const f = {};
    const N = 4;
    for (const p of this.road.patches) {
      if (p.s < i0 * DS || p.s >= i1 * DS) continue;
      const base = pos.length / 3;
      // Texture is drawn slightly larger than the gripless area.
      const L = p.len * 1.2;
      const W = p.width * 1.2;
      for (let a = 0; a <= N; a++) {
        const s = p.s + (a / N - 0.5) * L;
        this.road.sample(s, f);
        for (let b = 0; b <= N; b++) {
          const d = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, p.d + (b / N - 0.5) * W));
          pos.push(f.x + f.rightX * d, f.y + 0.035 - 0.04 * (d / HALF_WIDTH) ** 2, f.z + f.rightZ * d);
          uv.push(b / N, a / N);
        }
      }
      for (let a = 0; a < N; a++) {
        for (let b = 0; b < N; b++) {
          const p0 = base + a * (N + 1) + b;
          const p2 = p0 + N + 1;
          idx.push(p0, p0 + 1, p2, p0 + 1, p2 + 1, p2);
        }
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.gritMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  update(playerS) {
    const first = Math.max(0, Math.floor((playerS - BEHIND) / DS / CHUNK));
    const last = Math.floor((playerS + AHEAD) / DS / CHUNK);
    for (const [ci, g] of this.chunks) {
      if (ci < first || ci > last) {
        this.scene.remove(g);
        g.traverse((o) => {
          if (o.isInstancedMesh) o.dispose();
          else if (o.isMesh) o.geometry.dispose();
        });
        this.chunks.delete(ci);
      }
    }
    for (let ci = first; ci <= last; ci++) {
      if (this.chunks.has(ci)) continue;
      if ((ci + 1) * CHUNK >= this.road.count) break;
      const g = this.buildChunk(ci);
      this.scene.add(g);
      this.chunks.set(ci, g);
    }
  }
}
