// The poses the pose sheet and the clipping check run through, as
// RiderPose.solve parameters.
import * as THREE from 'three';

const hand = (x) => new THREE.Vector3(x * 0.62, -0.115 + 0.03, 0.1);
export const POSES = {
  upright: { crouch: 0.3 },
  carveToe: { roll: 0.22, lean: 0.4, crouch: 0.45 },
  carveHeel: { roll: -0.22, lean: -0.4, crouch: 0.45 },
  halfTuck: { tuck: 0.5, crouch: 0.3 },
  tuck: { tuck: 1, crouch: 0.3 },
  airbrake: { spread: 1, crouch: 0.05 },
  pushPlant: { push: 1, pushPhase: 0.15, crouch: 0.3 },
  pushSwing: { push: 1, pushPhase: 0.8, crouch: 0.3 },
  footbrake: { brake: 1, crouch: 0.45 },
  slideToe: { roll: 0.2, lean: 0.55, crouch: 0.75, slideHand: 1, handAmount: 1, handTarget: hand(1), lookYaw: 0.8 },
  slideHeel: { roll: -0.2, lean: -0.55, crouch: 0.75, slideHand: -1, handAmount: 1, handTarget: hand(-1), lookYaw: -0.8 },
  crash: { crouch: 0.6, limp: 1 },
};
