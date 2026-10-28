// Tree preview: each variant of a species close up in the biome's light, with
// a stand of the same trees behind, far enough out to be drawn as impostors.
// /tools/trees/?species=spruce&biome=alpine&time=day&quality=medium&view=near
// view: near (the full trees), close (one tree), or far (a stand of impostors).
import * as THREE from 'three';
import { createSky, atmosphereFor, SUN_DIR } from '../../src/sky.js';
import { QUALITY } from '../../src/settings.js';
import { Forest } from '../../src/forest.js';
import { texturesReady } from '../../src/ground.js';

const params = new URLSearchParams(location.search);
const q = QUALITY[params.get('quality') || 'medium'];
const species = params.get('species') || 'spruce';
const view = params.get('view') || 'near';
const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const { sun, bakeClouds } = createSky(scene, renderer, q, atmosphereFor(params.get('biome') || 'alpine', params.get('time') || 'day', params.get('weather') || 'clear'));
bakeClouds(Infinity);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f6a35, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
const forest = new Forest(scene, renderer, { ...q, treeLodRadius: 90 }, species.split(','));
const trees = [];
// Close row: variants side by side, 14 m apart, 30 m from the camera.
for (let i = 0; i < 6; i++) trees.push((i - 2.5) * 14, 0, -30, 1, i * 1.3, i, 0.5);
// Far stand from 160 m out (impostors).
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 900; i++) {
  const x = (rnd() - 0.5) * 700, z = -160 - rnd() * 500;
  trees.push(x, 0, z, 0.55 + rnd() * 0.55, rnd() * 6.28, Math.floor(rnd() * 8), rnd());
}
forest.add(new Float32Array(trees));
const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 5000);
await texturesReady();
await new Promise((r) => { const t = () => (forest.ready ? r() : setTimeout(t, 50)); t(); });
forest.update(0, 0);
// ?bare: branches only.
if (params.has('bare')) for (const v of forest.variants) v.foliage.visible = false;
sun.position.set(0, 0, -30).addScaledVector(SUN_DIR, 150);
sun.target.position.set(0, 0, -30);
if (view === 'far') {
  camera.position.set(0, 25, 0);
  camera.lookAt(0, 10, -300);
} else if (view === 'close') {
  camera.position.set(-7, 2, -12);
  camera.lookAt(-7, 7, -30);
} else {
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 8, -30);
}
renderer.render(scene, camera);
document.title = 'Trees ready';
