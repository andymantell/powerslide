// Vehicle sheet for reviewing the traffic models (tools/blender/vehicles.py):
// every type from several sides, in the game's own materials.
//   /tools/garage/?types=classic,suv&views=fq,side,rq,front&lod=0&night=0&seed=1
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VehicleFleet } from '../../src/vehicles.js';
import { QUALITY } from '../../src/settings.js';
import { sampleLook } from '../../src/traffic.js';
import { mulberry32 } from '../../src/noise.js';

const P = new URLSearchParams(location.search);
const views = (P.get('views') || 'fq,side,rq,front').split(',');
const cw = +(P.get('w') || 360), ch = +(P.get('h') || 230);
const night = +(P.get('night') || 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = night ? 0.05 : 0.6;
scene.background = new THREE.Color(night ? '#0b0f18' : '#aab6c2');
const sun = new THREE.DirectionalLight('#fff3e0', night ? 0.05 : 2.6);
sun.position.set(-8, 12, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 });
scene.add(sun, new THREE.HemisphereLight('#cfe0ff', '#4d4636', night ? 0.02 : 0.4));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: night ? '#1a1a1c' : '#55585c', roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, cw / ch, 0.1, 200);
const fleet = new VehicleFleet(scene, { ...QUALITY[P.get('q') || 'high'], vehicleLod: P.get('lod') === '1' ? 0 : 1000 });
if (night) fleet.setNight?.(1, renderer);
await fleet.ready;
const types = (P.get('types') || Object.keys(fleet.types).join(',')).split(',');
renderer.setPixelRatio(1);
renderer.setSize(cw * views.length, ch * types.length);
renderer.setScissorTest(true);
const rand = mulberry32(+(P.get('seed') || 1));
const ANG = { fq: [-0.7, 0.32], side: [Math.PI / 2, 0.08], rq: [-2.4, 0.3], front: [0, 0.12], rear: [Math.PI, 0.12], top: [-0.6, 1.1] };
types.forEach((type, row) => {
  const meta = fleet.meta(type);
  const car = { type, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, ...sampleLook(type, rand), lamps: { head: 0.06 + night * 3.5, tail: 0.35 + night, amber: 0.3 + night } };
  fleet.update([car], camera);
  views.forEach((v, col) => {
    const [a, e] = ANG[v];
    const r = Math.max(meta.L, meta.H * 2) * 1.55 + 1.5;
    const cy = meta.H * 0.45;
    camera.position.set(Math.sin(a) * Math.cos(e) * r, cy + Math.sin(e) * r, -Math.cos(a) * Math.cos(e) * r);
    camera.lookAt(0, cy, 0);
    const y = (types.length - 1 - row) * ch;
    renderer.setViewport(col * cw, y, cw, ch);
    renderer.setScissor(col * cw, y, cw, ch);
    renderer.render(scene, camera);
  });
});
window.__garageReady = true;
