// Rider physics: a rigid board-plus-rider on two trucks.
//
// - Steering: the rider leans and the deck rolls on its bushings; the angled
//   truck kingpins turn that roll into steer (front truck into the turn, rear
//   truck out of it), which sets the carve radius.
// - Balance: the rider's centre of mass is a pendulum that has to lean into
//   the turn to match the cornering force. Leaning takes time, so turn-in
//   gets lazier the faster you go, just like the real thing.
// - Wheels: each truck's pair of wheels grips up to a peak slip angle, then
//   breaks away and slides on urethane at a lower, kinetic friction. Grip is
//   solved per truck with impulses, so drifts, powerslides, hook-ups and 180s
//   come out of the same model.
// - Weight shift moves load between the trucks: weight forward lets the tail
//   step out to start a slide and calms speed wobbles.
// - Aero drag depends on the body: upright, progressive tuck or air brake.
//
// Inputs (see Input.update):
//   steer -1..1   lean left/right to carve
//   tuck  0..1    progressive tuck (touch); `up` = full tuck when fast, or push when slow
//   air   0..1    air brake: stand tall with arms spread
//   push  bool    kick while true (a touch tap holds it for one stroke)
//   slide bool    hold to throw and hold a powerslide: stood up on both feet
//                 when riding straight, hand down to the inside when turning
//   down  bool    brake: air brake at speed, footbrake when slow
//   downAmount 0..1 how hard (analogue trigger)

import * as THREE from 'three';
import { RiderModel } from './rider.js';
import { Ragdoll, LooseBoard } from './ragdoll.js';
import { DS, HALF_WIDTH, GRAVEL_EDGE, RAIL_OFFSET } from './road.js';
import { clamp, lerp } from './noise.js';
import { TUNING } from './settings.js';

const G = 9.81;
const MASS = 82; // rider + board, kg
const YAW_INERTIA = 9; // kg m², rider standing side-on along the board
const RHO = 1.2;
const CDA_UPRIGHT = 0.46;
const CDA_TUCK = 0.19; // a race tuck in leathers
const CDA_AIRBRAKE = 0.95; // stood tall, chest open, arms spread
const AIR_BRAKE_FROM = 9; // m/s: above this the brake button air brakes
const AIR_BRAKE_TO = 6.5; // m/s: below this an air brake turns into a footbrake
const CDA_SLIDE = 0.08; // extra while side-on in a slide
const CRR = 0.008; // high-rebound race urethane on asphalt
const SLIDE_ANGLE = 0.7; // rad: default slide angle to travel (~40°)
const SLIDE_STEER = 0.45; // g of path steering available mid-slide
const SLIDE_PULL = 0.08; // share of the wheels' natural sideways pull kept mid-slide
// Hand-down slide: thrown while carving, the glove's puck on the road takes
// some weight, so the board can hang out further and the path bends harder.
const HAND_TURNING = 0.3; // steer (or ~0.2 rad of carve lean) that counts as turning
const HAND_ANGLE = 0.95; // rad: default slide angle with a hand down (~55°)
const HAND_STEER = 0.65; // g of path steering available
const HAND_DRAG = 0.6; // m/s², the puck scraping
const HAND_HIGHSIDE = 0.3; // rad of extra slip before letting go highsides
const STEP = 1 / 120;

// A typical downhill setup: 48° front and a calmer 42° rear baseplate.
const WHEELBASE = 0.6;
const HALF_BASE = WHEELBASE / 2;
const SIN_FRONT = Math.sin((48 * Math.PI) / 180);
const SIN_REAR = Math.sin((42 * Math.PI) / 180);
const MAX_ROLL = 0.21; // deck roll at full lock (bushings bottom out)
const MAX_CURVATURE = (Math.tan(MAX_ROLL) * (SIN_FRONT + SIN_REAR)) / WHEELBASE; // ~2 m radius

// Urethane grips up to about 6° of slip, then breaks away to sliding friction.
const PEAK_SLIP = 0.1;
const SLIP_FALLOFF = 0.12;
const WOBBLE_SHOVE = 0.8; // peak sideways shove from a full wobble, in g
const BALANCE_WINDOW = 0.12; // rad of lean error the rider can hold through the feet

