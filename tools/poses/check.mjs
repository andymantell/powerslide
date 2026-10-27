// Pose checks without a browser: `node tools/poses/check.mjs`.
// For every pose (and sweeps through push strokes and tuck amounts) it
// reports how deep the arms go into the body, using simple stand-ins for
// the leathers' shape, and how far the rider sits off the board's centre
// line. Run it after changing RiderPose; --bad lists only poses that clip.
import * as THREE from 'three';
import { RiderPose } from '../../src/riderpose.js';
import { POSES } from './list.js';

const ARM = 0.055; // upper arm radius; forearm and glove are a touch thinner
// Torso half-depths (front-back) and half-widths along the spine, 0 = hip.
const TORSO = [[0, 0.11, 0.17], [0.2, 0.1, 0.14], [0.36, 0.12, 0.17], [0.5, 0.1, 0.2], [0.6, 0.07, 0.08]];
const LIMBS = [['hipF', 'kneeF', 0.09], ['kneeF', 'footF', 0.065], ['hipR', 'kneeR', 0.09], ['kneeR', 'footR', 0.065]];

const v = new THREE.Vector3();
const w = new THREE.Vector3();
function segDist(p, a, b) {
  w.subVectors(b, a);
  const t = Math.max(0, Math.min(1, v.subVectors(p, a).dot(w) / w.lengthSq()));
  return v.copy(a).addScaledVector(w, t).distanceTo(p);
}
function torsoAt(h) {
  for (let i = 1; i < TORSO.length; i++) {
    const [h1, d1, w1] = TORSO[i];
    const [h0, d0, w0] = TORSO[i - 1];
    if (h <= h1) {
      const k = (h - h0) / (h1 - h0);
      return [d0 + (d1 - d0) * k, w0 + (w1 - w0) * k];
    }
  }
  return null;
}

// How far (m) point p, with radius r, sinks into the body. <= 0 is clear.
function depth(pose, p, r) {
  const J = pose.joints;
  const up = new THREE.Vector3().subVectors(J.neck, J.hip);
  const len = up.length();
  up.normalize();
  const side = new THREE.Vector3().subVectors(J.shR, J.shF);
  side.addScaledVector(up, -side.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, up);
  const d = new THREE.Vector3().subVectors(p, J.hip);
  const h = d.dot(up);
  let worst = -1;
  let part = '';
  const hit = (dd, name) => {
    if (dd > worst) {
      worst = dd;
      part = name;
    }
  };
  if (h > -0.08 && h < len) {
    const [hd, hw] = torsoAt(Math.max(0, h));
    const f = d.dot(fwd), s = d.dot(side);
    // Distance inside the ellipse, roughly in metres.
    const e = Math.hypot(f / (hd + r), s / (hw + r));
    hit((1 - e) * Math.min(hd + r, hw + r), 'torso');
  }
  for (const [a, b, lr] of LIMBS) hit(lr + r - segDist(p, J[a], J[b]), a.startsWith('hip') ? `thigh${a.slice(-1)}` : `shin${a.slice(-1)}`);
  hit(0.15 + r - p.distanceTo(J.head), 'head');
  return [worst, part];
}

function check(pose) {
  const J = pose.joints;
  let worst = { d: -1 };
  for (const s of ['F', 'R']) {
    const sh = J['sh' + s], el = J['el' + s], ha = J['ha' + s];
    const tip = new THREE.Vector3().subVectors(ha, el).normalize().multiplyScalar(0.12).add(ha);
    const segs = [[sh, el, ARM, 0.35], [el, ha, 0.048, 0], [ha, tip, 0.045, 0]];
    for (const [a, b, r, skip] of segs) {
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        if (k < skip) continue;
        const p = new THREE.Vector3().lerpVectors(a, b, k);
        const [d, part] = depth(pose, p, r);
        if (d > worst.d) worst = { d, where: `${s === 'F' ? 'front' : 'back'} ${r === ARM ? 'upper arm' : r > 0.046 ? 'forearm' : 'hand'} in ${part}` };
      }
    }
  }
  return worst;
}

const cases = { ...POSES };
for (let i = 0; i < 8; i++) cases[`push@${i / 8}`] = { push: 1, pushPhase: i / 8, crouch: 0.3 };
for (let i = 1; i < 10; i++) cases[`tuck@${i / 10}`] = { tuck: i / 10, crouch: 0.3 };
for (let i = 1; i < 4; i++) cases[`airbrake@${i / 4}`] = { spread: i / 4, crouch: 0.15 };
for (let i = 1; i < 4; i++) cases[`slideToe@${i / 4}`] = { ...POSES.slideToe, handAmount: i / 4 };
for (let i = 1; i < 4; i++) cases[`slideHeel@${i / 4}`] = { ...POSES.slideHeel, handAmount: i / 4 };
cases.tuckCarveToe = { tuck: 1, crouch: 0.3, roll: 0.2, lean: 0.35 };
cases.tuckCarveHeel = { tuck: 1, crouch: 0.3, roll: -0.2, lean: -0.35 };

const quiet = process.argv.includes('--bad');
const pose = new RiderPose();
console.log('pose               clip(cm) where              off-centre x (cm): hip  chest  head');
let bad = 0;
for (const [name, p] of Object.entries(cases)) {
  pose.solve(p);
  const c = check(pose);
  const J = pose.joints;
  const clip = Math.max(0, c.d * 100);
  if (clip > 1) bad++;
  if (quiet && clip <= 1) continue;
  const x = (k) => (J[k].x * 100).toFixed(0).padStart(5);
  console.log(`${name.padEnd(18)} ${clip.toFixed(1).padStart(6)}   ${(clip > 0 ? c.where : '').padEnd(30)} ${x('hip')} ${x('chest')} ${x('head')}`);
}
console.log(bad ? `${bad} poses clip by more than 1 cm` : 'no clipping over 1 cm');
