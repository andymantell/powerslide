// Builds road surface, embankment skirts and guardrails in chunks along the
// centreline, streaming them in ahead of the player and dropping them behind.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DS, HALF_WIDTH, RAIL_OFFSET } from './road.js';
import { makeGritTexture } from './textures.js';
import { createRoadMaterial } from './roadmat.js';
import { groundTexture } from './ground.js';

const VERGE = HALF_WIDTH + 0.75; // road mesh carries on past the asphalt as a gravel verge

const CHUNK = 160; // samples per chunk
const AHEAD = 1600; // metres
const BEHIND = 250;
export const RAIL_THRESHOLD = 0.3; // |cliff| above this gets a guardrail on the valley side

export class RoadMesh {
  constructor(scene, road, renderer) {
    this.scene = scene;
    this.road = road;
    this.chunks = new Map();
    this.roadMat = createRoadMaterial(renderer);
    const gravel = groundTexture('gravel', 'albedo', renderer);
    this.skirtMat = new THREE.MeshStandardMaterial({ map: gravel, color: '#dcd6cc', roughness: 1, side: THREE.DoubleSide });
    // Keep the up-facing normal on whichever face is seen.
    this.skirtMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize(vNormal);',
      );
    };
    // Galvanised steel W-beam on steel posts.
    this.railMat = new THREE.MeshStandardMaterial({ color: '#b4b9bf', metalness: 0.85, roughness: 0.55, side: THREE.DoubleSide });
    this.postMat = new THREE.MeshStandardMaterial({ color: '#a3a8ad', metalness: 0.8, roughness: 0.5 });
    this.gritMat = new THREE.MeshLambertMaterial({
      map: makeGritTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // C-section post: web plus two flanges, sunk into the verge.
    const web = new THREE.BoxGeometry(0.1, 1.1, 0.006);
    const fl1 = new THREE.BoxGeometry(0.006, 1.1, 0.05);
    fl1.translate(-0.05, 0, 0.025);
    const fl2 = fl1.clone();
    fl2.translate(0.1, 0, 0);
    this.postGeo = mergeGeometries([web, fl1, fl2]);
    this.postGeo.translate(0, 0.2, 0);

    // Finish and checkpoint gantries.
    const span = RAIL_OFFSET + 0.6;
    this.gantryPostGeo = new THREE.BoxGeometry(0.22, 7, 0.22);
    this.bannerGeo = new THREE.BoxGeometry(span * 2 + 0.22, 1.1, 0.12);
    this.lineGeo = new THREE.PlaneGeometry(HALF_WIDTH * 2, 0.8);
    this.gantryMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.6, roughness: 0.5 });
    const checker = makeChecker();
    this.finishMat = new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 });
    this.checkpointMat = new THREE.MeshStandardMaterial({ color: '#1d6fd1', roughness: 0.6 });
    this.lineMat = new THREE.MeshStandardMaterial({
      map: checker,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
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
    const across = [-VERGE, -HALF_WIDTH, -HALF_WIDTH * 0.5, 0, HALF_WIDTH * 0.5, HALF_WIDTH, VERGE];
    // Slight camber for drainage, then the verge falls away past the asphalt.
    const crown = (u) => -0.04 * (Math.min(Math.abs(u), HALF_WIDTH) / HALF_WIDTH) ** 2 - Math.max(0, Math.abs(u) - HALF_WIDTH) * 0.12;
    const skirtUv = [];
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
        uv.push(u, s);
      }
      for (const side of [-1, 1]) {
        const u = side * VERGE;
        // A shallow bank down to below the terrain, so the edge never shows a dark wall.
        const u2 = side * (VERGE + 2.2);
        skirtPos.push(f.x + f.rightX * u, f.y + crown(u) + 0.02, f.z + f.rightZ * u);
        skirtPos.push(f.x + f.rightX * u2, f.y - 1.6, f.z + f.rightZ * u2);
        skirtUv.push(0, s * 0.45, 1.2, s * 0.45);
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
    sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUv, 2));
    sgeo.setIndex(skirtIdx);
    // Up-facing normals light the bank like the flat gravel beyond it.
    sgeo.setAttribute('normal', new THREE.Float32BufferAttribute(skirtPos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const skirt = new THREE.Mesh(sgeo, this.skirtMat);
    skirt.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh, skirt);
    this.buildRails(group, i0, i1);
    this.buildGrit(group, i0, i1);
    for (const s of road.checkpoints) {
      if (s >= i0 * DS && s < i1 * DS) group.add(this.gantry(s, this.checkpointMat));
    }
    if (road.finish !== null && road.finish >= i0 * DS && road.finish < i1 * DS) {
      group.add(this.gantry(road.finish, this.finishMat));
    }
    return group;
  }

  // An arch over the road with a banner and a painted line, at distance s.
  gantry(s, bannerMat) {
    const f = this.road.sample(s, {});
    const g = new THREE.Group();
    const span = RAIL_OFFSET + 0.6;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(this.gantryPostGeo, this.gantryMat);
      post.position.set(side * span, 1.5, 0);
      post.castShadow = true;
      g.add(post);
    }
    const banner = new THREE.Mesh(this.bannerGeo, bannerMat);
    banner.position.set(0, 5.1, 0);
    banner.castShadow = true;
    g.add(banner);
    const line = new THREE.Mesh(this.lineGeo, this.lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.06, 0);
    g.add(line);
    g.position.set(f.x, f.y, f.z);
    g.rotation.y = -f.heading;
    return g;
  }

  // Drop every chunk, for a new road.
  clear() {
    for (const g of this.chunks.values()) this.disposeChunk(g);
    this.chunks.clear();
  }

  disposeChunk(g) {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh && o.geometry !== this.gantryPostGeo && o.geometry !== this.bannerGeo && o.geometry !== this.lineGeo) {
        o.geometry.dispose();
      }
    });
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
    // W-beam cross-section: (outward offset, height).
    const profile = [
      [0, 0.52], [0.06, 0.545], [0.075, 0.59], [0.03, 0.64], [0.03, 0.69], [0.075, 0.74], [0.06, 0.785], [0, 0.81],
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
      const rail = new THREE.Mesh(geo, this.railMat);
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
        this.disposeChunk(g);
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

function makeChecker() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
