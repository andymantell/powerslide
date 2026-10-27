// Longboard + rider model. The rider is drawn from the joint positions that
// RiderPose (riderpose.js) solves each frame: capsules are laid between them.
// Rig space: origin on the deck centre, +Y up, -Z towards the nose, +X is the
// direction the (regular-footed) rider faces, i.e. the toe side.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { trackLoad } from './ground.js';
import { SkeletonDriver, frameQuat } from './ik.js';
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

// Crisp, antialiased panel edges from the distance fields in the vertex
// colours: base colour, then panel colour a where R > 0.5, b where G > 0.5.
function panels(mat, base, a, b) {
  const u = {
    uBase: { value: new THREE.Color(base) },
    uPanelA: { value: new THREE.Color(a) },
    uPanelB: { value: new THREE.Color(b) },
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase, uPanelA, uPanelB;')
      .replace(
        '#include <color_fragment>',
        `vec2 pw = max(fwidth(vColor.rg), vec2(1e-4));
        vec2 pm = smoothstep(0.5 - pw, 0.5 + pw, vColor.rg);
        diffuseColor.rgb *= mix(mix(uBase, uPanelA, pm.x), uPanelB, pm.y);`,
      );
  };
  mat.customProgramCacheKey = () => 'panels';
  return mat;
}

const RIDER_URL = new URL('./assets/models/rider.glb', import.meta.url).href;
const riderParts = new GLTFLoader().loadAsync(RIDER_URL).then((gltf) => {
  const materials = {
    // One-piece race leathers: red with white (R) and black (G) panels.
    leather: panels(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.4 }), '#9e0a0c', '#dcdcd6', '#08080a'),
    helmetShell: panels(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }), '#f2f2f0', '#b00d10', '#0a0a0c'),
    visor: new THREE.MeshPhysicalMaterial({ color: '#0b0d12', metalness: 0.9, roughness: 0.06, clearcoat: 1 }),
    shoeUpper: new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.75 }),
    shoeSole: new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.85 }),
    gloveLeather: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.6 }),
    puck: new THREE.MeshStandardMaterial({ color: '#1f5fd6', roughness: 0.35 }),
  };
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = materials[o.material.name] ?? o.material;
    o.castShadow = true;
    if (o.isSkinnedMesh) {
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  return gltf.scene;
});
trackLoad(riderParts);

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _e = new THREE.Euler();
const _hq = new THREE.Quaternion();
const HEAD_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const FOOT_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

// Which way a limb's middle joint sticks out from the line between its ends
// (knee forward, elbow back), falling back to `fallback` when it's straight.
function bendDir(a, b, c, fallback, out) {
  _ac.subVectors(c, a);
  out.subVectors(b, a);
  out.addScaledVector(_ac, -out.dot(_ac) / Math.max(_ac.lengthSq(), 1e-8));
  return out.addScaledVector(fallback, 0.01);
}

// The head's orientation: the helmet is modelled facing +X and RiderPose's
// head angles turn a head that faces -Z. A ragdoll sets headQ outright.
function headQuat(pose, out) {
  if (pose.headQ) return out.copy(pose.headQ);
  _e.set(pose.headPitch, pose.headYaw, pose.headRoll ?? 0, 'YXZ');
  return out.setFromEuler(_e).multiply(HEAD_TURN);
}

const aim = (from, to, ref, out) => {
  out.pos.copy(from);
  frameQuat(_d.subVectors(to, from).normalize(), ref, out.q);
  return out;
};
const sideways = (J, s) => _r.subVectors(J['hipR'], J['hipF']).normalize().multiplyScalar(s);

