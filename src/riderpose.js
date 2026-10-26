// Rider body pose, solved from the physics state and independent of how the
// rider is drawn. Feet stay planted on the deck (which rolls on the trucks),
// the centre of mass leans with the balance model in player.js, and IK fills
// in knees and elbows. The result is a set of joint positions in rig space
// that any model can follow: RiderModel lays capsules between them, and
// SkeletonDriver (ik.js) aims the bones of a skinned rig at them.
//
// Rig space: +Y up with y = 0 at the deck top (deck level, not rolled),
// -Z towards the nose, +X the way the rider faces (toe side). Riding fakie is
// handled outside by turning the rig round, so the stance here never changes.

import * as THREE from 'three';
import { twoBoneIK } from './ik.js';

export const DECK_HEIGHT = 0.115; // deck top above the road
export const THIGH = 0.46;
export const SHIN = 0.45;
export const UPPER_ARM = 0.3;
export const FOREARM = 0.29;
export const FOOT_Z_FRONT = -0.26;
export const FOOT_Z_REAR = 0.25;
const PIVOT_Y = -0.06; // trucks' roll axis, relative to the deck top
const ANKLE = 0.05; // ankle above the sole
const GROUND = -DECK_HEIGHT;

export const JOINT_NAMES = [
  'hip', 'hipF', 'hipR', 'kneeF', 'kneeR', 'footF', 'footR', 'chest', 'neck', 'head',
  'shF', 'shR', 'elF', 'elR', 'haF', 'haR',
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Y_DOWN = new THREE.Vector3(0, -1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// A point on the deck surface (x across, z along), after the deck rolls by
// `roll` (positive dips the toe edge) about the truck pivot axis.
function deckPoint(x, z, roll, height, out) {
  const c = Math.cos(roll), s = Math.sin(roll);
  const y = -PIVOT_Y + height;
  return out.set(x * c + y * s, -x * s + y * c + PIVOT_Y, z);
}

export class RiderPose {
  constructor() {
    this.joints = {};
    for (const k of JOINT_NAMES) this.joints[k] = new THREE.Vector3();
    this.headYaw = 0;
    this.headPitch = 0;
    this.footYawF = Math.PI / 2 - 0.25;
    this.footYawR = Math.PI / 2 + 0.15;
    this.footRollF = 0; // soles follow the deck roll
    this.footRollR = 0;
    this.torsoDir = new THREE.Vector3(0, 1, 0);
    this.chestFacing = new THREE.Vector3(1, 0, 0); // which way the chest points
  }

  // p (all optional):
  //  roll    deck roll, rad (+ = toe edge down)
  //  lean    centre-of-mass lean from vertical, rad (+ = towards the toes)
  //  pitch   fore/aft body lean, rad (+ = towards the nose)
  //  weight  -1..1 weight shift (+ = onto the front foot)
  //  crouch, tuck, spread (air brake), brake (footbrake), push 0..1
  //  pushPhase 0..1 through one push stroke
  //  slideHand -1/0/1 which hand goes down, handAmount 0..1, handTarget (Vector3, rig space)
  //  lookYaw (rad), fakie (head looks the other way), limp 0..1 (crashed)
  solve(p) {
    const J = this.joints;
    const roll = p.roll ?? 0;
    const lean = p.lean ?? 0;
    const pitch = p.pitch ?? 0;
    const tuck = p.tuck ?? 0;
    const spread = p.spread ?? 0;
    const push = p.push ?? 0;
    const brake = p.brake ?? 0;
    const limp = p.limp ?? 0;
    const crouch = Math.min(1, (p.crouch ?? 0.15) + push * 0.35);
    const weight = p.weight ?? 0;

    // Feet planted on the rolling deck.
    deckPoint(0.02, FOOT_Z_FRONT, roll, ANKLE, J.footF);
    deckPoint(0.02, FOOT_Z_REAR, roll, ANKLE, J.footR);
    this.footRollF = this.footRollR = -roll;

    // The body leans as one about the line through the feet (the balance
    // model in player.js decides the angle); hips drop as the rider bends.
    const bend = Math.max(crouch, tuck * 0.85);
    const hipH = 0.82 - bend * 0.42 - tuck * 0.05;
    _q.setFromAxisAngle(Z, -lean);
    _qx.setFromAxisAngle(X, -pitch);
    _q.multiply(_qx);
    const midZ = (FOOT_Z_FRONT + FOOT_Z_REAR) * 0.5 + tuck * 0.08 - weight * 0.11;
    _a.set(-0.04 - tuck * 0.05 - bend * 0.06 - spread * 0.03, hipH, 0).applyQuaternion(_q);
    J.hip.set(0, ANKLE, midZ).add(_a);
    // Air brake: the chest turns square to the road ahead, and the hips
    // follow it part of the way (the feet stay planted sideways).
    const twist = spread * 1.4;
    _n.set(0, 0, -0.1).applyQuaternion(_q);
    if (twist) _n.applyAxisAngle(Y, twist * 0.3);
    J.hipF.copy(J.hip).add(_n);
    J.hipR.copy(J.hip).sub(_n);

    // Rear foot leaves the deck to push or drag a footbrake.
    const lift = Math.max(brake, push);
    if (lift > 0) {
      if (push >= brake) {
        // Plant ahead of the rear truck, drive back, then swing forward again.
        const ph = p.pushPhase ?? 0;
        const contact = ph < 0.6;
        const k = contact ? ph / 0.6 : (ph - 0.6) / 0.4;
        const z = contact ? THREE.MathUtils.lerp(-0.05, 0.6, k) : THREE.MathUtils.lerp(0.6, -0.05, k);
        const y = contact ? GROUND + ANKLE : GROUND + ANKLE + Math.sin(k * Math.PI) * 0.14;
        _b.set(0.27, y, z);
      } else {
        _b.set(0.28, GROUND + ANKLE, FOOT_Z_REAR + 0.22);
      }
      J.footR.lerp(_b, lift);
      this.footRollR = -roll * (1 - lift);
    }
    twoBoneIK(J.hipF, J.footF, THIGH, SHIN, _pole.set(1, 0, -0.1).applyQuaternion(_q), J.kneeF, J.footF);
    twoBoneIK(J.hipR, J.footR, THIGH, SHIN, _pole.set(1, 0, 0.2).applyQuaternion(_q), J.kneeR, J.footR);

    // Torso: upright, folding over the front knee in a tuck, standing tall and
    // leaning back into the wind for an air brake.
    const t = this.torsoDir.set(0.15 + bend * 0.25, 1, 0);
    t.lerp(_a.set(0.32, 0.38, -0.86), tuck);
    t.lerp(_a.set(0.04, 1, 0.18), spread);
    t.lerp(_a.set(0.35, 1, -0.25), push * 0.6);
    t.normalize().applyQuaternion(_q);
    if (limp) t.lerp(_a.set(0.9, 0.2, 0.2), limp).normalize();
    J.chest.copy(J.hip).addScaledVector(t, 0.5);
    J.neck.copy(J.hip).addScaledVector(t, 0.6);
    J.head.copy(J.hip).addScaledVector(t, 0.78);
    _n.set(0, 0, -0.19).applyQuaternion(_q);
    if (twist) _n.applyAxisAngle(t, twist);
    this.chestFacing.set(1, 0, 0).applyQuaternion(_q);
    if (twist) this.chestFacing.applyAxisAngle(t, twist);
    J.shF.copy(J.chest).add(_n).addScaledVector(t, -0.03);
    J.shR.copy(J.chest).sub(_n).addScaledVector(t, -0.03);

    // Hands: relaxed by the sides, behind the back in a tuck, wide for the air
    // brake, swinging for balance while pushing, and puck down in a slide.
    const handF = _b.copy(J.shF).add(_a.set(0.18, -0.48, -0.08).applyQuaternion(_q));
    const handR = _c.copy(J.shR).add(_a.set(0.12, -0.5, 0.12).applyQuaternion(_q));
    if (tuck > 0) {
      handF.lerp(_a.copy(J.hip).add(_n.set(-0.2, 0.12, 0.05).applyQuaternion(_q)), tuck);
      handR.lerp(_a.copy(J.hip).add(_n.set(-0.2, 0.08, 0.15).applyQuaternion(_q)), tuck);
    }
    if (spread > 0) {
      // Arms out wide to the sides, a touch above the shoulders and slightly
      // back, like wings catching the wind.
      const wide = (sh, out) => {
        _n.subVectors(sh, J.chest).normalize();
        return out.copy(sh).addScaledVector(_n, 0.56).addScaledVector(t, 0.07).addScaledVector(this.chestFacing, -0.1);
      };
      handF.lerp(wide(J.shF, _a), spread);
      handR.lerp(wide(J.shR, _a), spread);
    }
    if (push > 0) {
      const sw = Math.sin((p.pushPhase ?? 0) * Math.PI * 2) * 0.22;
      handF.lerp(_a.copy(J.shF).add(_n.set(0.3, -0.42, -0.1 + sw)), push * 0.7);
      handR.lerp(_a.copy(J.shR).add(_n.set(0.25, -0.45, 0.05 - sw)), push * 0.7);
    }
    if (p.handTarget && p.slideHand) {
      if (p.slideHand > 0) handF.lerp(p.handTarget, p.handAmount ?? 1);
      else handR.lerp(p.handTarget, p.handAmount ?? 1);
    }
    if (limp) {
      handF.lerp(_a.copy(J.chest).add(_n.set(0.4, 0.3, -0.3)), limp);
      handR.lerp(_a.copy(J.chest).add(_n.set(0.4, 0.2, 0.3)), limp);
    }
    // Elbows point back along the board, or down and back when spread wide.
    _n.copy(this.chestFacing).multiplyScalar(-0.5).add(Y_DOWN);
    twoBoneIK(J.shF, handF, UPPER_ARM, FOREARM, _pole.set(-0.3, -0.2, -1).lerp(_n, spread), J.elF, J.haF);
    twoBoneIK(J.shR, handR, UPPER_ARM, FOREARM, _pole.set(-0.6, -0.2, 1).lerp(_n, spread), J.elR, J.haR);

    // Look down the hill (rig -Z, or +Z when riding fakie).
    this.headPitch = -0.15 - tuck * 0.2 + limp * 0.8;
    this.headYaw = (p.lookYaw ?? 0) + (p.fakie ? Math.PI : 0);
    this.headRoll = -lean * 0.5; // keep the eyes nearer level than the body
    return this;
  }
}
