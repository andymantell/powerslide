// Grows the game's trees with ez-tree (tools/trees/ez-tree, MIT, vendored
// from https://github.com/dgreenheck/ez-tree with its texture and material
// code taken out) and writes one file per species to
// src/assets/models/trees/<species>.glb, so a biome only loads its own.
//   node tools/trees/build.mjs [species...]
// Each species gets a few variants, each a `<species><v>_trunk` and a
// `<species><v>_foliage` mesh, Y-up, in metres, base at the origin. The game
// supplies the materials (bark, and the alpha-tested twig and leaf cards from
// tools/textures/gen.py) and bakes the distance impostors at start-up.
// Prints each variant's triangle count: keep the full tree near 3,000 for the
// iPad, as hundreds of them are drawn near the road.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Tree } from './ez-tree/tree.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', 'src', 'assets', 'models', 'trees');
const preset = (name) => JSON.parse(fs.readFileSync(path.join(HERE, 'ez-tree', 'presets', `${name}.json`)));

// Deep-merges `over` into a copy of `base`.
function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k] ?? {}, v) : v;
  }
  return out;
}

// height: metres the tree is scaled to (a range, picked per variant).
// options: ez-tree options over the named preset. Lengths are in ez-tree's
// own units; the whole tree is scaled to `height` afterwards.
export const SPECIES = {
  // Norway spruce (Alpine Meadows, High Alpine Pass): a narrow cone of
  // drooping branches right down to the ground.
  spruce: {
    height: [12, 16],
    variants: 3,
    preset: 'pine_medium',
    options: {
      branch: {
        levels: 1,
        children: { 0: 66 },
        angle: { 1: 100 },
        length: { 0: 50, 1: 14 },
        radius: { 0: 1.0, 1: 0.22 },
        start: { 1: 0.04 },
        sections: { 0: 10, 1: 2 },
        segments: { 0: 7, 1: 3 },
        gnarliness: { 0: 0, 1: 0.05 },
        force: { strength: 0 },
      },
      leaves: { billboard: 'double', angle: 22, count: 7, start: 0.0, size: 5.5, sizeVariance: 0.25, aspect: 0.75 },
    },
  },
  // Scots pine (Pine Forest): a tall bare trunk and a high, rounded crown of
  // fewer branches that fork and sweep upward, needles in tufts at the ends.
  pine: {
    height: [17, 23],
    variants: 3,
    preset: 'pine_large',
    options: {
      type: 'deciduous',
      branch: {
        levels: 2,
        children: { 0: 12, 1: 4 },
        angle: { 1: 58, 2: 40 },
        length: { 0: 62, 1: 13, 2: 7 },
        radius: { 0: 1.6, 1: 0.45, 2: 0.6 },
        start: { 1: 0.62, 2: 0.25 },
        sections: { 0: 10, 1: 4, 2: 3 },
        segments: { 0: 8, 1: 4, 2: 3 },
        taper: { 0: 0.75, 1: 0.7, 2: 0.7 },
        gnarliness: { 0: 0.04, 1: 0.18, 2: 0.2 },
        force: { strength: 0.006 },
      },
      leaves: { billboard: 'double', angle: 50, count: 4, start: 0.35, size: 6.5, sizeVariance: 0.25, aspect: 0.9 },
    },
  },
  // Pedunculate oak (suburbs, city): a stout trunk and a broad, domed crown
  // of crooked limbs.
  oak: {
    height: [12, 16],
    variants: 3,
    preset: 'oak_medium',
    options: {
      branch: {
        levels: 3,
        children: { 0: 6, 1: 4, 2: 3 },
        length: { 0: 30, 1: 20, 2: 11, 3: 6 },
        radius: { 0: 1.6, 1: 0.6, 2: 0.6, 3: 0.7 },
        angle: { 1: 55, 2: 50, 3: 40 },
        start: { 1: 0.38, 2: 0.15, 3: 0.2 },
        sections: { 0: 6, 1: 4, 2: 2, 3: 2 },
        segments: { 0: 7, 1: 4, 2: 3, 3: 3 },
        gnarliness: { 0: 0.04, 1: 0.12, 2: 0.18, 3: 0.12 },
        force: { strength: 0.0 },
      },
      leaves: { billboard: 'double', angle: 40, count: 1, start: 0.4, size: 11, sizeVariance: 0.25 },
    },
  },
  // Dartmoor's dwarf oaks (Wistman's Wood): short, gnarled and leaning, the
  // limbs spreading low from a squat trunk.
  dwarfoak: {
    height: [4.5, 7.5],
    variants: 3,
    seed: 3,
    preset: 'oak_small',
    options: {
      branch: {
        levels: 3,
        children: { 0: 5, 1: 4, 2: 3 },
        length: { 0: 16, 1: 15, 2: 9, 3: 5 },
        radius: { 0: 1.4, 1: 0.65, 2: 0.6, 3: 0.7 },
        angle: { 1: 62, 2: 55, 3: 45 },
        start: { 1: 0.2, 2: 0.15, 3: 0.2 },
        sections: { 0: 6, 1: 4, 2: 3, 3: 2 },
        segments: { 0: 7, 1: 4, 2: 3, 3: 3 },
        gnarliness: { 0: 0.2, 1: 0.3, 2: 0.3, 3: 0.2 },
        force: { direction: { x: 0.5, y: 0.8, z: 0 }, strength: 0.004 },
      },
      leaves: { billboard: 'double', angle: 40, count: 1, start: 0.4, size: 7.5, sizeVariance: 0.3 },
    },
  },
  // Ash (valleys, hedgerows, streets): tall, with an open crown of long
  // limbs that sweep up at the ends.
  ash: {
    height: [14, 19],
    variants: 2,
    preset: 'ash_medium',
    options: {
      branch: {
        levels: 3,
        children: { 0: 7, 1: 3, 2: 3 },
        length: { 0: 40, 1: 24, 2: 10, 3: 5 },
        radius: { 0: 1.5, 1: 0.55, 2: 0.7, 3: 0.7 },
        angle: { 1: 45, 2: 55, 3: 45 },
        start: { 1: 0.4, 2: 0.3, 3: 0.2 },
        sections: { 0: 7, 1: 4, 2: 2, 3: 2 },
        segments: { 0: 7, 1: 4, 2: 3, 3: 3 },
        gnarliness: { 0: 0.03, 1: 0.15, 2: 0.15, 3: 0.1 },
        force: { strength: 0.01 },
      },
      leaves: { billboard: 'double', angle: 45, count: 1, start: 0.3, size: 11, sizeVariance: 0.25 },
    },
  },
  // Rowan (Dartmoor valleys, suburban verges): a small tree with a few
  // upswept limbs and red berries.
  rowan: {
    height: [6, 9],
    variants: 2,
    preset: 'aspen_small',
    options: {
      branch: {
        levels: 2,
        children: { 0: 8, 1: 5 },
        length: { 0: 26, 1: 12, 2: 6 },
        radius: { 0: 0.9, 1: 0.5, 2: 0.7 },
        angle: { 1: 40, 2: 45 },
        start: { 1: 0.35, 2: 0.2 },
        sections: { 0: 7, 1: 4, 2: 3 },
        segments: { 0: 6, 1: 4, 2: 3 },
        gnarliness: { 0: 0.05, 1: 0.12, 2: 0.12 },
        force: { strength: 0.01 },
      },
      leaves: { billboard: 'double', angle: 40, count: 2, start: 0.4, size: 6, sizeVariance: 0.25 },
    },
  },
  // Silver birch: slender white trunk, light crown of thin, drooping twigs.
  birch: {
    height: [11, 15],
    variants: 2,
    preset: 'aspen_medium',
    options: {
      branch: {
        levels: 2,
        children: { 0: 14, 1: 4 },
        length: { 0: 50, 1: 14, 2: 9 },
        radius: { 0: 0.8, 1: 0.4, 2: 0.7 },
        angle: { 1: 50, 2: 60 },
        start: { 1: 0.4, 2: 0.2 },
        sections: { 0: 9, 1: 4, 2: 3 },
        segments: { 0: 6, 1: 3, 2: 3 },
        gnarliness: { 0: 0.03, 1: 0.1, 2: 0.1 },
        force: { strength: -0.004 },
      },
      leaves: { billboard: 'double', angle: 50, count: 2, start: 0.3, size: 7, sizeVariance: 0.25 },
    },
  },
  // Hawthorn (moor edges, hedges, the coast): a dense, twiggy small tree,
  // often wind-bent.
  hawthorn: {
    height: [3.5, 5.5],
    variants: 2,
    seed: 5,
    preset: 'oak_small',
    options: {
      branch: {
        levels: 3,
        children: { 0: 5, 1: 3, 2: 3 },
        length: { 0: 10, 1: 14, 2: 8, 3: 4 },
        radius: { 0: 1.0, 1: 0.6, 2: 0.6, 3: 0.7 },
        angle: { 1: 38, 2: 45, 3: 45 },
        start: { 1: 0.35, 2: 0.2, 3: 0.2 },
        sections: { 0: 5, 1: 4, 2: 3, 3: 2 },
        segments: { 0: 6, 1: 4, 2: 3, 3: 3 },
        gnarliness: { 0: 0.15, 1: 0.25, 2: 0.25, 3: 0.2 },
        force: { direction: { x: 0.7, y: 0.7, z: 0 }, strength: 0.006 },
      },
      leaves: { billboard: 'double', angle: 40, count: 1, start: 0.4, size: 6, sizeVariance: 0.3 },
    },
  },
};

