// Trackside props from tools/blender/props.py: buildings, animals, fences,
// signs and the rest. A level lists them in "props" (see the README, "Making
// levels"); biomes add their own roadside furniture (dressing.js). Each prop
// type is one InstancedMesh for the whole level with the shared prop material,
// refilled with the instances within that type's draw distance as the rider
// moves, so draw calls stay at one per type in view.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { trackLoad } from './ground.js';
import { createPropMaterial } from './propmat.js';

const MODEL = new URL('./assets/models/props.glb', import.meta.url).href;
// Each biome's own props (tools/blender/props_<biome>.py), loaded on top.
const PACKS = {
  dartmoor: new URL('./assets/models/props_dartmoor.glb', import.meta.url).href,
};

// r: keep-out radius for trees, rocks and grass (m). pad: buildings get a level
// terrace of this radius cut into the slope. far: draw distance (m).
const BIG = { far: 1800 };
const MID = { far: 700 };
const SMALL = { far: 260 };
export const PROP_TYPES = {
  chalet: { r: 9, pad: 9, ...BIG },
  chalet_small: { r: 8, pad: 8, ...BIG },
  chalet_tall: { r: 10, pad: 10, ...BIG },
  farmhouse: { r: 9, pad: 9, ...BIG },
  church: { r: 15, pad: 15, ...BIG },
  barn: { r: 11, pad: 11, ...BIG },
  hut: { r: 9, pad: 9, ...BIG },
  chapel: { r: 6, pad: 6, ...BIG },
  sawmill: { r: 12, pad: 12, ...BIG },
  station: { r: 15, pad: 15, ...BIG },
  boathouse: { r: 6, ...BIG },
  pylon: { r: 4, ...BIG },
  summitcross: { r: 3, ...BIG },
  cow: { r: 1.5, ...MID },
  cow_pied: { r: 1.5, ...MID },
  cow_dun: { r: 1.5, ...MID },
  haybale: { r: 1.2, ...MID },
  logstack: { r: 5, ...MID },
  jetty: { r: 2, ...MID },
  rowboat: { r: 1, ...MID },
  woodpile: { r: 2, ...SMALL },
  fountain: { r: 3, ...MID },
  trough: { r: 1.6, ...SMALL },
  churns: { r: 1.2, ...SMALL },
  bench: { r: 1, ...SMALL },
  shrine: { r: 1, ...SMALL },
  fence: { r: 0.6, ...SMALL },
  chevron_r: { r: 0.6, ...SMALL },
  chevron_l: { r: 0.6, ...SMALL },
  warnsign_r: { r: 0.6, ...SMALL },
  warnsign_l: { r: 0.6, ...SMALL },
  snowpole: { r: 0.3, ...SMALL },
  flagpole: { r: 0.5, ...MID },
  banner: { r: 0.5, ...MID },
  fan_a: { r: 0.4, ...SMALL },
  fan_b: { r: 0.4, ...SMALL },
  fan_c: { r: 0.4, ...SMALL },
  gondola: { r: 0, ...MID },
  // Dartmoor
  tor_big: { r: 22, ...BIG },
  tor: { r: 14, ...BIG },
  tor_small: { r: 7, ...BIG },
  spoil: { r: 14, ...BIG },
  mast: { r: 6, ...BIG },
  prison: { r: 30, pad: 30, ...BIG },
  church_uk: { r: 15, pad: 15, ...BIG },
  inn: { r: 12, pad: 12, ...BIG },
  cottage: { r: 8, pad: 8, ...BIG },
  cottage_b: { r: 7, pad: 7, ...BIG },
  cottage_slate: { r: 7, pad: 7, ...BIG },
  tearoom: { r: 8, pad: 8, ...BIG },
  hawthorn: { r: 3, ...MID },
  sheep: { r: 0.8, ...MID },
  sheep_dark: { r: 0.8, ...MID },
  pony: { r: 1.2, ...MID },
  pony_dark: { r: 1.2, ...MID },
  pony_grey: { r: 1.2, ...MID },
  fieldwall: { r: 0.6, ...MID },
  ruin_a: { r: 3, ...MID },
  ruin_b: { r: 3, ...MID },
  clapper: { r: 6, ...MID },
  footbridge: { r: 5, ...MID },
  tractor: { r: 2, ...MID },
  car_red: { r: 2, ...MID },
  car_blue: { r: 2, ...MID },
  car_silver: { r: 2, ...MID },
  gorse: { r: 1, ...MID },
  gorse_big: { r: 1.5, ...MID },
  bracken: { r: 0.5, ...SMALL },
  phonebox: { r: 0.8, ...MID },
  picnic: { r: 1.2, ...SMALL },
  fingerpost: { r: 0.6, ...SMALL },
  sign_grid: { r: 0.5, ...SMALL },
  sign_pony: { r: 0.5, ...SMALL },
  sign_ford: { r: 0.5, ...SMALL },
  gate: { r: 0.5, ...SMALL },
  whitepost: { r: 0.3, ...SMALL },
  peat: { r: 2, ...SMALL },
  gauge: { r: 0.3, ...SMALL },
  duck: { r: 0.2, ...SMALL },
  duck_b: { r: 0.2, ...SMALL },
};

