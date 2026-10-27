// Numbered prop sheet: one tile per prop, each on its own on a 1 m grid in a
// three-quarter view with the rider standing beside it for scale, all under
// the same Alpine midday light. tools/props/sheet.mjs drives it (it numbers
// the tiles and screenshots them); in a browser, /tools/props/sheet.html?item=chalet
// shows one item.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSky, SUN_DIR, atmosphereFor } from '../../src/sky.js';
import { createPropMaterial } from '../../src/propmat.js';
import { texturesReady } from '../../src/ground.js';
import { Forest } from '../../src/forest.js';
import { Boulders } from '../../src/boulders.js';
import { RiderModel } from '../../src/rider.js';
import { sampleLook } from '../../src/traffic.js';
import { VehicleFleet } from '../../src/vehicles.js';
import { QUALITY } from '../../src/settings.js';
import { mulberry32 } from '../../src/noise.js';
import { Extras } from '../../src/extras.js';
import { START_S } from '../../src/road.js';
import { POSES } from '../poses/list.js';

// Sheet sections, in order. A prop missing from here still gets a tile,
// under "Other", so new props can't slip off the sheet.
const GROUPS = [
  ['Alpine buildings', 'chalet chalet_small chalet_tall farmhouse church chapel barn hut sawmill station boathouse'],
  ['Alpine lifts and peaks', 'pylon gondola summitcross'],
  ['Alpine village and farm', 'fountain trough churns bench shrine woodpile logstack haybale fence jetty rowboat'],
  ['Alpine animals', 'cow cow_pied cow_dun'],
  ['Road furniture and race dressing', 'chevron_r chevron_l warnsign_r warnsign_l snowpole flagpole banner fan_a fan_b fan_c'],
  ['Endless roadside', 'cone works_sign speed_sign'],
  ['Dartmoor landscape', 'tor_big tor tor_small spoil mast ruin_a ruin_b peat fieldwall'],
  ['Dartmoor plants', 'hawthorn gorse gorse_big bracken'],
  ['Dartmoor buildings', 'prison church_uk inn tearoom cottage cottage_b cottage_slate phonebox'],
  ['Dartmoor animals', 'sheep sheep_dark pony pony_dark pony_grey duck duck_b'],
  ['Dartmoor roadside', 'fingerpost sign_grid sign_pony sign_ford gate whitepost gauge picnic clapper footbridge'],
  ['Dartmoor parked vehicles', 'tractor car_red car_blue car_silver'],
  ['Traffic', '*traffic'], // every type in vehicles.glb
  ['Trees and rocks', 'spruce0 spruce1 spruce2 rock0 rock1 rock2 rock3'],
  ['Rider and board', 'rider_upright rider_tuck board'],
];

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const { sun } = createSky(scene, renderer, { shadows: true, shadowMap: 4096 }, atmosphereFor('alpine', 'day', 'clear'));
scene.fog = null;
const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 3000);

// The ground: 1 m squares, with a heavier line every 10 m.
function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d');
  g.fillStyle = '#7b8a68';
  g.fillRect(0, 0, 2048, 2048);
  g.strokeStyle = 'rgba(30,40,25,0.35)';
  g.lineWidth = 4;
  for (let i = 0; i <= 10; i++) {
    g.beginPath(); g.moveTo(i * 204.8, 0); g.lineTo(i * 204.8, 2048); g.stroke();
    g.beginPath(); g.moveTo(0, i * 204.8); g.lineTo(2048, i * 204.8); g.stroke();
  }
  g.strokeStyle = 'rgba(25,30,20,0.7)';
  g.lineWidth = 12;
  g.strokeRect(0, 0, 2048, 2048);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(80, 80);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// The rider, standing on the board, for scale.
const rider = new RiderModel();
rider.pose(POSES.upright);
scene.add(rider.root);

