// Rider pose sheet for checking the skinned rider in every pose:
//   npm run dev, then open /tools/poses/  (or node tools/poses/shoot.mjs)
// ?pose=a,b&view=a,b&zoom=part&focus=joint narrows it; the default is a grid of all.
import * as THREE from 'three';
import { RiderModel } from '../../src/rider.js';
import { texturesReady } from '../../src/ground.js';

const hand = (x) => new THREE.Vector3(x * 0.62, -0.115 + 0.03, 0.1);
export const POSES = {
  upright: { crouch: 0.3 },
  carveToe: { roll: 0.22, lean: 0.4, crouch: 0.45 },
  carveHeel: { roll: -0.22, lean: -0.4, crouch: 0.45 },
  halfTuck: { tuck: 0.5, crouch: 0.3 },
  tuck: { tuck: 1, crouch: 0.3 },
  airbrake: { spread: 1, crouch: 0.05 },
  pushPlant: { push: 1, pushPhase: 0.15, crouch: 0.3 },
  pushSwing: { push: 1, pushPhase: 0.8, crouch: 0.3 },
  footbrake: { brake: 1, crouch: 0.45 },
  slideToe: { roll: 0.2, lean: 0.55, crouch: 0.75, slideHand: 1, handAmount: 1, handTarget: hand(1), lookYaw: 0.8 },
  slideHeel: { roll: -0.2, lean: -0.55, crouch: 0.75, slideHand: -1, handAmount: 1, handTarget: hand(-1), lookYaw: -0.8 },
  crash: { crouch: 0.6, limp: 1 },
};
// Camera direction (from the rider) and height.
const VIEWS = {
  front: [1, 0.25, 0.15],
  side: [0.1, 0.2, -1],
  back: [-1, 0.35, 0.3],
  rear: [0.3, 0.3, 1],
  top: [0.25, 1, 0.05],
  noseSide: [1, 0.15, -0.9],
};
const ZOOM = { full: [0.75, 1.5], hips: [0.8, 0.6], shoulders: [1.3, 0.6], neck: [1.45, 0.45], knees: [0.45, 0.6], feet: [0.1, 0.9], hands: [0.9, 0.9], wrist: [0.8, 0.35] };

const q = new URLSearchParams(location.search);
const only = q.get('pose');
const views = q.get('view') ? q.get('view').split(',') : ['front', 'side', 'back'];
const zoom = ZOOM[q.get('zoom') || 'full'];
const focus = q.get('focus'); // a joint name to centre on, e.g. haF
const names = only ? only.split(',') : Object.keys(POSES);
const cell = Number(q.get('cell') || 300);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(cell * views.length, cell * names.length);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8a96a3');
scene.add(new THREE.HemisphereLight('#dfe8f5', '#4a4038', 1.6));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(2, 4, 1.5);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: '#5d5f63' }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const models = names.map(() => {
  const m = new RiderModel();
  scene.add(m.root);
  m.root.visible = false;
  return m;
});
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);

await texturesReady();
await new Promise((r) => setTimeout(r, 200));
const H = renderer.domElement.height;
names.forEach((n, i) => {
  const m = models[i];
  m.pose(POSES[n]);
  m.root.visible = true;
  m.root.updateMatrixWorld(true);
  views.forEach((v, j) => {
    const [dx, dy, dz] = VIEWS[v];
    const look = focus ? m.rig.localToWorld(m.joints[focus].clone()) : new THREE.Vector3(0, zoom[0], 0);
    const d = zoom[1] / Math.tan(THREE.MathUtils.degToRad(15)) * 0.62;
    camera.position.copy(look).add(new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(d));
    camera.lookAt(look);
    renderer.setViewport(j * cell, H - (i + 1) * cell, cell, cell);
    renderer.setScissor(j * cell, H - (i + 1) * cell, cell, cell);
    renderer.render(scene, camera);
  });
  m.root.visible = false;
});
window.__posesReady = true;
