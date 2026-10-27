// Prop sheet: every model in props.glb on a lawn, lit like the game, with
// its name. /tools/props/?only=chalet,church&dist=40&yaw=30 narrows it down;
// ?pack=dartmoor shows props_dartmoor.glb instead.
//   node tools/props/shoot.mjs out.png [query]
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSky, SUN_DIR, ATMOSPHERE } from '../../src/sky.js';
import { createPropMaterial } from '../../src/propmat.js';

const q = new URLSearchParams(location.search);
const only = q.get('only')?.split(',');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const { sun } = createSky(scene, renderer, { shadows: true, shadowMap: 4096, shadowExtent: 90 }, ATMOSPHERE[q.get('look') || 'alpine'] || ATMOSPHERE.alpine);
scene.fog.density = 0;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#5f7d45', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const mat = createPropMaterial(renderer);

const pack = q.get('pack');
const gltf = await new GLTFLoader().loadAsync(pack ? new URL(`../../src/assets/models/props_${pack}.glb`, import.meta.url).href : new URL('../../src/assets/models/props.glb', import.meta.url).href);
const meshes = [];
gltf.scene.traverse((o) => o.isMesh && (!only || only.includes(o.name)) && meshes.push(o));
// Lay out in rows, sized by footprint.
const yaw = ((+q.get('yaw') || 25) * Math.PI) / 180;
let x = 0, z = 0, rowH = 0;
const maxW = +q.get('width') || 120;
const items = [];
for (const o of meshes) {
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox;
  const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) + 3;
  if (x + w > maxW) {
    x = 0;
    z += rowH;
    rowH = 0;
  }
  const m = new THREE.Mesh(o.geometry, mat);
  m.castShadow = m.receiveShadow = true;
  m.position.set(x + w / 2, 0, -z - w / 2);
  m.rotation.y = yaw;
  scene.add(m);
  items.push({ m, name: o.name, top: b.max.y });
  x += w;
  rowH = Math.max(rowH, w);
}
const cx = maxW / 2, cz = -(z + rowH) / 2;
const span = Math.max(maxW, z + rowH);
const dist = +q.get('dist') || span * 1.05;
camera.position.set(cx + dist * 0.15, dist * 0.55, cz + dist * 0.85);
camera.lookAt(cx, 0, cz);
sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 300);
sun.target.position.set(cx, 0, cz);
sun.target.updateMatrixWorld();
renderer.render(scene, camera);
const v = new THREE.Vector3();
for (const it of items) {
  v.copy(it.m.position).setY(it.top + 1).project(camera);
  const d = document.createElement('div');
  d.textContent = it.name;
  d.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
  d.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight - 14}px`;
  document.getElementById('labels').appendChild(d);
}
window.__propsReady = true;