// Every item: name -> () => Object3D, with its front facing +Z.
const makers = new Map();
const propMat = createPropMaterial(renderer);
const loader = new GLTFLoader();
for (const pack of ['props', 'props_dartmoor']) {
  const gltf = await loader.loadAsync(new URL(`../../src/assets/models/${pack}.glb`, import.meta.url).href);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    makers.set(o.name, () => {
      const m = new THREE.Mesh(o.geometry, propMat);
      m.castShadow = m.receiveShadow = true;
      // Hanging things (the gondola hangs from its grip at y = 0) sit on the grid.
      o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox.max.y < 0.5) m.position.y = -o.geometry.boundingBox.min.y;
      return m;
    });
  });
}

const forest = new Forest(new THREE.Scene(), renderer, {}, 'spruce');
const boulders = new Boulders(new THREE.Scene(), renderer);
await texturesReady();
forest.variants.forEach((v, i) =>
  makers.set(`spruce${i}`, () => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(v.trunk.geometry, forest.barkMat);
    const f = new THREE.Mesh(v.foliage.geometry, forest.foliageMat);
    for (const m of [t, f]) m.castShadow = m.receiveShadow = true;
    g.add(t, f);
    return g;
  }),
);
boulders.meshes.forEach((bm, i) =>
  makers.set(`rock${i}`, () => {
    const m = new THREE.Mesh(bm.geometry, boulders.mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }),
);

// Traffic: the fleet draws one car at a time; the tile frames a box of its size.
const shadowed = (g) => (g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true)), g);
const fleet = new VehicleFleet(scene, { ...QUALITY.high, vehicleLod: 1000 });
await fleet.ready;
const traffic = Object.keys(fleet.types).filter((t) => fleet.meta(t));
for (const type of traffic) {
  makers.set(`traffic_${type}`, () => {
    const m = fleet.meta(type);
    const car = { type, x: 0, y: 0, z: 0, yaw: Math.PI, pitch: 0, roll: 0, spin: 0, ...sampleLook(type, mulberry32(7 + traffic.indexOf(type))), lamps: { head: 0.25, tail: 0.35, amber: 0.3 } };
    fleet.update([car], camera);
    const box = new THREE.Mesh(new THREE.BoxGeometry(m.W ?? 1.8, m.H, m.L), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.y = m.H / 2;
    box.userData.fleet = true;
    return box;
  });
}
// Endless roadside: lay a straight test road and pick one of each.
const flat = {
  sample: (s, f) => Object.assign(f, { x: 0, y: 0, z: -s, dirX: 0, dirZ: -1, rightX: 1, rightZ: 0, heading: 0 }),
  spanAt: () => false,
  patches: [],
};
const extras = new Extras(new THREE.Scene(), flat);
extras.reset(7, { works: 1, radar: true });
extras.place(START_S);
const pickSign = (isWorks) => {
  const p = extras.props.find((q) => (q.obj.children[1].material === extras.worksMat) === isWorks);
  const g = p.obj;
  g.position.set(0, 0, 0);
  g.rotation.set(0, Math.PI, 0);
  return shadowed(g);
};
if (extras.signs[0]) extras.drawSign(extras.signs[0], 27, true, false);
makers.set('cone', () => {
  const m = new THREE.Mesh(extras.cones.geometry, extras.cones.material);
  m.castShadow = true;
  return m;
});
makers.set('works_sign', () => pickSign(true));
makers.set('speed_sign', () => pickSign(false));

// The rider: the scale figure is hidden for these.
const solo = new Set(['rider_upright', 'rider_tuck', 'board']);
// Built now, since the board's meshes arrive a moment after the model.
const riderTile = (pose, boardOnly) => {
  const r = new RiderModel();
  r.pose(POSES[pose]);
  r.root.rotation.y = -Math.PI / 2; // nose to the left of the frame
  if (boardOnly) {
    r.body.visible = false;
    r.root.remove(r.body);
  }
  return () => {
    r.pose(POSES[pose]);
    return shadowed(r.root);
  };
};
makers.set('rider_upright', riderTile('upright'));
makers.set('rider_tuck', riderTile('tuck'));
makers.set('board', riderTile('upright', true));
await new Promise((r) => setTimeout(r, 300)); // board and rider meshes arrive async
rider.root.updateMatrixWorld(true);
const riderH = new THREE.Box3().setFromObject(rider.root, true).max.y;

const placed = new Set();
const items = [];
for (const [group, names] of GROUPS) {
  for (const n of names === '*traffic' ? traffic.map((t) => `traffic_${t}`) : names.split(' ')) {
    if (!makers.has(n)) {
      console.error('sheet: no such item', n);
      continue;
    }
    items.push({ name: n, group });
    placed.add(n);
  }
}
for (const n of makers.keys()) if (!placed.has(n)) items.push({ name: n, group: 'Other' });

let current = null;
const box = new THREE.Box3();
const sphere = new THREE.Sphere();
// Azimuth of the three-quarter view, from the front towards the right.
const AZ = (35 * Math.PI) / 180;
// The same light on every tile: the game's sun height, from front-left of the camera.
const SUN = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(SUN_DIR.y), AZ - 1.0);

