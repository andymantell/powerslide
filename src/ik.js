// Inverse kinematics helpers, independent of any particular rider model.
//
// twoBoneIK solves a limb (hip-knee-foot, shoulder-elbow-hand) analytically.
// SkeletonDriver poses any THREE.Bone skeleton from a RiderPose: a frame
// function per bone says where the bone starts and which way it faces (aim
// and twist), measured against the same frame in the bind pose, so bone
// axes, names and proportions of the rig don't matter.

import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _bend = new THREE.Vector3();

// Places `outJoint` (knee/elbow) and `outEnd` (foot/hand) for a two-segment
// limb rooted at `root` reaching for `target`. The limb bends towards `pole`.
// If the target is out of reach the limb straightens and points at it.
export function twoBoneIK(root, target, l1, l2, pole, outJoint, outEnd) {
  _dir.subVectors(target, root);
  let dist = _dir.length();
  _dir.multiplyScalar(1 / Math.max(dist, 1e-6));
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.001);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _bend.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_bend.lengthSq() < 1e-8) _bend.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
  _bend.normalize();
  outJoint.copy(root).addScaledVector(_dir, a).addScaledVector(_bend, h);
  outEnd.copy(root).addScaledVector(_dir, dist);
}

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rootQ = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

// A rotation from a primary direction (becomes +Y) and a reference direction
// (+Z, made square to the primary one). Fills `out` and returns it.
export function frameQuat(dir, ref, out) {
  _z.copy(ref).addScaledVector(dir, -ref.dot(dir));
  if (_z.lengthSq() < 1e-10) _z.set(Math.abs(dir.x) < 0.9 ? 1 : 0, Math.abs(dir.x) < 0.9 ? 0 : 1, 0).cross(dir);
  _z.normalize();
  _x.crossVectors(dir, _z);
  _m.makeBasis(_x, dir, _z);
  return out.setFromRotationMatrix(_m);
}

export class SkeletonDriver {
  // rigSpace: the Object3D whose local frame is RiderPose's rig space.
  // rig: { boneName: frameFn } in parent-before-child order. frameFn(pose,
  // out) sets out.pos (where the bone starts, rig space) and out.q (a
  // rig-space orientation, e.g. from frameQuat) for that pose and returns out.
  // bindPose: a pose that matches the skeleton's rest (bind) pose; each
  // bone's rotation is driven by how its frame turns away from this one.
  // Bones that the rig doesn't name are left in their rest pose. Every bone
  // is moved to its joint as well as turned, so parts hanging off bones
  // (helmet, shoes, gloves) always meet the joints the pose asks for.
  constructor(rigSpace, bones, rig, bindPose) {
    this.rigSpace = rigSpace;
    this.items = [];
    rigSpace.updateMatrixWorld(true);
    rigSpace.getWorldQuaternion(_rootQ).invert();
    const out = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
    for (const [name, frame] of Object.entries(rig)) {
      const bone = bones[name];
      if (!bone) continue;
      // Bone rest orientation in rig space, relative to its bind frame.
      frame(bindPose, out);
      const offset = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(_rootQ);
      offset.premultiply(out.q.clone().invert());
      this.items.push({ bone, frame, offset });
    }
    this.out = out;
  }

  apply(pose) {
    const out = this.out;
    this.rigSpace.updateWorldMatrix(true, false);
    this.rigSpace.getWorldQuaternion(_rootQ);
    // Parents come first, so each bone is set after its parent has moved.
    for (const { bone, frame, offset } of this.items) {
      frame(pose, out);
      const parent = bone.parent;
      parent.updateWorldMatrix(true, false);
      _a.copy(out.pos);
      this.rigSpace.localToWorld(_a);
      parent.worldToLocal(_a);
      bone.position.copy(_a);
      _q.copy(_rootQ).multiply(out.q).multiply(offset); // wanted world rotation
      parent.getWorldQuaternion(_pq);
      bone.quaternion.copy(_pq.invert()).multiply(_q);
    }
  }
}
