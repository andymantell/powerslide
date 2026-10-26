// Longboard + rider model. The rider is drawn from the joint positions that
// RiderPose (riderpose.js) solves each frame: capsules are laid between them.
// Rig space: origin on the deck centre, +Y up, -Z towards the nose, +X is the
// direction the (regular-footed) rider faces, i.e. the toe side.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackLoad } from './ground.js';
import { RiderPose, DECK_HEIGHT, THIGH, SHIN, UPPER_ARM, FOREARM } from './riderpose.js';

export { DECK_HEIGHT };
export const WHEEL_R = 0.036;
export const TRUCK_Z = 0.36; // visual truck positions (front at -Z)

const BOARD_URL = new URL('./assets/models/board.glb', import.meta.url).href;
const tex = (n) => {
  const t = new THREE.TextureLoader().load(new URL(`./assets/textures/${n}.webp`, import.meta.url).href);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// Real materials for the named placeholder materials in board.glb.
function boardMaterial(name) {
  switch (name) {
    case 'grip':
      return new THREE.MeshStandardMaterial({ map: tex('deck_grip'), roughness: 1 });
    case 'graphic':
      return new THREE.MeshStandardMaterial({ map: tex('deck_graphic'), roughness: 0.45 });
    case 'wood':
      return new THREE.MeshStandardMaterial({ color: '#c8a070', roughness: 0.7 });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.32 });
    case 'bushing':
      return new THREE.MeshStandardMaterial({ color: '#e8742a', roughness: 0.6 });
    case 'urethane':
      // Translucent-looking orange urethane with a slightly worn, matte contact patch.
      return new THREE.MeshPhysicalMaterial({ color: '#f39a2e', roughness: 0.5, sheen: 0.4, sheenColor: '#ffd8a0', clearcoat: 0.3, clearcoatRoughness: 0.5 });
    case 'core':
      return new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4 });
    default:
      return new THREE.MeshStandardMaterial({ color: '#888' });
  }
}

// Loads once; every RiderModel shares the geometry and materials.
const boardParts = new GLTFLoader().loadAsync(BOARD_URL).then((gltf) => {
  const parts = {};
  const mats = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh && !o.isGroup) return;
    const name = o.name.replace(/_\d+$/, '');
    if (!['deck', 'truck', 'wheel'].includes(name) || parts[name]) return;
    // Multi-material meshes import as a group of primitives: merge them back.
    const meshes = o.isMesh ? [o] : o.children.filter((c) => c.isMesh);
    const geos = meshes.map((m) => m.geometry);
    // Merging needs matching attributes; parts without UVs don't need any.
    for (const k of ['uv', 'uv1', 'tangent']) {
      if (!geos.every((g) => g.attributes[k])) geos.forEach((g) => g.deleteAttribute(k));
    }
    const geometry = geos.length > 1 ? mergeGeometries(geos, true) : geos[0];
    const material = meshes.map((m) => {
      const n = m.material.name;
      if (!mats.has(n)) mats.set(n, boardMaterial(n));
      return mats.get(n);
    });
    parts[name] = { geometry, material: material.length > 1 ? material : material[0] };
  });
  return parts;
});
trackLoad(boardParts);

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

const _bx = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();

function makeBibTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 140;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f4f2ea';
  ctx.fillRect(0, 0, 128, 140);
  ctx.fillStyle = '#c8262e';
  ctx.fillRect(0, 0, 128, 18);
  ctx.fillStyle = '#16161a';
  ctx.font = 'bold 92px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('7', 64, 84);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function place(mesh, a, b) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  _c.subVectors(b, a).normalize();
  mesh.quaternion.setFromUnitVectors(Y, _c);
}

export class RiderModel {
  constructor() {
    this.root = new THREE.Group(); // positioned on the road, yaw + slope
    this.board = new THREE.Group(); // deck, trucks, wheels
    this.deck = new THREE.Group(); // rolls on the trucks
    this.body = new THREE.Group(); // rider, at deck height (not rolled)
    this.rig = new THREE.Group(); // rig space; turned round when riding fakie
    this.root.add(this.board, this.body);
    this.board.add(this.deck);
    this.body.add(this.rig);
    this.body.position.y = DECK_HEIGHT;
    this.wheels = [];
    this.trucks = []; // [front, rear]; rotation.y steers them
    this.buildBoard();
    this.buildRider();
    this.solver = new RiderPose();
    this.joints = this.solver.joints;
    this.pose({});
  }

  // The board model comes from tools/blender/board.py. The groups exist from
  // the start (physics steers trucks and spins wheels); meshes arrive once
  // the model has loaded.
  buildBoard() {
    for (const z of [-TRUCK_Z, TRUCK_Z]) {
      const truck = new THREE.Group();
      truck.position.set(0, WHEEL_R, z);
      this.trucks.push(truck);
      for (const x of [-0.125, 0.125]) {
        const w = new THREE.Group();
        w.position.x = x;
        truck.add(w);
        this.wheels.push(w);
      }
      this.board.add(truck);
    }
    boardParts.then((parts) => {
      const deck = new THREE.Mesh(parts.deck.geometry, parts.deck.material);
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.deck.add(deck);
      this.trucks.forEach((truck, i) => {
        const t = new THREE.Mesh(parts.truck.geometry, parts.truck.material);
        // Reverse-kingpin: both kingpins face the middle of the board.
        if (i === 0) t.rotation.y = Math.PI;
        t.castShadow = true;
        truck.add(t);
      });
      for (const w of this.wheels) {
        const m = new THREE.Mesh(parts.wheel.geometry, parts.wheel.material);
        m.castShadow = true;
        w.add(m);
      }
    });
  }