const DEG = Math.PI / 180;

export class Props {
  constructor(scene, renderer, terrain, pack = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.mat = createPropMaterial(renderer);
    this.geos = new Map();
    this.meshes = new Map(); // type -> InstancedMesh
    this.items = new Map(); // type -> Float32Array [x, y, z, yaw, scale] * n
    this.list = []; // { type, x, y, z, yaw, scale } while building a level
    this.lastX = Infinity;
    this.lastZ = Infinity;
    const loader = new GLTFLoader();
    for (const url of [MODEL, PACKS[pack]].filter(Boolean)) {
      trackLoad(
        loader.loadAsync(url).then((gltf) => {
          gltf.scene.traverse((o) => {
            if (o.isMesh) this.geos.set(o.name, o.geometry);
          });
        }),
      );
    }
  }

  // World position and facing for a point beside the road: s along it, d
  // across (+ right). Without a yaw, the prop's front faces the road.
  static at(road, s, d, yaw) {
    const f = road.sample(s, {});
    const x = f.x + f.rightX * d;
    const z = f.z + f.rightZ * d;
    let a;
    // 'along' runs the prop's long (x) axis with the road; 'across', over it.
    if (yaw === 'along') a = Math.atan2(-f.dirZ, f.dirX);
    else if (yaw === 'across') a = Math.atan2(-f.rightZ, f.rightX);
    else {
      const side = d >= 0 ? -1 : 1; // face back across the road
      a = Math.atan2(f.rightX * side, f.rightZ * side) + (yaw || 0) * DEG;
    }
    return { x, z, yaw: a, f };
  }

  // Starts a new level's set of props.
  begin() {
    this.list = [];
  }

  // Adds one prop. `y` is optional: by default it sits on the terrain (call
  // after the terrain mods are in place).
  add(type, x, z, yaw = 0, scale = 1, y = null) {
    if (!PROP_TYPES[type]) {
      console.warn('unknown prop', type);
      return null;
    }
    const p = { type, x, y, z, yaw, scale };
    this.list.push(p);
    return p;
  }

  // Buildings: a level terrace on the slope and a keep-out circle. Call once
  // all props are added and before the terrain tiles build.
  shape() {
    const t = this.terrain;
    for (const p of this.list) {
      const def = PROP_TYPES[p.type];
      if (def.r) t.block(p.x, p.z, def.r * p.scale);
      if (def.pad && p.y === null) {
        // Level at the ground height under the middle of the building.
        p.y = t.heightAt(p.x, p.z);
        t.mods.push(terrace(p.x, p.z, def.pad * p.scale, p.y));
      }
    }
  }