// How the skinned rider's bones (tools/blender/rider.py) follow a RiderPose:
// each bone starts at its joint, aims at the next one and twists to keep the
// body square: pelvis and chest to the hips and shoulders, knees and elbows to
// the way they bend, head, hands and feet to their own angles.
const limb = (a, b, c, from, to, fallback, at = from) => (p, out) => {
  const J = p.joints;
  aim(J[from], J[to], bendDir(J[a], J[b], J[c], fallback(p), _bend), out);
  out.pos.copy(J[at]);
  return out;
};
const facing = (p) => p.chestFacing;
const behind = (p) => _r.copy(p.chestFacing).negate();
const clav = (p) => _r.copy(p.joints.chest).addScaledVector(p.torsoDir, -0.03);
// A planted hand bends flat at the wrist, fingers out along the road and the
// puck on the palm down on the tarmac.
const PALM_REF = new THREE.Vector3(0, 1, 0);
const _pq = new THREE.Quaternion();
const handFrame = (s) => {
  const arm = limb('sh' + s, 'el' + s, 'ha' + s, 'el' + s, 'ha' + s, behind, 'ha' + s);
  return (p, out) => {
    arm(p, out);
    const k = p['plant' + s] ?? 0;
    if (k > 0) out.q.slerp(frameQuat(p.plantDir, PALM_REF, _pq), k);
    return out;
  };
};
const footFrame = (s) => (p, out) => {
  out.pos.copy(p.joints['foot' + s]);
  if (p['footQ' + s]) {
    out.q.copy(p['footQ' + s]);
    return out;
  }
  _e.set(0, p['footYaw' + s], p['footRoll' + s], 'ZYX');
  out.q.setFromEuler(_e).multiply(FOOT_TURN);
  return out;
};
export const RIDER_RIG = {
  hips: (p, out) => {
    out.pos.copy(p.joints.hip);
    _d.copy(p.bodyUp).lerp(p.torsoDir, 0.35).normalize();
    frameQuat(_d, sideways(p.joints, 1), out.q);
    return out;
  },
  spine: (p, out) => {
    const J = p.joints;
    _s.subVectors(J.shR, J.shF).normalize().add(sideways(J, 1));
    return aim(J.hip, J.chest, _s, out);
  },
  chest: (p, out) => aim(p.joints.chest, p.joints.neck, _s.subVectors(p.joints.shR, p.joints.shF), out),
  neck: (p, out) => {
    const J = p.joints;
    _s.set(0, 0, 1).applyQuaternion(headQuat(p, _hq)).add(_r.subVectors(J.shR, J.shF).normalize());
    return aim(J.neck, J.head, _s, out);
  },
  head: (p, out) => {
    out.pos.copy(p.joints.head);
    headQuat(p, out.q);
    return out;
  },
  thighF: limb('hipF', 'kneeF', 'footF', 'hipF', 'kneeF', facing),
  shinF: limb('hipF', 'kneeF', 'footF', 'kneeF', 'footF', facing),
  footF: footFrame('F'),
  thighR: limb('hipR', 'kneeR', 'footR', 'hipR', 'kneeR', facing),
  shinR: limb('hipR', 'kneeR', 'footR', 'kneeR', 'footR', facing),
  footR: footFrame('R'),
  clavF: (p, out) => aim(clav(p), p.joints.shF, _s.copy(p.torsoDir), out),
  upperArmF: limb('shF', 'elF', 'haF', 'shF', 'elF', behind),
  forearmF: limb('shF', 'elF', 'haF', 'elF', 'haF', behind),
  handF: handFrame('F'),
  clavR: (p, out) => aim(clav(p), p.joints.shR, _s.copy(p.torsoDir), out),
  upperArmR: limb('shR', 'elR', 'haR', 'shR', 'elR', behind),
  forearmR: limb('shR', 'elR', 'haR', 'elR', 'haR', behind),
  handR: handFrame('R'),
};