  buildRider() {
    const suit = new THREE.MeshStandardMaterial({ color: '#c8262e', roughness: 0.55 });
    const suit2 = new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1b1f', roughness: 0.6 });
    const glove = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.8 });
    const helmet = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.25, metalness: 0.1 });
    const visor = new THREE.MeshStandardMaterial({ color: '#18222e', roughness: 0.05, metalness: 0.8 });
    const cap = (r, len, mat) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.castShadow = true;
      this.rig.add(m);
      return m;
    };
    this.m = {
      thighF: cap(0.075, THIGH, suit),
      thighR: cap(0.075, THIGH, suit),
      shinF: cap(0.06, SHIN, suit2),
      shinR: cap(0.06, SHIN, suit2),
      torso: cap(0.16, 0.34, suit),
      pelvis: cap(0.12, 0.12, dark),
      upF: cap(0.05, UPPER_ARM, suit2),
      upR: cap(0.05, UPPER_ARM, suit2),
      loF: cap(0.045, FOREARM, suit),
      loR: cap(0.045, FOREARM, suit),
    };
    const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.27);
    this.m.shoeF = new THREE.Mesh(shoe, dark);
    this.m.shoeR = new THREE.Mesh(shoe, dark);
    const hand = new THREE.SphereGeometry(0.06, 10, 8);
    this.m.handF = new THREE.Mesh(hand, glove);
    this.m.handR = new THREE.Mesh(hand, glove);
    // Slide puck on the palm.
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), new THREE.MeshStandardMaterial({ color: '#2d6cdf' }));
    puck.position.y = -0.05;
    this.m.handF.add(puck);
    this.m.handR.add(puck.clone());
    this.head = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), helmet);
    shell.scale.set(1, 1, 1.08);
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.152, 18, 10, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3), visor);
    vis.rotation.y = Math.PI; // faces -Z
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.08), helmet);
    chin.position.set(0, -0.1, -0.1);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 24, Math.PI), suit);
    stripe.rotation.y = Math.PI / 2;
    this.head.add(shell, vis, chin, stripe);
    shell.castShadow = true;
    // Race bibs on chest and back, so you can see which way the body faces.
    const bibGeo = new THREE.PlaneGeometry(0.2, 0.22);
    const bibMat = new THREE.MeshStandardMaterial({ map: makeBibTexture(), roughness: 0.7, side: THREE.DoubleSide });
    this.m.bibFront = new THREE.Mesh(bibGeo, bibMat);
    this.m.bibBack = new THREE.Mesh(bibGeo, bibMat);
    this.rig.add(this.m.bibFront, this.m.bibBack);
    for (const k of ['shoeF', 'shoeR', 'handF', 'handR']) {
      this.m[k].castShadow = true;
      this.rig.add(this.m[k]);
    }
    this.rig.add(this.head);
  }

  // Solve and show a pose; see RiderPose.solve for the parameters.
  pose(p) {
    this.applyPose(this.solver.solve(p));
  }

  applyPose(pose) {
    const J = pose.joints;
    const m = this.m;
    place(m.thighF, J.hipF, J.kneeF);
    place(m.thighR, J.hipR, J.kneeR);
    place(m.shinF, J.kneeF, J.footF);
    place(m.shinR, J.kneeR, J.footR);
    place(m.torso, _a.copy(J.hip).addScaledVector(pose.torsoDir, 0.08), J.neck);
    place(m.pelvis, J.hipF, J.hipR);
    place(m.upF, J.shF, J.elF);
    place(m.upR, J.shR, J.elR);
    place(m.loF, J.elF, J.haF);
    place(m.loR, J.elR, J.haR);
    m.shoeF.position.copy(J.footF).add(_a.set(0.03, -0.02, 0));
    m.shoeR.position.copy(J.footR).add(_a.set(0.03, -0.02, 0));
    m.shoeF.rotation.set(0, pose.footYawF, pose.footRollF, 'ZYX');
    m.shoeR.rotation.set(0, pose.footYawR, pose.footRollR, 'ZYX');
    m.handF.position.copy(J.haF);
    m.handR.position.copy(J.haR);
    this.head.position.copy(J.head);
    // Bibs sit on the torso surface, facing the way the chest points.
    const up = pose.torsoDir;
    _bz.copy(pose.chestFacing).addScaledVector(up, -pose.chestFacing.dot(up)).normalize();
    _bx.crossVectors(up, _bz);
    _bm.makeBasis(_bx, up, _bz);
    for (const [bib, side] of [[m.bibFront, 1], [m.bibBack, -1]]) {
      bib.quaternion.setFromRotationMatrix(_bm);
      if (side < 0) bib.rotateY(Math.PI);
      bib.position.copy(J.chest).addScaledVector(up, -0.06).addScaledVector(_bz, 0.163 * side);
    }
    this.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll ?? 0, 'YXZ');
  }

  spinWheels(dist) {
    for (const w of this.wheels) w.rotation.x -= dist / WHEEL_R;
  }
}
