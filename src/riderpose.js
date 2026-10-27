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
const FOOT_TURN_F = 1.25;
const FOOT_TURN_R = 1.05;
const HIP_OPEN = 0.85; // hips turn most of the way towards the nose with the feet
const SHOULDER_OPEN = 0.5;
const SLIDE_TWIST_TOE = -0.3; // chest square to the toe side
const SLIDE_TWIST_HEEL = -0.9;
const PIVOT_Y = -0.06; // trucks' roll axis, relative to the deck top
const ANKLE = 0.05; // ankle above the sole
const GROUND = -DECK_HEIGHT;
const HAND_LEAN = 0.1; // extra body lean towards a planted glove
const GLOVE = 0.045; // palm centre above the road with the puck down

export const JOINT_NAMES = [
  'hip', 'hipF', 'hipR', 'kneeF', 'kneeR', 'footF', 'footR', 'chest', 'neck', 'head',
  'shF', 'shR', 'elF', 'elR', 'haF', 'haR',
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _g = new THREE.Vector3();
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
    // Downhill stance: toes point across the board and turn towards the nose,
    // the front foot about 70 degrees, the back foot about 60.
    this.footYawF = Math.PI / 2 + FOOT_TURN_F;
    this.footYawR = Math.PI / 2 + FOOT_TURN_R;
    this.footRollF = 0; // soles follow the deck roll
    this.footRollR = 0;
    this.torsoDir = new THREE.Vector3(0, 1, 0);
    this.bodyUp = new THREE.Vector3(0, 1, 0); // the whole-body lean, before the torso bends
    this.chestFacing = new THREE.Vector3(1, 0, 0); // which way the chest points
    this.plantF = 0; // how far each hand is planted flat on the road
    this.plantR = 0;
    this.plantDir = new THREE.Vector3(1, 0, 0); // a planted hand's fingers
  }

  // p (all optional):
  //  roll    deck roll, rad (+ = toe edge down)
  //  lean    centre-of-mass lean from vertical, rad (+ = towards the toes)
  //  pitch   fore/aft body lean, rad (+ = towards the nose)
  //  weight  -1..1 weight shift (+ = onto the front foot)
  //  crouch, tuck, spread (air brake), brake (footbrake), push 0..1
  //  pushPhase 0..1 through one push stroke
  //  slideHand -1/0/1 which hand goes down (+ = toe side), handAmount 0..1:
  //          a hand-down slide, the rider dropped low with the glove's puck on
  //          the road beside the board
  //  lookYaw (rad), fakie (head looks the other way), limp 0..1 (crashed)
  solve(p) {
    const J = this.joints;
    const roll = p.roll ?? 0;
    // A planted hand holds the body further over than the wheels alone could.
    const hand = p.slideHand ? Math.min(1, p.handAmount ?? 1) : 0;
    const hs = p.slideHand > 0 ? 1 : -1;
    const lean = (p.lean ?? 0) + hs * hand * HAND_LEAN;
    const pitch = p.pitch ?? 0;
    const tuck = p.tuck ?? 0;
    const spread = p.spread ?? 0;
    const push = p.push ?? 0;
    const brake = p.brake ?? 0;
    const limp = p.limp ?? 0;
    const crouch = Math.min(1, (p.crouch ?? 0.15) + push * 0.35 + hand * hand);
    const weight = p.weight ?? 0;

    // Feet planted on the rolling deck.
    deckPoint(0, FOOT_Z_FRONT, roll, ANKLE, J.footF);
    deckPoint(0, FOOT_Z_REAR, roll, ANKLE, J.footR);
    this.footRollF = this.footRollR = -roll;

    // The body leans as one about the line through the feet (the balance
    // model in player.js decides the angle); hips drop as the rider bends.
    const bend = Math.max(crouch, tuck * 0.85) + hand * 0.15;
    const hipH = 0.82 - bend * 0.42 - tuck * 0.05;
    _q.setFromAxisAngle(Z, -lean);
    _qx.setFromAxisAngle(X, -pitch);
    _q.multiply(_qx);
    const midZ = (FOOT_Z_FRONT + FOOT_Z_REAR) * 0.5 + tuck * 0.08 - weight * 0.11;
    // The hips face part way down the hill; bending pushes the seat back
    // the opposite way, so the body stays over the middle of the board.
    const hipTurn = HIP_OPEN + spread * 0.1 + tuck * 0.6;
    _f.set(Math.cos(hipTurn), 0, -Math.sin(hipTurn));
    _a.set(0, hipH, 0).addScaledVector(_f, -0.04 - tuck * 0.05 - bend * 0.06 - spread * 0.03).applyQuaternion(_q);
    J.hip.set(0, ANKLE, midZ).add(_a);
    this.bodyUp.copy(Y).applyQuaternion(_q);
    // Hips open towards the nose with the feet. The chest turns further:
    // square to the road ahead in a tuck (shoulders across the board) and
    // nearly so for the air brake, and the hips follow it a little.
    let twist = Math.min(Math.PI / 2, SHOULDER_OPEN + spread * (1.4 - SHOULDER_OPEN) + tuck * (Math.PI / 2 - SHOULDER_OPEN));
    // Hand down in a slide: the chest turns towards that side, so the arm
    // reaches out from its own shoulder instead of across the body.
    if (p.slideHand) twist = THREE.MathUtils.lerp(twist, p.slideHand > 0 ? SLIDE_TWIST_TOE : SLIDE_TWIST_HEEL, p.handAmount ?? 1);
    _n.set(0, 0, -0.1).applyAxisAngle(Y, hipTurn).applyQuaternion(_q);
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
    // Torso: upright, folding over the front knee in a tuck, standing tall and
    // leaning back into the wind for an air brake.
    const t = this.torsoDir.set(0, 1, 0).addScaledVector(_f, 0.15 + bend * 0.25);
    t.lerp(_a.set(0, 0.4, -0.92), tuck);
    t.lerp(_a.set(0.04, 1, 0.18), spread);
    t.lerp(_a.set(0.35, 1, -0.25), push * 0.6);
    // Hand down: chest out over the planted glove, facing the road on the toe
    // side, sitting back on the heel side.
    t.lerp(hs > 0 ? _a.set(0.55, 0.8, -0.2) : _a.set(-0.35, 0.9, -0.1), hand);
    t.normalize().applyQuaternion(_q);
    if (limp) t.lerp(_a.set(0.9, 0.2, 0.2), limp).normalize();
    J.chest.copy(J.hip).addScaledVector(t, 0.5);
    J.neck.copy(J.hip).addScaledVector(t, 0.6);
    J.head.copy(J.hip).addScaledVector(t, 0.78);
    // Shoulder line: the stance's (front shoulder towards the nose) turned
    // about the vertical, then made square to the spine. Turning about the
    // spine instead does nothing once the spine itself points at the nose.
    _n.set(0, 0, -1).applyAxisAngle(Y, twist).applyQuaternion(_q);
    _n.addScaledVector(t, -_n.dot(t)).normalize();
    this.chestFacing.crossVectors(_n, t).normalize();
    _n.multiplyScalar(0.19);
    J.shF.copy(J.chest).add(_n).addScaledVector(t, -0.03);
    J.shR.copy(J.chest).sub(_n).addScaledVector(t, -0.03);

    // A planted hand has to reach the road: if the arm can't, the whole body
    // sinks towards the glove (the knees take it up) until it can.
    const glove = _g;
    if (hand > 0) {
      const sh = hs > 0 ? J.shF : J.shR;
      glove.set(sh.x + hs * 0.12, GROUND + GLOVE, sh.z - 0.08);
      _b.subVectors(glove, sh);
      const short = (_b.length() - (UPPER_ARM + FOREARM) * 0.97) * hand;
      if (short > 0) {
        _b.setLength(short);
        for (const k of ['hip', 'hipF', 'hipR', 'chest', 'neck', 'head', 'shF', 'shR']) J[k].add(_b);
      }
    }

    // Knees bend the way the toes point.
    _pole.set(Math.cos(FOOT_TURN_F), 0, -Math.sin(FOOT_TURN_F)).applyQuaternion(_q);
    twoBoneIK(J.hipF, J.footF, THIGH, SHIN, _pole, J.kneeF, J.footF);
    _pole.set(Math.cos(FOOT_TURN_R), 0, -Math.sin(FOOT_TURN_R)).applyQuaternion(_q);
    twoBoneIK(J.hipR, J.footR, THIGH, SHIN, _pole, J.kneeR, J.footR);

    // Hands: relaxed by the sides, behind the back in a tuck, wide for the air
    // brake, swinging for balance while pushing, and puck down in a slide.
    // Shoulder line (front to back shoulder), for hands and elbows.
    _s.subVectors(J.shR, J.shF).normalize();
    // Relaxed: hanging just outside the hips and a little in front.
    _n.copy(Y_DOWN).applyQuaternion(_q);
    // Crouching, they come forward and out, clear of the knees.
    const handF = _b.copy(J.shF).addScaledVector(_n, 0.48 - bend * 0.12).addScaledVector(_s, -0.2 - bend * 0.08).addScaledVector(this.chestFacing, -0.04 + bend * 0.2);
    const handR = _c.copy(J.shR).addScaledVector(_n, 0.48 - bend * 0.12).addScaledVector(_s, 0.16 + bend * 0.08).addScaledVector(this.chestFacing, -0.04 + bend * 0.2);
    if (tuck > 0) {
      // Hands clasped on the small of the back, clear of the leathers.
      const back = (side, out) => out.copy(J.hip).addScaledVector(t, 0.16).addScaledVector(this.chestFacing, -0.19).addScaledVector(_s, side * 0.05);
      // On the way, they swing out and round the hips rather than through them.
      const arc = Math.sin(Math.PI * tuck);
      handF.lerp(back(-1, _a), tuck).addScaledVector(_s, -0.12 * arc).addScaledVector(this.chestFacing, -0.16 * arc);
      handR.lerp(back(1, _a), tuck).addScaledVector(_s, 0.12 * arc).addScaledVector(this.chestFacing, -0.16 * arc);
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
    if (hand > 0) {
      // One hand down on the road, the other out wide for balance.
      const [down, free, sh, side] = hs > 0 ? [handF, handR, J.shR, 1] : [handR, handF, J.shF, -1];
      // The hand on its way down swings out round the knee.
      const arc = Math.sin(Math.PI * hand);
      down.lerp(glove, hand).addScaledVector(_s, -side * 0.2 * arc).addScaledVector(this.chestFacing, 0.15 * arc);
      free.lerp(_a.copy(sh).addScaledVector(_s, side * 0.32).addScaledVector(this.chestFacing, 0.2).addScaledVector(t, -0.2), hand);
      free.addScaledVector(_s, side * 0.15 * arc).addScaledVector(this.chestFacing, 0.2 * arc);
    }
    this.plantF = hs > 0 ? hand : 0;
    this.plantR = hs > 0 ? 0 : hand;
    this.plantDir.set(hs * 0.7, 0, -0.7).normalize();
    if (limp) {
      handF.lerp(_a.copy(J.chest).add(_n.set(0.4, 0.3, -0.3)), limp);
      handR.lerp(_a.copy(J.chest).add(_n.set(0.4, 0.2, 0.3)), limp);
    }
    // Elbows point out to the side and back, down and back when spread wide,
    // and up off the back with the hands behind it in a tuck.
    for (const [sh, hand, el, ha, side] of [[J.shF, handF, J.elF, J.haF, -1], [J.shR, handR, J.elR, J.haR, 1]]) {
      _pole.copy(_s).multiplyScalar(side).addScaledVector(this.chestFacing, -0.6).addScaledVector(t, -0.2);
      _n.copy(this.chestFacing).multiplyScalar(-0.5).add(Y_DOWN);
      _pole.lerp(_n, spread);
      _n.copy(_s).multiplyScalar(side).addScaledVector(this.chestFacing, -0.3);
      _pole.lerp(_n, tuck);
      twoBoneIK(sh, hand, UPPER_ARM, FOREARM, _pole, el, ha);
    }

    // Look down the hill (rig -Z, or +Z when riding fakie).
    this.headPitch = -0.15 - tuck * 0.2 + limp * 0.8;
    this.headYaw = (p.lookYaw ?? 0) + (p.fakie ? Math.PI : 0);
    this.headRoll = -lean * 0.5; // keep the eyes nearer level than the body
    return this;
  }
}