// Shows one item and renders it. label: the text in the corner tag.
function show(name, label = name) {
  if (current) scene.remove(current);
  if (!name.startsWith('traffic_')) fleet.update([], camera);
  current = makers.get(name)();
  scene.add(current);
  current.updateMatrixWorld(true);
  box.setFromObject(current);
  const size = box.getSize(new THREE.Vector3());
  // The rider stands just off the prop's front-left corner, in plain view.
  rider.root.visible = !solo.has(name);
  rider.pose(POSES.upright);
  if (rider.root.visible) {
    rider.root.position.set(box.min.x - 0.6, 0, box.max.z + 0.4);
    rider.root.rotation.y = 0.5;
    rider.root.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(rider.root, true));
  }
  box.min.y = Math.max(box.min.y, 0); // foundations below the grass don't count
  box.getBoundingSphere(sphere);
  const tall = size.y / Math.max(size.x, size.z, 0.1);
  const el = THREE.MathUtils.degToRad(tall > 2 ? 10 : 16);
  const dir = new THREE.Vector3(Math.sin(AZ) * Math.cos(el), Math.sin(el), Math.cos(AZ) * Math.cos(el));
  // Fit the box's corners to the frame: step the distance and aim until they fill it.
  const c = sphere.center.clone();
  let dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const v = new THREE.Vector3();
  for (let k = 0; k < 6; k++) {
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.near = Math.max(0.02, dist / 300);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(c);
    camera.updateMatrixWorld();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of corners) {
      v.copy(p).project(camera);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    // Recentre on the projected box, then scale to fill 80% (a bit more room at the top for the tag).
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    c.addScaledVector(right, ((x0 + x1) / 2) * halfH * camera.aspect).addScaledVector(up, ((y0 + y1) / 2 - 0.04) * halfH);
    dist *= Math.max((x1 - x0) / 2 / 0.86, (y1 - y0) / 2 / 0.78);
  }
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.lookAt(c);
  // Shadow box sized to what's in shot.
  const r = Math.max(sphere.radius * 1.6, 3);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -r;
  sc.right = sc.top = r;
  sc.near = 1;
  sc.far = r * 4 + 300;
  sc.updateProjectionMatrix();
  sun.position.copy(c).addScaledVector(SUN, r * 2 + 150);
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  const [num, ...rest] = label.split(' ');
  document.getElementById('tag').innerHTML = rest.length ? `<b>${num}</b>${rest.join(' ')}` : label;
  document.getElementById('scale').textContent = `${size.x.toFixed(1)} × ${size.z.toFixed(1)} m, ${size.y.toFixed(1)} m tall · grid 1 m${rider.root.visible ? ` · rider on board ${riderH.toFixed(1)} m` : ''}`;
  return { w: +size.x.toFixed(2), d: +size.z.toFixed(2), h: +size.y.toFixed(2) };
}

window.__sheet = { items, show };
const one = new URLSearchParams(location.search).get('item');
if (one) show(one);
window.__sheetReady = true;
