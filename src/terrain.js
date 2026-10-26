// Streaming terrain around the player. Heights come from a world-space function
// built from the road "field" (so the land meets the road cleanly, with a
// mountain wall on one side and a valley on the other) plus ridged noise.
// Two rings of tiles: detailed near tiles and coarse far tiles, split by a
// circular cut in the fragment shader so they never overlap visibly.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, fbm, ridged, smoothstep, lerp, mulberry32 } from './noise.js';

const NEAR_SIZE = 160;
const FAR_SIZE = 1280;
const FAR_SEGS = 32;
const SHOULDER = 6.5;

const col = new THREE.Color();
const COLORS = {
  gravel: new THREE.Color('#8a8172'),
  grassA: new THREE.Color('#5d7a37'),
  grassB: new THREE.Color('#3f5f2a'),
  dry: new THREE.Color('#8f8a55'),
  rock: new THREE.Color('#77716a'),
  rockDark: new THREE.Color('#57524d'),
  snow: new THREE.Color('#eef1f5'),
};

export class Terrain {
  // q: quality preset (nearRadius, nearSegs, farRadius, treeSpacing).
  constructor(scene, road, seed = 99, q = {}) {
    this.scene = scene;
    this.nearRadius = q.nearRadius ?? 4;
    this.nearSegs = q.nearSegs ?? 64;
    this.farRadius = q.farRadius ?? 3;
    this.treeSpacing = q.treeSpacing ?? 7;
    // Near tiles always cover at least nearRadius tiles from the rider.
    this.nearCut = { value: this.nearRadius * NEAR_SIZE - 40 };
    this.road = road;
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 1);
    this.noise3 = createNoise2D(seed + 2);
    this.field = {};
    this.near = new Map();
    this.far = new Map();
    this.cutCenter = new THREE.Vector2();

