// Rider physics. The board is modelled like a tyre: velocity is split into a
// rolling component along the deck and a lateral component across it. The
// wheels grip up to a static friction limit; beyond it (or when the rider
// throws the board sideways) they slide with kinetic friction. Carving, drifts,
// powerslides and 180s all fall out of that one model.

import * as THREE from 'three';
import { RiderModel, DECK_HEIGHT } from './rider.js';
import { DS, HALF_WIDTH, GRAVEL_EDGE, RAIL_OFFSET } from './road.js';
import { RoadMesh } from './roadmesh.js';
import { clamp, lerp } from './noise.js';
import { DIFFICULTY } from './settings.js';

const G = 9.81;
const MASS = 82; // rider + board, kg
const RHO = 1.2;
const CDA_UPRIGHT = 0.5;
const CDA_TUCK = 0.23;
const CDA_AIRBRAKE = 0.95; // stood tall, chest open, arms spread
const CRR = 0.012; // urethane on asphalt
const MAX_CURVATURE = 0.38; // tightest carve at walking pace (~2.6 m radius)
const STEP = 1 / 120;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(scene, road, terrain, diff = DIFFICULTY.cruiser) {
    this.scene = scene;
    this.diff = diff;
    this.road = road;
    this.terrain = terrain;
    this.model = new RiderModel();
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2(); // x, z
    this.frame = {};
    this.proj = {};
    this.events = [];
    this.handLocal = new THREE.Vector3();
    this.handWorld = new THREE.Vector3();
    this.reset(400);
  }

  reset(s) {
    const f = this.road.sample(s, this.frame);
    this.s = s;
    this.d = 1.75;
    this.pos.set(f.x + f.rightX * this.d, f.y, f.z + f.rightZ * this.d);
    this.yaw = f.heading;
    this.vel.set(f.dirX * 6, f.dirZ * 6);
    this.steer = 0;
    this.lean = 0;
    this.sliding = false; // wheels currently sliding
    this.slideMode = false; // rider is throwing a slide
    this.slideDir = 1;
    this.slip = 0; // angle between deck and travel
    this.tuck = 0;
    this.airbrake = 0;
    this.crouch = 0.3;
    this.brake = 0;
    this.push = 0;
    this.pushPhase = 0;
    this.handAmount = 0;
    this.accLocal = new THREE.Vector2(); // contact accel in deck frame (x right, y forward)
    this.surface = 'asphalt';
    this.fakie = false;
    this.crashed = false;
    this.crashTime = 0;
    this.distance = 0;
    this.topSpeed = 0;
    this.shake = 0;
    this.wobble = 0;
    this.wobblePhase = 0;
    this.dirt = 0;
    this.prevSteer = 0;
    if (this.boardLoose) {
      this.model.root.add(this.model.board);
      this.model.board.position.set(0, 0, 0);
      this.model.board.quaternion.identity();
      this.boardLoose = false;
    }
    this.model.root.quaternion.identity();
    this.applyTransform();
  }

  get speed() {
    return this.vel.length();
  }

  update(dt, input) {
    this.events.length = 0;
    if (this.crashed) {
      this.updateCrash(dt);
      return;
    }
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(STEP, t);
      this.step(h, input);
      t -= h;
      if (this.crashed) break;
    }
    this.animate(dt);
  }

  step(dt, input) {
    const road = this.road;
    const f = road.sample(this.s, this.frame);
    const speed = this.vel.length();
    const ux = Math.sin(this.yaw), uz = -Math.cos(this.yaw); // deck forward
    const rx = -uz, rz = ux; // deck right (toe side)
    let vLong = this.vel.x * ux + this.vel.y * uz;

    // Rider inputs, smoothed so the board responds like a body would.
    this.steer += clamp(input.steer - this.steer, -dt * 4.5, dt * 4.5);
    // Touch gives analogue tuck and air brake; keys and triggers are all-or-nothing.
    const wantTuck = this.slideMode ? 0 : Math.max(input.tuck || 0, input.up && speed > 6 ? 1 : 0);
    this.tuck += clamp(wantTuck - this.tuck, -dt * 3, dt * 2.5);
    const wantAir = this.slideMode ? 0 : input.air || 0;
    this.airbrake += clamp(wantAir - this.airbrake, -dt * 3, dt * 3);
    this.brake += clamp((input.down && !this.slideMode && speed > 0.3 ? 1 : 0) - this.brake, -dt * 5, dt * 5);
    const wantPush = (input.up || input.push) && speed < 7 && !this.slideMode && !input.down;
    this.push += clamp((wantPush ? 1 : 0) - this.push, -dt * 4, dt * 4);

    // Slide initiation / release.
    if (input.slide && !this.slideMode && speed > 3) {
      this.slideMode = true;
      this.slideDir = Math.abs(this.steer) > 0.15 ? Math.sign(this.steer) : this.slideDir;
      this.events.push('slideStart');
    } else if (!input.slide && this.slideMode) {
      this.slideMode = false;
      const a = Math.abs(this.slip);
      const d = this.diff;
      if (d.highside && speed > d.highsideSpeed && a > d.highsideSlip && a < Math.PI - 0.7) {
        this.crash('Highsided: the wheels hooked up while sideways');
        return;
      }
    }

    // Forces (as accelerations) in the horizontal plane.
    const gAlong = (G * f.grade) / Math.sqrt(1 + f.grade * f.grade);
    let ax = f.dirX * gAlong;
    let az = f.dirZ * gAlong;
    const cda = lerp(lerp(CDA_UPRIGHT, CDA_TUCK, this.tuck), CDA_AIRBRAKE, this.airbrake) + (this.slideMode ? 0.08 : 0);
    const dragK = (0.5 * RHO * cda) / MASS;
    ax -= dragK * speed * this.vel.x;
    az -= dragK * speed * this.vel.y;

    // Longitudinal: rolling resistance, footbrake, pushing.
    const onGravel = Math.abs(this.d) > HALF_WIDTH;
    this.dirt = road.dirtAt(this.s, this.d);
    let crr = CRR + (onGravel ? 0.12 : 0) + this.dirt * 0.03;
    let long = -crr * G * Math.sign(vLong);
    if (this.brake > 0.5 && !this.sliding) long -= 3.2 * this.brake * Math.sign(vLong);
    if (this.push > 0.5 && vLong > -0.5) long += 1.9;
    // Don't let resistance reverse the board.
    if (Math.abs(vLong) < Math.abs(long) * dt && long * vLong < 0) long = -vLong / dt;
    ax += ux * long;
    az += uz * long;

    // Predict velocity, then decide how much lateral force the wheels can give.
    let nvx = this.vel.x + ax * dt;
    let nvz = this.vel.y + az * dt;
    const vLat = nvx * rx + nvz * rz;
    const need = -vLat / dt;
    const mu = this.slideMode || this.sliding ? this.diff.muKinetic : this.diff.muStatic;
    const cap = mu * G * (onGravel ? 0.75 : 1) * lerp(1, this.diff.dirtGrip, this.dirt);
    let aLat;
    if (!this.slideMode && Math.abs(need) <= cap) {
      aLat = need;
      this.sliding = false;
    } else {
      aLat = clamp(need, -cap, cap);
      this.sliding = Math.abs(vLat) > 0.25;
    }
    nvx += rx * aLat * dt;
    nvz += rz * aLat * dt;
    this.vel.set(nvx, nvz);
    this.accLocal.set(aLat, long);

    // Board yaw.
    const v = this.vel.length();
    vLong = nvx * ux + nvz * uz;
    const travel = Math.atan2(nvx, -nvz);
    this.slip = v > 0.5 ? wrap(this.yaw - travel) : 0;
    let yawRate;
    if (this.slideMode) {
      // Steering into the slide opens it up; steering out closes it down.
      const base = 1.3 + 0.55 * this.steer * this.slideDir;
      const target = this.slideDir * clamp(base, 0.7, 1.8);
      yawRate = clamp((target - this.slip) * 9, -6.5, 6.5);
    } else if (this.sliding || Math.abs(this.slip) > 0.15) {
      // Wheels hooking back up: rotate the deck back in line with travel,
      // or all the way round to fakie if that's closer.
      const target = Math.abs(this.slip) > Math.PI / 2 ? Math.sign(this.slip) * Math.PI : 0;
      yawRate = clamp((target - this.slip) * 6, -5, 5) + vLong * this.carveCurvature(v) * 0.5;
    } else {
      yawRate = vLong * this.carveCurvature(v);
    }
    yawRate += this.updateWobble(dt, v);
    if (this.crashed) return;
    this.yaw = wrap(this.yaw + yawRate * dt);
    if (Math.abs(this.slip) > Math.PI * 0.9 && !this.slideMode && !this.sliding) {
      // Completed a 180: we are now riding the other way round.
      this.fakie = !this.fakie;
      this.yaw = wrap(this.yaw + Math.PI);
      this.slip = wrap(this.slip + Math.PI);
      this.slideDir = -this.slideDir;
      this.events.push('fakie');
    }

    // Integrate position and resolve against the road edges.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    const prevS = this.s;
    const p = road.project(this.pos.x, this.pos.z, this.s, this.proj);
    this.s = p.s;
    this.d = p.d;
    this.distance += Math.max(0, this.s - prevS);
    this.pos.y = p.y;
    this.surface = onGravel ? 'gravel' : 'asphalt';
    this.checkEdges(p);
    this.model.spinWheels(Math.abs(vLong) * dt);
  }

  // Speed wobbles (Pro): energy builds above a threshold speed, faster when
  // upright or making jerky inputs; tucking and smooth lines keep it calm,
  // and throwing a slide kills it.
  updateWobble(dt, v) {
    const d = this.diff;
    const steerRate = Math.abs(this.steer - this.prevSteer) / dt;
    this.prevSteer = this.steer;
    if (!d.wobble) return 0;
    const over = v - d.wobbleSpeed;
    let grow = over > 0 ? over * 0.035 * (1.2 - 0.7 * this.tuck) * (1 + steerRate * 0.8) : 0;
    let decay = 0.25 + (over < 0 ? 0.8 : 0) + (this.slideMode ? 2 : 0);
    this.wobble = Math.max(0, this.wobble + (grow - decay * this.wobble) * dt);
    if (this.wobble > 1) {
      this.crash('Speed wobbles threw you off');
      return 0;
    }
    this.wobblePhase += dt * Math.PI * 2 * (7 + v * 0.1);
    return Math.cos(this.wobblePhase) * this.wobble * 2.5;
  }

  // Pro only: letting go of the slide right now would highside.
  get highsideRisk() {
    const d = this.diff;
    const a = Math.abs(this.slip);
    return !!d.highside && this.slideMode && this.speed > d.highsideSpeed && a > d.highsideSlip && a < Math.PI - 0.7;
  }

  carveCurvature(v) {
    // A board can carve tighter than the wheels can hold at speed; cap the
    // demand just under the grip limit so full lock is a fast, clean carve.
    const gripLimit = (this.diff.muStatic * this.diff.carveLimit * G) / Math.max(v * v, 0.01);
    return this.steer * Math.min(MAX_CURVATURE, gripLimit);
  }

  checkEdges(p) {
    const side = Math.sign(p.d);
    const absD = Math.abs(p.d);
    const rail = RoadMesh.railSide(this.road.c[Math.round(p.s / DS)]) === side;
    const limit = rail ? RAIL_OFFSET - 0.35 : GRAVEL_EDGE;
    if (absD < limit) return;
    const vSide = (this.vel.x * p.rightX + this.vel.y * p.rightZ) * side;
    if (rail) {
      if (vSide > this.diff.railCrashSpeed) {
        this.crash('Hit the guardrail');
        return;
      }
      // Glance off: kill the impact and scrub some speed.
      this.vel.x -= p.rightX * side * vSide * 1.4;
      this.vel.y -= p.rightZ * side * vSide * 1.4;
      this.vel.multiplyScalar(0.985);
      this.pos.x -= p.rightX * side * (absD - limit);
      this.pos.z -= p.rightZ * side * (absD - limit);
      this.shake = Math.max(this.shake, 0.4);
      this.events.push('rail');
    } else if (this.speed > 4) {
      this.crash(p.cliff * side > 0 ? 'Rode into the hillside' : 'Ran off the road');
    } else {
      this.vel.multiplyScalar(0.5);
      this.pos.x -= p.rightX * side * (absD - limit);
      this.pos.z -= p.rightZ * side * (absD - limit);
    }
  }

  crash(reason, impact = null) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.crashTime = 0;
    this.events.push('crash');
    this.shake = 1;
    const v = this.vel;
    if (impact) v.set(impact.x, impact.z);
    this.body = {
      vel: new THREE.Vector3(v.x, 1.5 + this.speed * 0.08, v.y),
      spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8),
    };
    // Board shoots off on its own.
    const board = this.model.board;
    this.scene.attach(board);
    this.boardLoose = true;
    this.boardVel = new THREE.Vector3(v.x * 1.05, 0.8, v.y * 1.05);
    this.boardSpin = (Math.random() - 0.5) * 10;
  }

  groundAt(x, z, s) {
    const p = this.road.project(x, z, s, this.proj);
    if (Math.abs(p.d) < GRAVEL_EDGE) return { y: p.y, s: p.s };
    return { y: Math.max(p.y - 3, this.terrain.heightAt(x, z)), s: p.s };
  }

  updateCrash(dt) {
    this.crashTime += dt;
    const b = this.body;
    const root = this.model.root;
    b.vel.y -= G * dt;
    root.position.addScaledVector(b.vel, dt);
    const g = this.groundAt(root.position.x, root.position.z, this.s);
    this.s = g.s;
    if (root.position.y < g.y + 0.25) {
      root.position.y = g.y + 0.25;
      if (b.vel.y < 0) b.vel.y *= -0.3;
      // Sliding on leathers.
      const h = Math.hypot(b.vel.x, b.vel.z);
      const dec = Math.min(h, 0.6 * G * dt);
      if (h > 0) {
        b.vel.x -= (b.vel.x / h) * dec;
        b.vel.z -= (b.vel.z / h) * dec;
      }
      b.spin.multiplyScalar(1 - Math.min(1, dt * 2.5));
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt));
    root.quaternion.premultiply(q);
    this.pos.copy(root.position);
    this.vel.set(b.vel.x, b.vel.z);

    const board = this.model.board;
    this.boardVel.y -= G * dt;
    board.position.addScaledVector(this.boardVel, dt);
    const gb = this.groundAt(board.position.x, board.position.z, this.s);
    if (board.position.y < gb.y) {
      board.position.y = gb.y;
      this.boardVel.y = Math.abs(this.boardVel.y) * 0.2;
      this.boardVel.x *= 1 - dt * 0.6;
      this.boardVel.z *= 1 - dt * 0.6;
      this.boardSpin *= 1 - dt * 0.8;
    }
    board.rotateY(this.boardSpin * dt);
    this.model.pose({ crouch: 0.6, limp: Math.min(1, this.crashTime * 3) });
  }

  animate(dt) {
    const m = this.model;
    const v = this.speed;
    // Rider lean follows the contact force: into turns when carving, away
    // from travel when sliding.
    const leanX = Math.atan2(this.accLocal.x, G);
    const leanZ = Math.atan2(-this.accLocal.y, G) * 0.6;
    this.lean = lerp(this.lean, leanX, 1 - Math.exp(-dt * 10));
    this.leanZ = lerp(this.leanZ ?? 0, leanZ, 1 - Math.exp(-dt * 8));
    let wantCrouch = this.slideMode ? 0.75 : this.brake > 0.1 ? 0.45 : 0.3 + Math.abs(this.steer) * 0.25;
    wantCrouch = lerp(wantCrouch, 0.05, this.airbrake);
    this.crouch = lerp(this.crouch, wantCrouch, 1 - Math.exp(-dt * 6));
    this.pushPhase += dt * 7 * this.push;
    const wantHand = this.slideMode && Math.abs(this.lean) > 0.25 ? 1 : 0;
    this.handAmount = lerp(this.handAmount, wantHand, 1 - Math.exp(-dt * 10));
    const fakieSign = this.fakie ? -1 : 1;

    this.applyTransform();

    // Hand target on the road surface on the leaning side.
    const handSide = Math.sign(this.lean) || 1;
    m.root.updateMatrixWorld(true);
    this.handWorld.set(handSide * 0.62, 0.02, 0.1 * fakieSign);
    m.root.localToWorld(this.handWorld);
    this.handLocal.copy(this.handWorld);
    m.rig.worldToLocal(this.handLocal);

    m.pose({
      crouch: this.crouch,
      tuck: this.tuck,
      spread: this.airbrake,
      brake: this.brake,
      push: this.push,
      pushPhase: this.pushPhase,
      fakie: this.fakie,
      slideHand: this.handAmount > 0.01 ? handSide * fakieSign : 0,
      handAmount: this.handAmount,
      handTargetLocal: this.handLocal,
      lookYaw: clamp(this.slip, -1.2, 1.2) * 0.8,
    });
    this.topSpeed = Math.max(this.topSpeed, v);
    this.shake = Math.max(0, this.shake - dt * 2, this.wobble * 0.5);
  }

  applyTransform() {
    const m = this.model;
    const f = this.road.sample(this.s, this.frame);
    m.root.position.set(this.pos.x, this.pos.y + (this.surface === 'gravel' ? -0.05 : 0), this.pos.z);
    // Align to the road surface: yaw, then tilt to the road normal.
    const n = new THREE.Vector3(f.dirX * f.grade, 1, f.dirZ * f.grade).normalize();
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    m.root.quaternion.copy(qTilt).multiply(qYaw);
    // Deck rolls a little with the trucks; the body leans the rest.
    const deckRoll = clamp(this.lean * 0.3, -0.22, 0.22) * (this.slideMode ? 0.3 : 1);
    m.deck.rotation.z = -deckRoll;
    m.lean.rotation.z = -(this.lean - deckRoll);
    m.lean.rotation.x = this.leanZ ?? 0;
    m.lean.position.y = DECK_HEIGHT;
    m.rig.rotation.y = this.fakie ? Math.PI : 0;
  }
}
