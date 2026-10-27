// Crash ragdoll: the rider's joints become point masses (verlet), held
// together by the bone lengths and a stiff torso, with simple joint limits so
// knees and elbows only bend the way they should. It is seeded from the pose
// and speed at the moment of the crash, tumbles, bounces and slides on its
// leathers, then hands the joints back to the skinned rig through the same
// pose object RiderPose produces. The board skitters off on its own.

import * as THREE from 'three';
import { RiderPose, JOINT_NAMES, DECK_HEIGHT } from './riderpose.js';
import { GRAVEL_EDGE, RAIL_OFFSET } from './road.js';

const G = 9.81;
const STEP = 1 / 120;
const ITERATIONS = 6;
const MU_ROAD = 0.65; // leathers on tarmac, plus tumbling
const MU_OFF = 0.9; // grass and gravel
const BOUNCE = 0.25;
const AIR_DAMP = 0.999;

// Collision radius and inverse mass (heavier torso, light hands and feet).
const PARTS = {
  hip: [0.12, 0.5], hipF: [0.09, 0.8], hipR: [0.09, 0.8], chest: [0.15, 0.5], neck: [0.08, 0.8], head: [0.14, 0.8],
  shF: [0.07, 0.9], shR: [0.07, 0.9], kneeF: [0.07, 1], kneeR: [0.07, 1], footF: [0.05, 1.3], footR: [0.05, 1.3],
  elF: [0.05, 1.1], elR: [0.05, 1.1], haF: [0.05, 1.4], haR: [0.05, 1.4],
};

// [a, b, stiffness]: bones are rigid, the torso a little springy.
const LINKS = [
  // Pelvis, spine and neck.
  ['hip', 'hipF', 1], ['hip', 'hipR', 1], ['hipF', 'hipR', 1],
  ['hip', 'chest', 1], ['chest', 'neck', 1], ['neck', 'head', 1],
  ['hip', 'neck', 0.5], ['chest', 'head', 0.5], ['hip', 'head', 0.15],
  ['hipF', 'chest', 1], ['hipR', 'chest', 1],
  // Shoulders on the chest, and the twist between hips and shoulders.
  ['shF', 'shR', 1], ['shF', 'chest', 1], ['shR', 'chest', 1], ['shF', 'neck', 1], ['shR', 'neck', 1],
  ['hipF', 'shF', 0.3], ['hipR', 'shR', 0.3], ['hipF', 'shR', 0.3], ['hipR', 'shF', 0.3],
  ['shF', 'head', 0.2], ['shR', 'head', 0.2],
  // Limbs.
  ['hipF', 'kneeF', 1], ['kneeF', 'footF', 1], ['hipR', 'kneeR', 1], ['kneeR', 'footR', 1],
  ['shF', 'elF', 1], ['elF', 'haF', 1], ['shR', 'elR', 1], ['elR', 'haR', 1],
];
// [a, b, shortest]: how far a knee or elbow can fold.
const FOLD = [['hipF', 'footF', 0.3], ['hipR', 'footR', 0.3], ['shF', 'haF', 0.14], ['shR', 'haR', 0.14]];