    const patch = (inside) => (shader) => {
      shader.uniforms.uCut = { value: this.cutCenter };
      shader.uniforms.uCutR = this.nearCut;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosT;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPosT;\nuniform vec2 uCut;\nuniform float uCutR;',
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          float cutD = distance(vWorldPosT.xz, uCut);
          ${inside ? 'if (cutD > uCutR) discard;' : 'if (cutD < uCutR) discard;'}`,
        );
    };

    this.nearMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.nearMat.onBeforeCompile = patch(true);
    this.nearMat.customProgramCacheKey = () => 'terrain-near';
    this.farMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.farMat.onBeforeCompile = patch(false);
    this.farMat.customProgramCacheKey = () => 'terrain-far';

    this.treeGeo = makeTreeGeometry();
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.rockMat = new THREE.MeshLambertMaterial({ color: '#7b756d', flatShading: true });
  }

  heightAt(x, z, coarse = false) {
    const f = this.road.field(x, z, this.field);
    return this.heightFromField(x, z, f, coarse);
  }

  heightFromField(x, z, f, coarse) {
    const e = Math.max(0, f.dist - SHOULDER);
    const k = f.uphill;
    const up = (0.9 * e) / (1 + e / 320);
    const down = (-0.75 * e) / (1 + e / 110);
    const base = lerp(down, up, (k + 1) * 0.5);
    const ridge = ridged(this.noise, x / 1100, z / 1100, coarse ? 4 : 5);
    const amp = smoothstep(4, 140, e) * (12 + Math.min(e, 1600) * 0.24);
    const detail = fbm(this.noise2, x / 55, z / 55, 3) * smoothstep(1, 25, e) * (2 + e * 0.02);
    let h = f.roadY - 0.4 + base + (ridge - 0.3) * amp + detail;
    // Gentle ditch on the shoulder.
    if (f.dist > 4.6 && f.dist < SHOULDER + 2) h -= 0.25 * smoothstep(4.6, 5.6, f.dist);
    // Coarse tiles sit lower near the road so they never cover it far away.
    if (coarse) h -= 8 * (1 - smoothstep(30, 120, f.dist));
    return h;
  }

  buildTile(cx, cz, size, segs, coarse) {
    const n = segs + 1;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const rel = new Float32Array(n * n);
    const dist = new Float32Array(n * n);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const f = this.road.field(x, z, this.field);
      const h = this.heightFromField(x, z, f, coarse);
      pos.setXYZ(i, x, h, z);
      rel[i] = h - f.roadY;
      dist[i] = f.dist;
    }
    // Skirts are unnecessary: near/far are split by the shader cut.
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ny = nor.getY(i);
      const v = this.noise3(x / 40, z / 40) * 0.5 + 0.5;
      const v2 = this.noise3(x / 300 + 50, z / 300) * 0.5 + 0.5;
      col.copy(COLORS.grassA).lerp(COLORS.grassB, v).lerp(COLORS.dry, v2 * 0.45);
      const steep = 1 - smoothstep(0.6, 0.82, ny);
      col.lerp(v > 0.5 ? COLORS.rock : COLORS.rockDark, steep);
      const snowLine = 240 + this.noise3(x / 150, z / 150) * 50;
      const snow = smoothstep(snowLine, snowLine + 40, rel[i]) * smoothstep(0.55, 0.75, ny);
      col.lerp(COLORS.snow, snow);
      if (dist[i] < 7.5) col.lerp(COLORS.gravel, 1 - smoothstep(5.5, 7.5, dist[i]));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, coarse ? this.farMat : this.nearMat);
    mesh.receiveShadow = !coarse;
    mesh.matrixAutoUpdate = false;
    const group = new THREE.Group();
    group.add(mesh);
    if (!coarse) this.scatter(group, cx, cz, size);
    return group;
  }

  scatter(group, cx, cz, size) {
    const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const trees = [];
    const rocks = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const spacing = this.treeSpacing;
    for (let gx = 0; gx < size / spacing; gx++) {
      for (let gz = 0; gz < size / spacing; gz++) {
        const x = cx - size / 2 + (gx + rand()) * spacing;
        const z = cz - size / 2 + (gz + rand()) * spacing;
        const forest = this.noise2(x / 140, z / 140) * 0.5 + 0.5;
        const r = rand();
        if (r > forest * 0.9 && r > 0.04) continue;
        const f = this.road.field(x, z, this.field);
        if (f.dist < 9) continue;
        const h = this.heightFromField(x, z, f, false);
        const rel = h - f.roadY;
        // Estimate slope with a cheap finite difference.
        const hx = this.heightAt(x + 2, z);
        const hz = this.heightAt(x, z + 2);
        const slope = Math.hypot(hx - h, hz - h) / 2;
        if (r <= 0.04 && slope < 1.2) {
          const sc = 0.4 + rand() * 1.6;
          q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
          m.compose(p.set(x, h + sc * 0.3, z), q, s.set(sc, sc * 0.7, sc));
          rocks.push(m.clone());
          continue;
        }
        if (slope > 0.75 || rel > 200 + forest * 40) continue;
        const sc = 0.7 + rand() * 0.7;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        m.compose(p.set(x, h - 0.2, z), q, s.set(sc, sc * (0.85 + rand() * 0.4), sc));
        trees.push(m.clone());
      }
    }
    if (trees.length) {
      const im = new THREE.InstancedMesh(this.treeGeo, this.treeMat, trees.length);
      trees.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    if (rocks.length) {
      const im = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rocks.length);
      rocks.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  wanted(px, pz, size, radius) {
    const tx = Math.round(px / size);
    const tz = Math.round(pz / size);
    const list = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        list.push({ key: `${tx + dx},${tz + dz}`, x: (tx + dx) * size, z: (tz + dz) * size, d: dx * dx + dz * dz });
      }
    }
    list.sort((a, b) => a.d - b.d);
    return list;
  }

  // Generate missing tiles nearest-first within a time budget (ms).
  update(px, pz, budgetMs = 6) {
    this.cutCenter.set(px, pz);
    const t0 = performance.now();
    const passes = [
      [this.near, NEAR_SIZE, this.nearSegs, this.nearRadius, false],
      [this.far, FAR_SIZE, FAR_SEGS, this.farRadius, true],
    ];
    let built = 0;
    for (const [map, size, segs, radius, coarse] of passes) {
      const want = this.wanted(px, pz, size, radius);
      const keep = new Set(want.map((w) => w.key));
      for (const [key, g] of map) {
        if (!keep.has(key)) {
          this.disposeGroup(g);
          map.delete(key);
        }
      }
      for (const w of want) {
        if (map.has(w.key)) continue;
        if (performance.now() - t0 > budgetMs && built > 0) return false;
        const g = this.buildTile(w.x, w.z, size, segs, coarse);
        this.scene.add(g);
        map.set(w.key, g);
        built++;
      }
    }
    return true;
  }

  get tileCount() {
    return (this.nearRadius * 2 + 1) ** 2 + (this.farRadius * 2 + 1) ** 2;
  }

  disposeGroup(g) {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry.dispose();
    });
  }
}

function makeTreeGeometry() {
  const parts = [];
  const paint = (geo, hex) => {
    const c = new THREE.Color(hex);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r;
      arr[i + 1] = c.g;
      arr[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 5);
  trunk.translate(0, 1.2, 0);
  parts.push(paint(trunk, '#4b3424'));
  const layers = [
    [2.6, 4.2, 3.4, '#2f4a26'],
    [2.0, 3.4, 5.4, '#36552b'],
    [1.3, 2.8, 7.3, '#3d5f30'],
  ];
  for (const [r, hgt, y, c] of layers) {
    const cone = new THREE.ConeGeometry(r, hgt, 7);
    cone.translate(0, y, 0);
    parts.push(paint(cone, c));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}