  // Settles the remaining props on the finished terrain and fills the meshes.
  // append (endless, which dresses the road a stretch at a time): add these
  // to the props already placed instead of replacing them.
  finish(append = false) {
    // A new level starts from nothing: props of a type it doesn't use would
    // otherwise linger at the old road's positions, floating in its sky.
    if (!append) this.items.clear();
    const by = new Map();
    for (const p of this.list) {
      if (p.y === null) p.y = this.terrain.heightAt(p.x, p.z);
      if (!by.has(p.type)) by.set(p.type, append && this.items.has(p.type) ? [...this.items.get(p.type)] : []);
      by.get(p.type).push(p.x, p.y, p.z, p.yaw, p.scale);
    }
    for (const [type, arr] of by) this.items.set(type, new Float32Array(arr));
    if (!append) {
      for (const [type, mesh] of this.meshes) {
        if (!by.has(type)) mesh.count = 0;
      }
    }
    this.lastX = Infinity;
  }

  // A check for props that don't sit on the ground: every instance more than
  // `tol` m above or below the terrain under it, as { type, x, z, off }.
  // Run it from the console: __powerslide.props.floating().
  floating(tol = 1) {
    const out = [];
    for (const [type, arr] of this.items) {
      for (let i = 0; i < arr.length; i += 5) {
        const off = arr[i + 1] - this.terrain.heightAt(arr[i], arr[i + 2]);
        if (Math.abs(off) > tol) out.push({ type, x: arr[i], z: arr[i + 2], off: Math.round(off * 10) / 10 });
      }
    }
    return out;
  }

  // Endless: forgets props more than `dist` m from (px, pz), so the lists
  // don't grow without end on a long ride.
  prune(px, pz, dist) {
    const d2 = dist * dist;
    for (const [type, arr] of this.items) {
      const keep = [];
      for (let i = 0; i < arr.length; i += 5) {
        if ((arr[i] - px) ** 2 + (arr[i + 2] - pz) ** 2 <= d2) keep.push(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], arr[i + 4]);
      }
      if (keep.length < arr.length) this.items.set(type, new Float32Array(keep));
    }
  }

  clear() {
    this.items.clear();
    this.list = [];
    for (const mesh of this.meshes.values()) mesh.count = 0;
  }

  mesh(type, n) {
    let m = this.meshes.get(type);
    if (m && m.instanceMatrix.count >= n) return m;
    const geo = this.geos.get(type);
    if (!geo) return null;
    if (m) {
      this.scene.remove(m);
      m.dispose();
    }
    m = new THREE.InstancedMesh(geo, this.mat, Math.max(16, Math.ceil(n * 1.25)));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    this.scene.add(m);
    this.meshes.set(type, m);
    return m;
  }

  // Refills the instance lists with what's within each type's draw distance.
  update(px, pz, force = false) {
    if (!force && Math.hypot(px - this.lastX, pz - this.lastZ) < 30) return;
    if (!this.geos.size) return;
    this.lastX = px;
    this.lastZ = pz;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [type, arr] of this.items) {
      const far2 = PROP_TYPES[type].far ** 2;
      const mesh = this.mesh(type, arr.length / 5);
      if (!mesh) continue;
      let n = 0;
      for (let i = 0; i < arr.length; i += 5) {
        const x = arr[i], z = arr[i + 2];
        if ((x - px) ** 2 + (z - pz) ** 2 > far2) continue;
        q.setFromAxisAngle(up, arr[i + 3]);
        m.compose(pos.set(x, arr[i + 1], z), q, sc.setScalar(arr[i + 4]));
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// A flat terrace of radius r at height h, blending back to the slope over
// 8 m. It never reaches the road or its verge.
export function terrace(cx, cz, r, h) {
  const R = r + 8;
  return (x, z, f, y) => {
    const dx = x - cx, dz = z - cz;
    if (Math.abs(dx) > R || Math.abs(dz) > R) return y;
    const d = Math.hypot(dx, dz);
    if (d > R) return y;
    const w = (1 - smooth(r, R, d)) * smooth(6, 9, f.dist);
    return y + (h - 0.05 - y) * w;
  };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