const PUSH_PERIOD = 0.8; // s per kick
const PUSH_ACCEL = 4; // peak, at a standstill
const PUSH_TOP = 7.5; // m/s: faster than this the foot can't keep up with the road
const FOOTBRAKE = 3.2; // m/s² with the rear foot dragging

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Wheel friction against slip angle: full grip up to the peak, then falling
// away towards sliding friction.
function gripCurve(alpha, muPeak, muSlide) {
  if (alpha <= PEAK_SLIP) return muPeak;
  return muSlide + (muPeak - muSlide) * Math.exp(-(alpha - PEAK_SLIP) / SLIP_FALLOFF);
}

const _axles = [
  { x: HALF_BASE, nx: 0, nz: 0, arm: 0, inv: 0, max: 0, acc: 0, sliding: false },
  { x: -HALF_BASE, nx: 0, nz: 0, arm: 0, inv: 0, max: 0, acc: 0, sliding: false },
];
const _n = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _rv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(scene, road, terrain, diff = TUNING) {
    this.scene = scene;
    this.diff = diff;
    // Endless mode's custom settings (src/endless.js) scale the model:
    // gravity multiplies g, wind blows down the road (m/s, - = headwind),
    // rolling multiplies rolling resistance and boost is a thrust (m/s²)
    // that comes in with the tuck. These defaults leave the physics alone.
    this.mods = { gravity: 1, wind: 0, rolling: 1, boost: 0 };
    this.road = road;
    this.terrain = terrain;
    this.model = new RiderModel();
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2(); // x, z
    this.frame = {};
    this.proj = {};
    this.events = [];
    this.reset(400);
  }

  reset(s) {
    const f = this.road.sample(s, this.frame);
    this.s = s;
    this.d = 1.75;
    this.pos.set(f.x + f.rightX * this.d, f.y, f.z + f.rightZ * this.d);
    this.yaw = f.heading;
    this.yawRate = 0;
    this.vel.set(f.dirX * 6, f.dirZ * 6);
    this.steer = 0;
    this.lean = 0; // centre-of-mass lean, rad, + towards deck right
    this.leanRate = 0;
    this.leanZ = 0; // fore/aft body lean for the pose
    this.roll = 0; // deck roll on the trucks, rad
    this.steerFront = 0; // truck steer angles, rad
    this.steerRear = 0;
    this.curvature = 0;
    this.weight = 0; // -1..1, + = onto the front truck
    this.sliding = false; // wheels currently sliding
    this.slideMode = false; // rider is throwing a slide
    this.slideDir = 1;
    this.handDown = false; // this slide has a hand on the road
    this.handSide = 1; // which hand, in rig space (+ = toe side)
    this.slideRecover = false; // board straightening after a slide
    this.slip = 0; // angle between deck and travel
    this.slipRate = 0;
    this.tuck = 0;
    this.airbrake = 0;
    this.brakeMode = null;
    this.crouch = 0.3;
    this.brake = 0;
    this.push = 0; // 0..1 pose blend
    this.pushT = -1; // time into the current kick, -1 when not pushing
    this.pushPhase = 0;
    this.handAmount = 0;
    this.accLocal = new THREE.Vector2(); // contact accel in deck frame (x right, y forward)
    this.aLat = 0; // smoothed lateral contact accel, for balance
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
    this.ragdoll = this.looseBoard = null;
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
    const d = this.diff;
    const f = road.sample(this.s, this.frame);
    const speed = this.vel.length();
    let ux = Math.sin(this.yaw), uz = -Math.cos(this.yaw); // deck forward
    let rx = -uz, rz = ux; // deck right (toe side)
    const vLong0 = this.vel.x * ux + this.vel.y * uz;
    const straight = Math.abs(this.slip) < 0.4;

    // ---- Rider inputs, limited to how fast a body can move.
    this.steer += clamp((input.steer || 0) - this.steer, -dt * 6, dt * 6);
    const footOff = this.pushT >= 0 || this.brake > 0.05;
    const wantTuck = this.slideMode || footOff || this.brakeMode === 'air' ? 0 : Math.max(input.tuck || 0, input.up && speed > 6 ? 1 : 0);
    this.tuck += clamp(wantTuck - this.tuck, -dt * 3, dt * 2.5);
    // The brake button stands you up into an air brake at speed and drags a
    // foot once slow, the way push and tuck share the up button.
    if (!input.down || this.slideMode) this.brakeMode = null;
    else if (!this.brakeMode) this.brakeMode = speed > AIR_BRAKE_FROM ? 'air' : 'foot';
    else if (this.brakeMode === 'air' && speed < AIR_BRAKE_TO) this.brakeMode = 'foot';
    const airButton = this.brakeMode === 'air' ? input.downAmount ?? 1 : 0;
    const wantAir = this.slideMode ? 0 : Math.max(input.air || 0, airButton);
    this.airbrake += clamp(wantAir - this.airbrake, -dt * 3, dt * 3);
    const wantBrake = this.brakeMode === 'foot' && this.pushT < 0 && speed > 0.3 && straight;
    this.brake += clamp((wantBrake ? 1 : 0) - this.brake, -dt * 5, dt * 4);

    // Pushing: one kick at a time, each needing the foot to match the road.
    const wantPush = (input.push || (input.up && speed < 7)) && !this.slideMode && !input.down && straight;
    if (this.pushT < 0 && wantPush && this.brake < 0.05 && vLong0 < PUSH_TOP - 0.5) this.pushT = 0;
    let pushAcc = 0;
    if (this.pushT >= 0) {
      const ph = this.pushT / PUSH_PERIOD;
      if (ph < 0.6) pushAcc = PUSH_ACCEL * Math.sin((ph / 0.6) * Math.PI) * Math.max(0, 1 - Math.max(0, vLong0) / PUSH_TOP);
      this.pushPhase = ph;
      this.pushT += dt;
      if (this.pushT >= PUSH_PERIOD || this.slideMode) this.pushT = -1;
    }
    this.push += clamp((this.pushT >= 0 ? 1 : 0) - this.push, -dt * 5, dt * 6);

    // Slide initiation / release.
    if (input.slide && !this.slideMode && speed > 3) {
      this.slideMode = true;
      // Thrown mid-turn, a hand goes down to the inside of the turn. Riding
      // straight it's a stand-up slide: steering picks the side, otherwise it
      // goes towards the inside of the bend coming up, so it's never a surprise.
      const steer = Math.abs(input.steer || 0) > Math.abs(this.steer) ? input.steer || 0 : this.steer;
      this.handDown = Math.abs(steer) > HAND_TURNING || Math.abs(this.lean) > HAND_TURNING * 0.7;
      const ahead = road.sample(this.s + 15 + speed * 0.8, this.frame).kappa;
      if (Math.abs(steer) > 0.15) this.slideDir = Math.sign(steer);
      else if (this.handDown) this.slideDir = Math.sign(this.lean);
      else if (Math.abs(ahead) > 1 / 400) this.slideDir = Math.sign(ahead);
      this.slideRecover = false;
      this.events.push(this.handDown ? 'handSlideStart' : 'slideStart');
    } else if (!input.slide && this.slideMode) {
      this.slideMode = false;
      this.slideRecover = true;
      const a = Math.abs(this.slip);
      const hookSlip = d.highsideSlip + (this.handDown ? HAND_HIGHSIDE : 0);
      if (d.highside && speed > d.highsideSpeed && a > hookSlip && a < Math.PI - 0.7) {
        this.crash('Highsided: the wheels hooked up while sideways');
        return;
      }
    }

    // Weight shift: onto the front foot to throw a slide, for a tuck, and
    // whenever the back foot is off the board.
    const wantWeight = clamp((this.slideMode ? 0.4 : 0) + this.tuck * 0.15 + (footOff ? 0.5 : 0) - this.airbrake * 0.1, -1, 1);
    this.weight += clamp(wantWeight - this.weight, -dt * 3, dt * 3);

    // ---- Forces along the road (as accelerations).
    const mods = this.mods;
    const g = G * mods.gravity;
    const cosGrade = 1 / Math.sqrt(1 + f.grade * f.grade);
    const gAlong = g * f.grade * cosGrade;
    let ax = f.dirX * gAlong;
    let az = f.dirZ * gAlong;
    const cda = lerp(lerp(CDA_UPRIGHT, CDA_TUCK, this.tuck), CDA_AIRBRAKE, this.airbrake) + (this.slideMode ? CDA_SLIDE : 0);
    const dragK = (0.5 * RHO * cda) / MASS;
    // Drag acts on the speed through the air, which wind changes.
    const airX = this.vel.x - f.dirX * mods.wind, airZ = this.vel.y - f.dirZ * mods.wind;
    const air = Math.hypot(airX, airZ);
    ax -= dragK * air * airX;
    az -= dragK * air * airZ;

    // Along the deck: rolling resistance, footbrake, pushing.
    const onGravel = Math.abs(this.d) > HALF_WIDTH;
    this.dirt = road.dirtAt(this.s, this.d);
    const crr = CRR * mods.rolling + (onGravel ? 0.12 : 0) + this.dirt * 0.03;
    const boost = mods.boost * this.tuck;
    let long = -crr * g * cosGrade * Math.sign(vLong0) - FOOTBRAKE * this.brake * Math.sign(vLong0) + pushAcc + boost;
    // Don't let resistance reverse the board.
    if (pushAcc === 0 && boost === 0 && Math.abs(vLong0) < Math.abs(long) * dt && long * vLong0 < 0) long = -vLong0 / dt;
    ax += ux * long;
    az += uz * long;
    // A glove on the road scrapes against the direction of travel.
    if (this.slideMode && this.handDown && speed > 1) {
      const drag = (HAND_DRAG * this.handAmount) / speed;
      ax -= this.vel.x * drag;
      az -= this.vel.y * drag;
    }
    let vx = this.vel.x + ax * dt;
    let vz = this.vel.y + az * dt;

    // ---- Rider's yaw effort: twisting the board into and through a slide,
    // or straightening it out of a drift. Only does much once wheels slide.
    const v = Math.hypot(vx, vz);
    const travel = Math.atan2(vx, -vz);
    const slip = v > 0.5 ? wrap(this.yaw - travel) : 0;
    let yawAcc;
    if (this.slideMode) {
      // A controllable drift by default, about 40° to travel, so most of the
      // speed carries. Steering into the slide opens it a little; brake throws
      // it fully sideways to scrub hard; tuck closes it down to carry speed.
      const base = (this.handDown ? HAND_ANGLE : SLIDE_ANGLE) + 0.25 * this.steer * this.slideDir + (input.down ? 0.9 : 0) - 0.25 * Math.max(input.up ? 1 : 0, input.tuck || 0);
      const target = this.slideDir * clamp(base, 0.4, 1.9);
      yawAcc = clamp(40 * (target - slip) - 9 * this.slipRate, -45, 45);
    } else {
      // Hook back up in line with travel, or all the way round to fakie.
      const target = Math.abs(slip) > Math.PI / 2 ? Math.sign(slip) * Math.PI : 0;
      yawAcc = clamp(d.recover * (target - slip) - 5 * this.slipRate, -30, 30);
    }
    this.yawRate += yawAcc * dt;

    // ---- Lean to steer. The rider wants a carve; the body has to lean to
    // match it before the deck can roll that far.
    const v2 = Math.max(v * v, 0.25);
    const vLong = vx * ux + vz * uz;
    const rolling = !this.slideMode && vLong > 0;
    const kWant = rolling ? this.steer * Math.min(MAX_CURVATURE, (d.carveLimit * d.muStatic * G) / v2) : 0;
    const carveLean = Math.atan((v2 * kWant) / G);
    const heldLean = Math.atan(this.aLat / G);
    // In a slide or a drift the body has to lean against what the wheels give.
    const leanTarget = this.slideMode ? heldLean : this.sliding ? lerp(carveLean, heldLean, 0.6) : carveLean;
    const w = d.leanRate;
    this.leanRate += (w * w * (leanTarget - this.lean) - 2 * w * this.leanRate) * dt;
    this.lean += this.leanRate * dt;
    let k = kWant;
    if (rolling) {
      k = clamp(k, (G * Math.tan(this.lean - BALANCE_WINDOW)) / v2, (G * Math.tan(this.lean + BALANCE_WINDOW)) / v2);
    }
    this.curvature = clamp(k, -MAX_CURVATURE, MAX_CURVATURE);
    this.roll = Math.atan((this.curvature * WHEELBASE) / (SIN_FRONT + SIN_REAR)) + this.updateWobble(dt, v);
    if (this.crashed) return;
    // Riding fakie, the 42° truck leads.
    const tanRoll = Math.tan(this.roll);
    this.steerFront = Math.atan(tanRoll * (this.fakie ? SIN_REAR : SIN_FRONT));
    this.steerRear = -Math.atan(tanRoll * (this.fakie ? SIN_FRONT : SIN_REAR));

    // ---- Wheels: grip impulses at each truck, solved iteratively.
    const N = MASS * g * cosGrade;
    const share = 0.3 * this.weight;
    const gripScale = (onGravel ? 0.75 : 1) * lerp(1, d.dirtGrip, this.dirt);
    let r = this.yawRate;
    for (let i = 0; i < 2; i++) {
      const a = _axles[i];
      const delta = i === 0 ? this.steerFront : this.steerRear;
      const c = Math.cos(delta), sn = Math.sin(delta);
      // Wheel rolling direction e, and lateral n (along which grip acts).
      const ex = c * ux + sn * rx, ez = c * uz + sn * rz;
      a.nx = -sn * ux + c * rx;
      a.nz = -sn * uz + c * rz;
      a.arm = a.x * c;
      a.inv = 1 / MASS + (a.arm * a.arm) / YAW_INERTIA;
      const px = vx + r * a.x * rx, pz = vz + r * a.x * rz;
      const vn = px * a.nx + pz * a.nz;
      const ve = px * ex + pz * ez;
      const alpha = Math.atan2(Math.abs(vn), Math.abs(ve) + 0.5);
      const load = N * (i === 0 ? 0.5 + share : 0.5 - share);
      a.max = gripCurve(alpha, d.muStatic, d.muKinetic) * gripScale * load * dt;
      a.acc = 0;
    }
    const vx0 = vx, vz0 = vz;
    for (let it = 0; it < 4; it++) {
      for (const a of _axles) {
        const vn = (vx + r * a.x * rx) * a.nx + (vz + r * a.x * rz) * a.nz;
        const acc = clamp(a.acc - vn / a.inv, -a.max, a.max);
        const dj = acc - a.acc;
        a.acc = acc;
        vx += (a.nx * dj) / MASS;
        vz += (a.nz * dj) / MASS;
        r += (a.arm * dj) / YAW_INERTIA;
      }
    }
    let latImpulse = 0;
    let longImpulse = 0;
    this.sliding = false;
    for (const a of _axles) {
      const vn = (vx + r * a.x * rx) * a.nx + (vz + r * a.x * rz) * a.nz;
      a.sliding = Math.abs(a.acc) > a.max * 0.98 && Math.abs(vn) > 0.3;
      if (a.sliding) this.sliding = true;
      latImpulse += a.acc * (a.nx * rx + a.nz * rz);
      longImpulse += a.acc * (a.nx * ux + a.nz * uz);
    }
    // The stick keeps the path while the slide is held and while the board
    // straightens up after it; otherwise the wheels would drag the rider off
    // towards where the nose pointed. A little natural pull stays mid-slide.
    if (this.slideRecover && Math.abs(this.slip) < 0.08) this.slideRecover = false;
    if (this.slideMode || this.slideRecover) {
      [vx, vz] = this.steerSlide(vx0, vz0, vx, vz, dt, gripScale, this.slideMode ? SLIDE_PULL : 0);
    }
    this.vel.set(vx, vz);
    this.yawRate = r;
    const aLat = latImpulse / (MASS * dt);
    this.accLocal.set(aLat, long + longImpulse / (MASS * dt));
    this.aLat += (aLat - this.aLat) * Math.min(1, dt * 15);

    // ---- Board yaw.
    this.yaw = wrap(this.yaw + r * dt);
    const vNow = this.vel.length();
    const newSlip = vNow > 0.5 ? wrap(this.yaw - Math.atan2(vx, -vz)) : 0;
    this.slipRate += (wrap(newSlip - this.slip) / dt - this.slipRate) * Math.min(1, dt * 30);
    this.slip = newSlip;
    if (Math.abs(this.slip) > Math.PI * 0.75 && !this.slideMode && !this.sliding) {
      // Completed a 180: we are now riding the other way round.
      this.fakie = !this.fakie;
      this.yaw = wrap(this.yaw + Math.PI);
      this.slip = wrap(this.slip + Math.PI);
      this.slideDir = -this.slideDir;
      this.lean = -this.lean;
      this.leanRate = -this.leanRate;
      this.aLat = -this.aLat;
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
    ux = Math.sin(this.yaw);
    uz = -Math.cos(this.yaw);
    this.model.spinWheels((this.vel.x * ux + this.vel.y * uz) * dt);
  }

  // Speed wobbles: above a threshold speed the trucks start to shimmy, and
  // the shimmy settles at a level set by how far over you are and how you
  // stand: a tuck with weight forward keeps it small, riding upright or air
  // braking lets it grow. Jerky steering fights it and pumps it up; only
  // fighting it hard, or riding far over the threshold, throws you off.
  // Throwing a slide kills it. Returns the deck roll it adds to the steering:
  // sized so the sideways shove peaks at WOBBLE_SHOVE at any speed (a fixed
  // roll would steer harder with the square of speed and spin the board out
  // at 130 km/h). The deck shows a bigger, visual-only shimmy.
  updateWobble(dt, v) {
    const d = this.diff;
    const steerRate = Math.abs(this.steer - this.prevSteer) / dt;
    this.prevSteer = this.steer;
    if (!d.wobble) {
      this.wobble = 0;
      this.wobbleRoll = 0;
      return 0;
    }
    const over = v - d.wobbleSpeed - this.weight * 3;
    const stance = 1 - 0.45 * this.tuck + 0.15 * this.airbrake;
    // Well over the threshold it keeps getting worse, but ever more slowly.
    const excess = Math.max(0, over) / 12;
    const target = this.slideMode ? 0 : (excess / (1 + 0.35 * excess)) * stance;
    const rate = target > this.wobble ? 0.6 : 1.5;
    const fight = over > 0 ? Math.max(0, steerRate - 3) * 0.1 * Math.min(1, over / 3) : 0;
    this.wobble = Math.max(0, this.wobble + ((target - this.wobble) * rate + fight) * dt);
    if (this.wobble > 1) {
      this.crash('Speed wobbles threw you off');
      return 0;
    }
    this.wobblePhase += dt * Math.PI * 2 * (6 + Math.min(v, 40) * 0.1);
    const s = Math.sin(this.wobblePhase) * this.wobble;
    this.wobbleRoll = s * 0.05;
    const v2 = Math.max(v * v, 100);
    return Math.atan((s * WOBBLE_SHOVE * G * WHEELBASE) / (v2 * (SIN_FRONT + SIN_REAR)));
  }



  // While sliding, the rider steers the path by weighting toes or heels: the
  // sideways pull the wheels give is replaced by one the stick asks for (a
  // little of the natural pull towards the nose stays), within what sliding
  // urethane can deliver. The board's slip target follows the new heading.
  steerSlide(vx0, vz0, vx, vz, dt, gripScale, pull) {
    const v = Math.hypot(vx, vz);
    if (v < 2) return [vx, vz];
    const rx = -vz / v, rz = vx / v; // right of travel
    const aWheels = ((vx - vx0) * rx + (vz - vz0) * rz) / dt;
    const cap = this.diff.muKinetic * G * gripScale;
    const want = clamp(this.steer * (this.handDown && this.slideMode ? HAND_STEER : SLIDE_STEER) * G * gripScale + pull * aWheels, -cap, cap);
    const dv = (want - aWheels) * dt;
    return [vx + rx * dv, vz + rz * dv];
  }

  // Pro only: letting go of the slide right now would highside.
  get highsideRisk() {
    const d = this.diff;
    const a = Math.abs(this.slip);
    const hookSlip = d.highsideSlip + (this.handDown ? HAND_HIGHSIDE : 0);
    return !!d.highside && this.slideMode && this.speed > d.highsideSpeed && a > hookSlip && a < Math.PI - 0.7;
  }

  checkEdges(p) {
    const side = Math.sign(p.d);
    const absD = Math.abs(p.d);
    const barrier = this.road.barrierAt(p.s, side);
    const rail = !!barrier;
    const limit = rail ? RAIL_OFFSET - 0.35 : GRAVEL_EDGE;
    // Urethane wheels stop dead in loose gravel: any real speed and you go
    // over the nose.
    if (!rail && absD > HALF_WIDTH + this.diff.gravelDepth && this.speed > this.diff.gravelCrashSpeed) {
      this.crash('The wheels dug into the gravel');
      return;
    }
    if (absD < limit) return;
    const vSide = (this.vel.x * p.rightX + this.vel.y * p.rightZ) * side;
    if (rail) {
      if (vSide > this.diff.railCrashSpeed) {
        this.crash(`Hit the ${barrier}`);
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
    this.impactsSeen = 0;
    this.events.push('crash');
    this.shake = 1;
    const v = this.vel;
    if (impact) v.set(impact.x, impact.z);
    // The rider goes limp and tumbles; the board shoots off on its own.
    const world = { road: this.road, terrain: this.terrain };
    const vel = new THREE.Vector3(v.x, 0, v.y);
    this.ragdoll = new Ragdoll(this.model, world, vel, this.s);
    const board = this.model.board;
    this.scene.attach(board);
    this.boardLoose = true;
    this.looseBoard = new LooseBoard(board, world, vel, this.s);
  }

  updateCrash(dt) {
    this.crashTime += dt;
    const r = this.ragdoll;
    r.update(dt);
    this.s = r.s;
    this.pos.copy(r.hip);
    r.velocity(_rv);
    this.vel.set(_rv.x, _rv.z);
    this.looseBoard.update(dt);
    // A jolt each time the body slams down.
    if (r.impacts > this.impactsSeen) this.shake = Math.max(this.shake, 0.5);
    this.impactsSeen = r.impacts;
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  animate(dt) {
    const m = this.model;
    const v = this.speed;
    // Fore/aft: the body leans against the push, the brake and the drag.
    this.leanZ = lerp(this.leanZ, Math.atan2(-this.accLocal.y, G) * 0.6, 1 - Math.exp(-dt * 8));
    let wantCrouch = this.slideMode ? (this.handDown ? 1 : 0.75) : this.brake > 0.1 ? 0.45 : 0.3 + Math.min(0.35, Math.abs(this.lean) * 0.6);
    wantCrouch = lerp(wantCrouch, 0.05, this.airbrake);
    this.crouch = lerp(this.crouch, wantCrouch, 1 - Math.exp(-dt * 6));
    const wantHand = this.slideMode && this.handDown ? 1 : 0;
    this.handAmount = lerp(this.handAmount, wantHand, 1 - Math.exp(-dt * 7));

    this.applyTransform();

    // The rig is turned round when riding fakie, so mirror into rig space.
    const sgn = this.fakie ? -1 : 1;
    const lean = this.lean * sgn;
    this.handSide = this.slideDir * sgn; // toe side +, in rig space
    m.pose({
      roll: this.roll * sgn,
      lean,
      pitch: this.leanZ,
      weight: this.weight,
      crouch: this.crouch,
      tuck: this.tuck,
      spread: this.airbrake,
      brake: this.brake,
      push: this.push,
      pushPhase: this.pushPhase,
      fakie: this.fakie,
      slideHand: this.handAmount > 0.01 ? this.handSide : 0,
      handAmount: this.handAmount,
      lookYaw: clamp(this.slip, -1.2, 1.2) * 0.8,
    });
    this.topSpeed = Math.max(this.topSpeed, v);
    this.shake = Math.max(0, this.shake - dt * 2, this.wobble * 0.5);
  }

  // World position of the glove on the road, or null when no hand is down.
  gloveOnRoad(out) {
    if (this.crashed || this.handAmount < 0.7) return null;
    const m = this.model;
    m.rig.updateWorldMatrix(true, false);
    return m.rig.localToWorld(out.copy(m.joints[this.handSide > 0 ? 'haF' : 'haR']));
  }

  applyTransform() {
    const m = this.model;
    const f = this.road.sample(this.s, this.frame);
    m.root.position.set(this.pos.x, this.pos.y + (this.surface === 'gravel' ? -0.05 : 0), this.pos.z);
    // Align to the road surface: yaw, then tilt to the road normal.
    _n.set(f.dirX * f.grade, 1, f.dirZ * f.grade).normalize();
    _qa.setFromUnitVectors(UP, _n);
    _qb.setFromAxisAngle(UP, -this.yaw);
    m.root.quaternion.copy(_qa).multiply(_qb);
    // Deck rolls on the bushings; trucks steer (front into the turn, rear out).
    m.deck.rotation.z = -(this.roll + (this.wobbleRoll || 0));
    m.trucks[0].rotation.y = -this.steerFront;
    m.trucks[1].rotation.y = -this.steerRear;
    m.rig.rotation.y = this.fakie ? Math.PI : 0;
  }
}
