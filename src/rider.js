// Longboard + rider model. The rider is a procedural rig: joints are computed
// each frame (2-bone IK for arms and legs) and capsules are laid between them.
// Rig space: origin on the deck centre, +Y up, -Z towards the nose, +X is the
// direction the (regular-footed) rider faces, i.e. the toe side.

import * as THREE from 'three';

export const DECK_HEIGHT = 0.115; // deck top above the road
export const WHEEL_R = 0.036;

const THIGH = 0.46;
const SHIN = 0.45;
const UPPER_ARM = 0.3;
const FOREARM = 0.29;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _ik1 = new THREE.Vector3();
const _ik2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function ik(root, target, l1, l2, pole, outJoint, outEnd) {
  _ik1.subVectors(target, root);
  let dist = _ik1.length();
  const dir = _ik1.multiplyScalar(1 / Math.max(dist, 1e-6));
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.001);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _ik2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  outJoint.copy(root).addScaledVector(dir, a).addScaledVector(_ik2, h);
  outEnd.copy(root).addScaledVector(dir, dist);
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
    this.deck = new THREE.Group(); // rolls with lean
    this.lean = new THREE.Group(); // rider body lean about the feet
    this.rig = new THREE.Group();
    this.root.add(this.board);
    this.board.add(this.deck);
    this.deck.add(this.lean);
    this.lean.add(this.rig);
    this.lean.position.y = DECK_HEIGHT;
    this.wheels = [];
    this.buildBoard();
    this.buildRider();
    this.joints = {};
    for (const k of [
      'hip', 'hipF', 'hipR', 'kneeF', 'kneeR', 'footF', 'footR', 'chest', 'neck', 'head',
      'shF', 'shR', 'elF', 'elR', 'haF', 'haR',
    ]) this.joints[k] = new THREE.Vector3();
    this.pose({});
  }

  buildBoard() {
    const deckMat = new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.7 });
    const gripMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 1 });
    const truckMat = new THREE.MeshStandardMaterial({ color: '#b8bcc2', metalness: 0.8, roughness: 0.35 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#f2a03a', roughness: 0.55 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.98), deckMat);
    deck.position.y = DECK_HEIGHT - 0.007;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.232, 0.002, 0.96), gripMat);
    grip.position.y = DECK_HEIGHT + 0.001;
    deck.castShadow = true;
    this.deck.add(deck, grip);
    // Rounded nose/tail.
    for (const z of [-0.49, 0.49]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.014, 16, 1, false, 0, Math.PI), deckMat);
      cap.position.set(0, DECK_HEIGHT - 0.007, z);
      cap.rotation.y = z < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.deck.add(cap);
    }
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.052, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.054, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: '#333', metalness: 0.5 });
    for (const z of [-0.36, 0.36]) {
      const truck = new THREE.Group();
      truck.position.set(0, WHEEL_R, z);
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), truckMat);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.07), truckMat);
      base.position.y = 0.035;
      truck.add(hanger, base);
      for (const x of [-0.125, 0.125]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.x = x;
        w.castShadow = true;
        w.add(new THREE.Mesh(hubGeo, hubMat));
        truck.add(w);
        this.wheels.push(w);
      }
      this.board.add(truck);
    }
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
    for (const k of ['shoeF', 'shoeR', 'handF', 'handR']) {
      this.m[k].castShadow = true;
      this.rig.add(this.m[k]);
    }
    this.rig.add(this.head);
  }

  // p: { crouch 0..1, tuck 0..1, leanX, leanZ (rad), slideHand -1/0/1,
  //      handTargetLocal (Vector3|null), spread 0..1 (air brake), brake 0..1, push 0..1, pushPhase, limp 0..1, lookYaw }
  pose(p) {
    const crouch = p.crouch ?? 0.15;
    const tuck = p.tuck ?? 0;
    const spread = p.spread ?? 0;
    const J = this.joints;
    // Riding fakie is handled by rotating the whole rig; only the head differs.
    const fakie = 1;
    const footZF = -0.26 * fakie;
    const footZR = 0.25 * fakie;

    // Hips.
    const bend = Math.max(crouch, tuck * 0.85);
    const hipY = 0.93 - bend * 0.42 - tuck * 0.05;
    J.hip.set(-0.04 - tuck * 0.05 - bend * 0.06, hipY, (footZF + footZR) * 0.5 + tuck * 0.08 * fakie);
    J.hipF.copy(J.hip).add(_d.set(0, 0, -0.1 * fakie));
    J.hipR.copy(J.hip).add(_d.set(0, 0, 0.1 * fakie));

    // Feet: front stays planted; rear may push or footbrake.
    J.footF.set(0.02, 0.05, footZF);
    J.footR.set(0.02, 0.05, footZR);
    const lift = Math.max(p.brake ?? 0, p.push ?? 0);
    if (lift > 0) {
      let tz = footZR + 0.25 * fakie;
      let tx = 0.28;
      if (p.push) {
        const ph = Math.sin(p.pushPhase ?? 0);
        tz = footZR + (0.1 + ph * 0.45) * fakie;
        tx = 0.26;
      }
      J.footR.lerp(_d.set(tx, -DECK_HEIGHT + 0.04, tz), lift);
    }
    ik(J.hipF, J.footF, THIGH, SHIN, _pole.set(1, 0, 0), J.kneeF, J.footF);
    ik(J.hipR, J.footR, THIGH, SHIN, _pole.set(1, 0, 0.2 * fakie), J.kneeR, J.footR);

    // Torso: upright, folding forward over the front knee when tucked.
    const tdir = _d.set(0.15 + bend * 0.25, 1, 0);
    tdir.lerp(_a.set(0.32, 0.38, -0.86 * fakie), tuck);
    // Air brake: stand tall and lean back a touch into the wind.
    tdir.lerp(_a.set(0.04, 1, 0.18 * fakie), spread);
    if (p.limp) tdir.lerp(_a.set(0.9, 0.2, 0.2), p.limp);
    tdir.normalize();
    J.chest.copy(J.hip).addScaledVector(tdir, 0.5);
    J.neck.copy(J.hip).addScaledVector(tdir, 0.6);
    J.head.copy(J.hip).addScaledVector(tdir, 0.78);
    J.shF.copy(J.chest).add(_a.set(0, 0, -0.19 * fakie));
    J.shR.copy(J.chest).add(_a.set(0, 0, 0.19 * fakie));
    J.shF.addScaledVector(tdir, -0.03);
    J.shR.addScaledVector(tdir, -0.03);

    // Hands.
    const handF = _b.copy(J.shF).add(_a.set(0.18, -0.48, -0.08 * fakie));
    const handR = _e.copy(J.shR).add(_a.set(0.12, -0.5, 0.12 * fakie));
    if (tuck > 0) {
      // Hands tucked behind the back.
      handF.lerp(_a.copy(J.hip).add(_d.set(-0.2, 0.12, 0.05 * fakie)), tuck);
      handR.lerp(_a.copy(J.hip).add(_d.set(-0.2, 0.08, 0.15 * fakie)), tuck);
    }
    if (spread > 0) {
      // Arms flung wide, across the wind, to catch as much air as possible.
      handF.lerp(_a.copy(J.shF).add(_d.set(0.52, 0.12, -0.12 * fakie)), spread);
      handR.lerp(_a.copy(J.shR).add(_d.set(-0.48, 0.12, 0.12 * fakie)), spread);
    }
    if (p.handTargetLocal && p.slideHand) {
      // The hand on the leaning side goes to the ground (puck down).
      const target = p.handTargetLocal;
      if (p.slideHand > 0) handF.lerp(target, p.handAmount ?? 1);
      else handR.lerp(target, p.handAmount ?? 1);
    }
    if (p.limp) {
      handF.lerp(_a.copy(J.chest).add(_d.set(0.4, 0.3, -0.3)), p.limp);
      handR.lerp(_a.copy(J.chest).add(_d.set(0.4, 0.2, 0.3)), p.limp);
    }
    ik(J.shF, handF, UPPER_ARM, FOREARM, _pole.set(-0.3, -0.2, -1 * fakie), J.elF, J.haF);
    ik(J.shR, handR, UPPER_ARM, FOREARM, _pole.set(-0.6, -0.2, 1 * fakie), J.elR, J.haR);

    const m = this.m;
    place(m.thighF, J.hipF, J.kneeF);
    place(m.thighR, J.hipR, J.kneeR);
    place(m.shinF, J.kneeF, J.footF);
    place(m.shinR, J.kneeR, J.footR);
    place(m.torso, _a.copy(J.hip).addScaledVector(tdir, 0.08), J.neck);
    place(m.pelvis, J.hipF, J.hipR);
    place(m.upF, J.shF, J.elF);
    place(m.upR, J.shR, J.elR);
    place(m.loF, J.elF, J.haF);
    place(m.loR, J.elR, J.haR);
    m.shoeF.position.copy(J.footF).add(_a.set(0.03, -0.02, 0));
    m.shoeR.position.copy(J.footR).add(_a.set(0.03, -0.02, 0));
    m.shoeF.rotation.set(0, Math.PI / 2 - 0.25, 0);
    m.shoeR.rotation.set(0, Math.PI / 2 + 0.15, 0);
    m.handF.position.copy(J.haF);
    m.handR.position.copy(J.haR);
    this.head.position.copy(J.head);
    // Look down the hill (rig -Z, or +Z when riding fakie), with optional yaw.
    this.head.rotation.set(-0.15 - tuck * 0.2 + (p.limp ? 0.8 : 0), (p.lookYaw ?? 0) + (p.fakie ? Math.PI : 0), 0);
  }

  spinWheels(dist) {
    for (const w of this.wheels) w.rotation.x -= dist / WHEEL_R;
  }
}