function grow(sp, v) {
  const opts = merge(preset(sp.preset), sp.options);
  opts.seed = 1000 + v * 7919 + (sp.seed ?? 0);
  const tree = new Tree();
  tree.loadFromJson(opts);
  const trunk = tree.branchesMesh.geometry;
  const foliage = tree.leavesMesh.geometry;
  // Scale to the target height, measured on the whole tree.
  const box = new THREE.Box3().setFromBufferAttribute(trunk.attributes.position);
  box.union(new THREE.Box3().setFromBufferAttribute(foliage.attributes.position));
  const t = (Math.sin(v * 12.9898 + (sp.seed ?? 0)) * 43758.5453) % 1;
  const H = sp.height[0] + (sp.height[1] - sp.height[0]) * Math.abs(t);
  const k = H / box.max.y;
  for (const g of [trunk, foliage]) g.scale(k, k, k);
  return { trunk, foliage, tris: (trunk.index.count + foliage.index.count) / 3 };
}

// Minimal GLB writer: one node per mesh, positions, normals, uvs, indices.
function writeGLB(file, meshes) {
  const json = { asset: { version: '2.0', generator: 'powerslide tools/trees' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let offset = 0;
  const addView = (arr, target) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    chunks.push(buf, Buffer.alloc(pad));
    offset += buf.length + pad;
    return json.bufferViews.length - 1;
  };
  const addAccessor = (attr, type, target, minmax) => {
    const arr = attr.array;
    const acc = { bufferView: addView(arr, target), componentType: arr instanceof Uint32Array ? 5125 : arr instanceof Uint16Array ? 5123 : 5126, count: attr.count, type };
    if (minmax) {
      const b = new THREE.Box3().setFromBufferAttribute(attr);
      acc.min = b.min.toArray();
      acc.max = b.max.toArray();
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };
  for (const [name, g] of meshes) {
    const index = g.index.count > 65535 ? new THREE.BufferAttribute(new Uint32Array(g.index.array), 1) : g.index;
    const prim = {
      attributes: {
        POSITION: addAccessor(g.attributes.position, 'VEC3', 34962, true),
        NORMAL: addAccessor(g.attributes.normal, 'VEC3', 34962),
        TEXCOORD_0: addAccessor(g.attributes.uv, 'VEC2', 34962),
      },
      indices: addAccessor(index, 'SCALAR', 34963),
    };
    json.meshes.push({ name, primitives: [prim] });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  fs.writeFileSync(file, Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
}

const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
for (const [name, sp] of Object.entries(SPECIES)) {
  if (only.length && !only.includes(name)) continue;
  const meshes = [];
  for (let v = 0; v < sp.variants; v++) {
    const { trunk, foliage, tris } = grow(sp, v);
    trunk.computeBoundingBox();
    console.log(`${name}${v}: ${tris} triangles, ${trunk.boundingBox.max.y.toFixed(1)} m trunk`);
    meshes.push([`${name}${v}_trunk`, trunk], [`${name}${v}_foliage`, foliage]);
  }
  const file = path.join(OUT, `${name}.glb`);
  writeGLB(file, meshes);
  console.log('wrote', path.relative(process.cwd(), file));
}