// Rest lengths come from a relaxed standing pose, so a rider who crashes in a
// tuck straightens out as they tumble.
let rest = null;
function restLengths() {
  if (rest) return rest;
  const J = new RiderPose().solve({ crouch: 0.1 }).joints;
  rest = LINKS.map(([a, b]) => J[a].distanceTo(J[b]));
  return rest;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _s = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

// Ground under a world point: the road, or the terrain off it. `out.rail` is
// set when a guardrail stands between the point and the drop.
function ground(world, x, z, s, out) {
  const p = world.road.project(x, z, s, out.proj);
  out.s = p.s;
  out.d = p.d;
  out.rx = p.rightX;
  out.rz = p.rightZ;
  out.off = Math.abs(p.d) > GRAVEL_EDGE;
  out.y = out.off ? Math.max(p.y - 3, world.terrain.heightAt(x, z)) : p.y;
  const side = Math.sign(p.d);
  out.rail = world.road.barrierAt(p.s, side) ? side : 0;
  return out;
}

export class Ragdoll {
  // model: the RiderModel, already showing the pose at the moment of impact.
  // vel: world velocity (Vector3) of the rider when it all went wrong.
  constructor(model, world, vel, s) {
    this.model = model;
    this.world = world;
    this.s = s;
    this.acc = 0;
    this.lengths = restLengths();
    this.hit = { proj: {} };
    this.impacts = 0; // hard landings, for a thud
    this.contacts = {};
    for (const k of JOINT_NAMES) this.contacts[k] = { floor: null, x0: 0, z0: 0 };
    // Seed from the current pose, in world space.
    const root = model.root;
    root.updateMatrixWorld(true);
    const J = model.solver.joints;
    const pos = (this.pos = {});
    const prev = (this.prev = {});
    let com = new THREE.Vector3();
    for (const k of JOINT_NAMES) {
      pos[k] = model.rig.localToWorld(J[k].clone());
      com.add(pos[k]);
    }
    com.multiplyScalar(1 / JOINT_NAMES.length);
    // A tumble head-first over the direction of travel, with some random
    // twist so no two crashes look the same, and limbs flung about.
    const speed = Math.hypot(vel.x, vel.z);
    const travel = speed > 0.5 ? new THREE.Vector3(vel.x / speed, 0, vel.z / speed) : new THREE.Vector3(1, 0, 0);
    const spin = new THREE.Vector3().crossVectors(UP, travel).multiplyScalar(THREE.MathUtils.clamp(speed * 0.25, 1.5, 6) * (0.6 + Math.random() * 0.6));
    spin.addScaledVector(UP, (Math.random() - 0.5) * 4).addScaledVector(travel, (Math.random() - 0.5) * 5);
    const v0 = new THREE.Vector3(vel.x, 1.2 + speed * 0.06, vel.z);
    for (const k of JOINT_NAMES) {
      const v = _a.subVectors(pos[k], com).cross(spin).negate().add(v0);
      if (k[0] === 'h' && k[1] === 'a') v.add(_b.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(3));
      if (k.startsWith('foot')) v.y += Math.random() * 1.5;
      prev[k] = pos[k].clone().addScaledVector(v, -STEP);
    }
    this.out = {
      joints: {}, torsoDir: new THREE.Vector3(), bodyUp: new THREE.Vector3(), chestFacing: new THREE.Vector3(),
      headQ: new THREE.Quaternion(), footQF: new THREE.Quaternion(), footQR: new THREE.Quaternion(),
      headPitch: 0, headYaw: 0, headRoll: 0, footYawF: 0, footYawR: 0, footRollF: 0, footRollR: 0,
      plantF: 0, plantR: 0, plantDir: new THREE.Vector3(1, 0, 0),
    };
    for (const k of JOINT_NAMES) this.out.joints[k] = new THREE.Vector3();
    // From here the root just follows the pelvis; the joints say the rest.
    root.quaternion.identity();
  }

  get hip() {
    return this.pos.hip;
  }

  // Centre-of-mass speed (from the pelvis), m/s.
  get speed() {
    return this.pos.hip.distanceTo(this.prev.hip) / STEP;
  }

  velocity(out) {
    return out.subVectors(this.pos.hip, this.prev.hip).multiplyScalar(1 / STEP);
  }

  update(dt) {
    this.acc = Math.min(this.acc + dt, STEP * 8);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
    this.show();
  }

  step(h) {
    const { pos, prev } = this;
    for (const k of JOINT_NAMES) {
      const p = pos[k], q = prev[k];
      _d.subVectors(p, q).multiplyScalar(AIR_DAMP);
      q.copy(p);
      p.add(_d);
      p.y -= G * h * h;
    }
    this.probe();
    for (let it = 0; it < ITERATIONS; it++) {
      this.limits();
      this.links();
      this.clamp();
    }
    this.contact(h);
  }

  links() {
    const { pos, lengths } = this;
    for (let i = 0; i < LINKS.length; i++) {
      const [a, b, k] = LINKS[i];
      this.hold(pos[a], pos[b], PARTS[a][1], PARTS[b][1], lengths[i], k);
    }
    for (const [a, b, min] of FOLD) {
      if (pos[a].distanceTo(pos[b]) < min) this.hold(pos[a], pos[b], PARTS[a][1], PARTS[b][1], min, 1);
    }
  }

  hold(pa, pb, wa, wb, len, k) {
    _d.subVectors(pb, pa);
    const d = _d.length();
    if (d < 1e-6) return;
    const diff = ((d - len) / d / (wa + wb)) * k;
    pa.addScaledVector(_d, diff * wa);
    pb.addScaledVector(_d, -diff * wb);
  }

  // Which way the hips and the chest face (the toe side when standing).
  facing(lo, hiA, hiB, a, b, out) {
    const P = this.pos;
    _u.subVectors(P[hiA], P[lo]).add(_a.subVectors(P[hiB], P[lo])).normalize();
    _s.subVectors(P[b], P[a]).normalize();
    return out.crossVectors(_u, _s).normalize();
  }

  // Knees fold forward and elbows back: a joint that ends up bent the wrong
  // way is mirrored back across its limb (which keeps both bone lengths). The
  // thighs can't swing far behind the body.
  limits() {
    const P = this.pos;
    const hips = this.facing('hip', 'chest', 'neck', 'hipF', 'hipR', _f);
    for (const s of ['F', 'R']) {
      this.hinge(P['hip' + s], P['knee' + s], P['foot' + s], hips, 1, this.prev['knee' + s], this.contacts['knee' + s].floor);
      _a.subVectors(P['knee' + s], P['hip' + s]).normalize();
      const back = -0.5 - _a.dot(hips);
      if (back > 0) {
        P['knee' + s].addScaledVector(hips, back * 0.2);
        this.prev['knee' + s].addScaledVector(hips, back * 0.2);
      }
    }
    const chest = this.facing('chest', 'neck', 'head', 'shF', 'shR', _f);
    for (const s of ['F', 'R']) this.hinge(P['sh' + s], P['el' + s], P['ha' + s], chest, -1, this.prev['el' + s], this.contacts['el' + s].floor);
  }

  // Pinned against the ground, it only straightens: the rest of the body has
  // to turn over before the joint can bend the right way.
  hinge(a, mid, c, dir, sign, prev, floor) {
    _d.subVectors(c, a);
    const len2 = _d.lengthSq();
    if (len2 < 1e-6) return;
    _b.copy(dir).addScaledVector(_d, -dir.dot(_d) / len2).normalize(); // dir, square to the limb
    const off = _a.subVectors(mid, a).dot(_b) * sign;
    if (off >= 0) return;
    _b.multiplyScalar(-off * sign);
    if (mid.y + _b.y * 2 >= floor) _b.multiplyScalar(2);
    mid.add(_b);
    prev.add(_b); // no kick from the correction
  }

  // What lies under each part this step: ground height, how fast it drops
  // away down the hill, and any guardrail.
  probe() {
    const { pos, prev, hit, world, contacts } = this;
    for (const k of JOINT_NAMES) {
      const p = pos[k];
      const c = contacts[k];
      ground(world, p.x, p.z, this.s, hit);
      if (k === 'hip') this.s = hit.s;
      const floor = hit.y + PARTS[k][0];
      c.gv = c.floor === null ? 0 : Math.max(-0.5, Math.min(0.5, floor - c.floor));
      c.floor = floor;
      c.off = hit.off;
      c.rail = hit.rail;
      c.d = hit.d;
      c.rx = hit.rx;
      c.rz = hit.rz;
      c.x0 = p.x;
      c.z0 = p.z;
      c.vy = p.y - prev[k].y;
      c.vSide = hit.rail ? ((p.x - prev[k].x) * hit.rx + (p.z - prev[k].z) * hit.rz) * hit.rail : 0;
    }
  }

  // Keeps every part above the ground and inside the guardrails.
  clamp() {
    const { pos, contacts } = this;
    for (const k of JOINT_NAMES) {
      const p = pos[k];
      const c = contacts[k];
      if (p.y < c.floor) p.y = c.floor;
      if (c.rail) {
        const over = (c.d + (p.x - c.x0) * c.rx + (p.z - c.z0) * c.rz) * c.rail - (RAIL_OFFSET - 0.1 - PARTS[k][0]);
        if (over > 0) {
          p.x -= c.rx * c.rail * over;
          p.z -= c.rz * c.rail * over;
        }
      }
    }
  }

  // Bounces, glancing off rails, and sliding friction on whatever is down.
  contact(h) {
    const { pos, prev, contacts } = this;
    for (const k of JOINT_NAMES) {
      const p = pos[k], q = prev[k];
      const c = contacts[k];
      if (c.rail && c.vSide > 0) {
        const vNow = ((p.x - q.x) * c.rx + (p.z - q.z) * c.rz) * c.rail;
        if (vNow < c.vSide * 0.5) {
          // Pushed back by the rail: rebound gently instead.
          const dv = vNow + c.vSide * 0.3;
          q.x += c.rx * c.rail * dv;
          q.z += c.rz * c.rail * dv;
        }
      }
      if (p.y > c.floor + 0.02) continue;
      // Bounce off the ground (which may be falling away down the hill), but
      // being lifted out of it is no reason to fly off.
      if (c.vy - c.gv < -4 * h) this.impacts++;
      const vy = c.vy < c.gv ? c.gv - (c.vy - c.gv) * BOUNCE : c.vy;
      if (c.vy < c.gv || p.y - q.y > vy) q.y = p.y - vy;
      const vx = p.x - q.x, vz = p.z - q.z;
      const v = Math.hypot(vx, vz);
      if (v > 1e-9) {
        const dec = Math.min(v, (c.off ? MU_OFF : MU_ROAD) * G * h * h);
        q.x += (vx / v) * dec;
        q.z += (vz / v) * dec;
      }
    }
  }

  // Poses the rider from the particles, through the rig the skeleton follows.
  show() {
    const m = this.model;
    const P = this.pos;
    const o = this.out;
    const J = o.joints;
    m.root.position.copy(P.hip);
    m.root.position.y -= DECK_HEIGHT;
    m.root.updateMatrixWorld(true);
    _inv.copy(m.rig.matrixWorld).invert();
    for (const k of JOINT_NAMES) J[k].copy(P[k]).applyMatrix4(_inv);
    o.torsoDir.subVectors(J.neck, J.hip).normalize();
    o.bodyUp.copy(o.torsoDir);
    _s.subVectors(J.shR, J.shF).normalize();
    o.chestFacing.crossVectors(o.torsoDir, _s).normalize();
    // The helmet faces where the chest does, up along the neck.
    _u.subVectors(J.head, J.neck).normalize();
    frame(_f.copy(o.chestFacing), _u, o.headQ);
    // Feet square to the shins, toes the way the knees bend.
    _s.subVectors(J.hipR, J.hipF).normalize();
    const hips = _a.crossVectors(o.torsoDir, _s).normalize();
    for (const s of ['F', 'R']) {
      _u.subVectors(J['knee' + s], J['foot' + s]).normalize();
      frame(_f.copy(hips), _u, o['footQ' + s]);
    }
    m.applyPose(o);
  }
}

// A rotation taking +X to `fwd` (made square to `up`) and +Y to `up`: the
// rider's helmet and shoes face +X in the bind pose.
function frame(fwd, up, out) {
  fwd.addScaledVector(up, -fwd.dot(up));
  if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
  fwd.normalize();
  _b.crossVectors(fwd, up);
  _m.makeBasis(fwd, up, _b);
  return out.setFromRotationMatrix(_m);
}

// The board, flung off on its own: it tumbles through the air, then skitters
// and spins along the ground until it settles wheels down (or up).
export class LooseBoard {
  constructor(board, world, vel, s) {
    this.board = board;
    this.world = world;
    this.s = s;
    this.vel = new THREE.Vector3(vel.x * 1.05, 0.8 + Math.random() * 1.5, vel.z * 1.05);
    this.spin = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8);
    this.hit = { proj: {} };
  }

  update(dt) {
    const b = this.board;
    const v = this.vel;
    v.y -= G * dt;
    b.position.addScaledVector(v, dt);
    const hit = ground(this.world, b.position.x, b.position.z, this.s, this.hit);
    this.s = hit.s;
    if (hit.rail) {
      const over = hit.d * hit.rail - (RAIL_OFFSET - 0.2);
      const vSide = (v.x * hit.rx + v.z * hit.rz) * hit.rail;
      if (over > 0 && vSide > 0) {
        b.position.x -= hit.rx * hit.rail * over;
        b.position.z -= hit.rz * hit.rail * over;
        v.x -= hit.rx * hit.rail * vSide * 1.5;
        v.z -= hit.rz * hit.rail * vSide * 1.5;
        this.spin.y += (Math.random() - 0.5) * 10;
      }
    }
    _u.set(0, 1, 0).applyQuaternion(b.quaternion);
    const flipped = _u.y < 0;
    const floor = hit.y + (flipped ? DECK_HEIGHT : 0);
    const gv = this.floor === undefined ? 0 : (floor - this.floor) / dt;
    this.floor = floor;
    if (b.position.y < floor + 0.01) {
      b.position.y = Math.max(b.position.y, floor);
      if (v.y < gv) v.y = gv + (gv - v.y) * 0.3;
      const h = Math.hypot(v.x, v.z);
      const dec = Math.min(h, (hit.off ? 1 : flipped ? 0.5 : 0.25) * G * dt);
      if (h > 1e-6) {
        v.x -= (v.x / h) * dec;
        v.z -= (v.z / h) * dec;
      }
      // Rattles down flat, still spinning about the vertical.
      this.spin.x *= Math.exp(-dt * 10);
      this.spin.z *= Math.exp(-dt * 10);
      this.spin.y *= Math.exp(-dt * (hit.off ? 4 : 1));
      _q.setFromUnitVectors(_u, flipped ? _d.set(0, -1, 0) : UP);
      b.quaternion.premultiply(_q2.identity().slerp(_q, Math.min(1, dt * 12)));
    }
    _q.setFromEuler(_e.set(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt));
    b.quaternion.premultiply(_q);
  }
}
