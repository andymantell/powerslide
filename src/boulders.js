// Boulders from tools/blender/rocks.py. Like the forest, each variant is one
// InstancedMesh for the whole world, refilled when terrain tiles come and go.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRockMaterial, trackLoad } from './ground.js';

const MODEL = new URL('./assets/models/rocks.glb', import.meta.url).href;
const MAX = 3000;

export class Boulders {
  constructor(scene, renderer, groundSet) {
    this.scene = scene;
    this.mat = createRockMaterial(renderer, groundSet);
    this.meshes = [];
    this.sources = new Set(); // Float32Arrays of [x, y, z, scale, yaw, tilt, variant]
    this.dirty = true;
    trackLoad(
      new GLTFLoader().loadAsync(MODEL).then((gltf) => {
        const geos = [];
        gltf.scene.traverse((o) => o.isMesh && geos.push(o.geometry));
        for (const g of geos) {
          const m = new THREE.InstancedMesh(g, this.mat, MAX);
          m.count = 0;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
          scene.add(m);
          this.meshes.push(m);
        }
        this.dirty = true;
      }),
    );
  }

  add(arr) {
    this.sources.add(arr);
    this.dirty = true;
  }

  remove(arr) {
    this.sources.delete(arr);
    this.dirty = true;
  }

  update() {
    if (!this.dirty || !this.meshes.length) return;
    this.dirty = false;
    const n = this.meshes.length;
    const counts = new Array(n).fill(0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const arr of this.sources) {
      for (let i = 0; i < arr.length; i += 7) {
        const k = arr[i + 6] % n;
        if (counts[k] >= MAX) continue;
        const sc = arr[i + 3];
        e.set(arr[i + 5], arr[i + 4], arr[i + 5] * 0.7);
        q.setFromEuler(e);
        m.compose(p.set(arr[i], arr[i + 1], arr[i + 2]), q, s.set(sc, sc, sc));
        this.meshes[k].setMatrixAt(counts[k]++, m);
      }
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}
