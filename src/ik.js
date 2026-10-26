// Inverse kinematics helpers, independent of any particular rider model.
//
// twoBoneIK solves a limb (hip-knee-foot, shoulder-elbow-hand) analytically.
// SkeletonDriver takes the joint positions RiderPose produces and turns them
// into bone rotations for any THREE.Bone skeleton: each bone is aimed from
// its joint towards the next one, measured against the bone's own rest pose,
// so bone axes, names and proportions of the rig don't matter.

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

// The bone segments of a humanoid rig, in parent-before-child order, as
// pairs of RiderPose joint names. Map each to a bone name when building a
// SkeletonDriver; leave out any the rig doesn't have.
export const HUMANOID_SEGMENTS = {
  spine: ['hip', 'neck'],
  head: ['neck', 'head'],
  thighF: ['hipF', 'kneeF'],
  shinF: ['kneeF', 'footF'],
  thighR: ['hipR', 'kneeR'],
  shinR: ['kneeR', 'footR'],
  upperArmF: ['shF', 'elF'],
  forearmF: ['elF', 'haF'],
  upperArmR: ['shR', 'elR'],
  forearmR: ['elR', 'haR'],
};

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();

export class SkeletonDriver {
  // rigSpace: the Object3D whose local frame is RiderPose's rig space.
  // hips: the root bone, moved to joints.hip.
  // bones: { segmentName: THREE.Bone }, segment names from HUMANOID_SEGMENTS.
  // Call it with the skeleton in its rest (bind) pose.
  constructor(rigSpace, hips, bones, segments = HUMANOID_SEGMENTS) {
    this.rigSpace = rigSpace;
    this.hips = hips;
    this.items = [];
    rigSpace.updateMatrixWorld(true);
    for (const [name, [from, to]] of Object.entries(segments)) {
      const bone = bones[name];
      if (!bone) continue;
      // Rest direction: towards the bone's first child, in the bone's own space.
      const child = bone.children.find((c) => c.isBone) || bone.children[0];
      const restDir = child ? child.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
      this.items.push({ bone, from, to, restDir, restQ: bone.quaternion.clone() });
    }
  }

  apply(pose) {
    const J = pose.joints;
    if (this.hips && this.hips.parent) {
      _a.copy(J.hip);
      this.rigSpace.localToWorld(_a);
      this.hips.parent.worldToLocal(_a);
      this.hips.position.copy(_a);
    }
    for (const it of this.items) it.bone.quaternion.copy(it.restQ);
    this.rigSpace.getWorldQuaternion(_rootQ);
    // Parents come first, so each bone is aimed after its parent has moved.
    for (const it of this.items) {
      const { bone } = it;
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(_pq);
      _wq.copy(_pq).multiply(bone.quaternion);
      _a.copy(it.restDir).applyQuaternion(_wq); // current world direction
      _b.subVectors(J[it.to], J[it.from]).applyQuaternion(_rootQ).normalize(); // wanted
      _q.setFromUnitVectors(_a, _b);
      _wq.premultiply(_q);
      bone.quaternion.copy(_pq.invert()).multiply(_wq);
    }
  }
}
