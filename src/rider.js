// Longboard + rider model. The rider is drawn from the joint positions that
// RiderPose (riderpose.js) solves each frame: capsules are laid between them.
// Rig space: origin on the deck centre, +Y up, -Z towards the nose, +X is the
// direction the (regular-footed) rider faces, i.e. the toe side.

import * as THREE from 'three';
import { RiderPose, DECK_HEIGHT, THIGH, SHIN, UPPER_ARM, FOREARM } from './riderpose.js';

export { DECK_HEIGHT };
export const WHEEL_R = 0.036;
export const TRUCK_Z = 0.36; // visual truck positions (front at -Z)

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

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
    for (const z of [-TRUCK_Z, TRUCK_Z]) {
      const truck = new THREE.Group();
      truck.position.set(0, WHEEL_R, z);
      this.trucks.push(truck);
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
    this.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll ?? 0, 'YXZ');
  }

  spinWheels(dist) {
    for (const w of this.wheels) w.rotation.x -= dist / WHEEL_R;
  }
}