// The bind pose of rider.glb as a RiderPose: joints at the bone heads,
// standing square, head and feet turned to face +X.
function bindPose(bones, rigSpace) {
  const joints = {};
  const heads = {
    hip: 'hips', hipF: 'thighF', hipR: 'thighR', kneeF: 'shinF', kneeR: 'shinR', footF: 'footF', footR: 'footR',
    chest: 'chest', neck: 'neck', head: 'head', shF: 'upperArmF', shR: 'upperArmR', elF: 'forearmF',
    elR: 'forearmR', haF: 'handF', haR: 'handR',
  };
  rigSpace.updateMatrixWorld(true);
  for (const [j, b] of Object.entries(heads)) joints[j] = rigSpace.worldToLocal(bones[b].getWorldPosition(new THREE.Vector3()));
  const up = new THREE.Vector3(0, 1, 0);
  return {
    joints, torsoDir: up, bodyUp: up, chestFacing: new THREE.Vector3(1, 0, 0),
    headPitch: 0, headYaw: -Math.PI / 2, headRoll: 0,
    footYawF: Math.PI / 2, footYawR: Math.PI / 2, footRollF: 0, footRollR: 0,
  };
}

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
  if (!ctx) return null; // headless (tools/sim.mjs)
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

// A bib-sized patch draped onto the skinned mesh (in its bind pose), seen
// from +X (side 1) or -X (side -1) of rig space; returns rig-space geometry.
function conform(body, rigSpace, centre, side) {
  const geo = new THREE.PlaneGeometry(0.2, 0.22, 10, 11);
  // The plane faces +Z; turn it to face +X or -X.
  geo.rotateY((side * Math.PI) / 2);
  geo.translate(centre.x, centre.y, centre.z);
  const pos = geo.attributes.position;
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3(-side, 0, 0).transformDirection(rigSpace.matrixWorld);
  const p = new THREE.Vector3();
  rigSpace.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    p.x += side * 0.4;
    ray.set(rigSpace.localToWorld(p), dir);
    const hit = ray.intersectObject(body)[0];
    if (!hit) continue;
    p.copy(hit.point).addScaledVector(dir, -0.006);
    rigSpace.worldToLocal(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
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
    const bibMat = new THREE.MeshStandardMaterial({ map: makeBibTexture(), color: '#f4f2ea', roughness: 0.7, side: THREE.DoubleSide });
    this.m.bibFront = new THREE.Mesh(bibGeo, bibMat);
    this.m.bibBack = new THREE.Mesh(bibGeo, bibMat);
    this.rig.add(this.m.bibFront, this.m.bibBack);
    for (const k of ['shoeF', 'shoeR', 'handF', 'handR']) {
      this.m[k].castShadow = true;
      this.rig.add(this.m[k]);
    }
    this.rig.add(this.head);
    riderParts.then((parts) => this.useModel(parts));
  }

  // Swaps the capsule stand-in for the skinned model from tools/blender/rider.py.
  // The helmet, shoes and gloves hang off the head, foot and hand bones.
  useModel(model) {
    const scene = cloneSkinned(model);
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    if (!bones.hips) return;
    this.rig.add(scene);
    const bind = bindPose(bones, this.rig);
    this.driver = new SkeletonDriver(this.rig, bones, RIDER_RIG, bind);
    for (const k of Object.keys(this.m)) this.m[k].visible = false;
    this.head.clear();
    let body = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh) body = o;
    });
    // Bibs moulded onto the leathers (front and back), riding on the chest.
    const centre = bind.joints.chest.clone().add(new THREE.Vector3(0, -0.07, 0));
    for (const side of [1, -1]) {
      const bib = this.m[side > 0 ? 'bibFront' : 'bibBack'];
      const geo = conform(body, this.rig, centre, side);
      const mesh = new THREE.Mesh(geo, bib.material);
      this.rig.add(mesh);
      bones.chest.attach(mesh);
    }
  }

  // Solve and show a pose; see RiderPose.solve for the parameters.
  pose(p) {
    this.applyPose(this.solver.solve(p));
  }

  applyPose(pose) {
    const J = pose.joints;
    const m = this.m;
    this.head.position.copy(J.head);
    this.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll ?? 0, 'YXZ');
    if (this.driver) {
      this.driver.apply(pose);
      return;
    }
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
  }

  spinWheels(dist) {
    for (const w of this.wheels) w.rotation.x -= dist / WHEEL_R;
  }
}
