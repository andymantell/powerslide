// Headless physics checks: `npm run sim`. Runs the rider model without a
// browser on a straight test road and on a generated mountain road, and
// prints the numbers that matter for feel (top speeds, turn-in, slides).

globalThis.document = { createElement: () => ({ getContext: () => null }) };
// Models and textures can't load in Node, and the physics doesn't need them.
const offline = (e) => /fetch failed/.test(String(e?.stack ?? e));
process.on('unhandledRejection', (e) => {
  if (!offline(e)) throw e;
});
const logError = console.error;
console.error = (...a) => a.some(offline) || logError(...a);
const { Player } = await import('../src/player.js');
const { Road } = await import('../src/road.js');
const { TUNING } = await import('../src/settings.js');
const THREE = await import('three');

// Straight road down -Z at a fixed grade.
class TestRoad {
  constructor(grade) {
    this.grade = grade;
    this.c = new Float64Array(1 << 16);
  }
  ensure() {}
  dirtAt() {
    return 0;
  }
  sample(s, out = {}) {
    Object.assign(out, { x: 0, y: -s * this.grade, z: -s, heading: 0, kappa: 0, grade: this.grade, cliff: 0, dirX: 0, dirZ: -1, rightX: 1, rightZ: 0 });
    return out;
  }
  project(px, pz, hint, out = {}) {
    this.sample(-pz, out);
    out.s = -pz;
    out.d = px;
    return out;
  }
}

const scene = new THREE.Scene();
const terrain = { heightAt: () => -1e9 };
const DT = 1 / 60;
const fmt = (v) => (v * 3.6).toFixed(1).padStart(5) + ' km/h';

function make(grade, speed = 6) {
  const p = new Player(scene, new TestRoad(grade), terrain, TUNING);
  p.reset(100);
  p.d = 0;
  p.pos.x = 0;
  p.vel.set(0, -speed);
  p.yaw = 0;
  return p;
}
const run = (p, secs, input, each) => {
  for (let t = 0; t < secs; t += DT) {
    p.update(DT, typeof input === 'function' ? input(p, t) : input);
    each?.(p, t);
    if (p.crashed) return t;
  }
  return null;
};
// Hold the lane: steer back towards d = 0, heading along the road.
const keepLane = (p) => {
  const travel = Math.atan2(p.vel.x, -p.vel.y);
  return Math.max(-1, Math.min(1, -0.25 * p.d - 1.5 * travel));
};

console.log('== Straight-line speed (60 s from 20 km/h)');
for (const grade of [0.05, 0.08, 0.12]) {
  const row = [];
  for (const [name, inp] of [['upright', {}], ['tuck', { tuck: 1 }], ['air', { air: 1 }]]) {
    const p = make(grade, 5.5);
    run(p, 60, (pp) => ({ ...inp, steer: keepLane(pp) }));
    row.push(`${name} ${fmt(p.crashed ? p.topSpeed : p.speed)}${p.crashed ? ' (then crashed: ' + p.crashReason + ')' : ''}`);
  }
  console.log(`grade ${(grade * 100).toFixed(0)}%: ${row.join('  ')}`);
}

console.log('\n== Braking from 70 km/h on 8%');
for (const [name, inp] of [['air brake', { air: 1 }], ['brake btn', { down: true }], ['slide', { slide: true }]]) {
  const p = make(0.08, 70 / 3.6);
  let t30 = null;
  run(p, 12, (pp) => ({ ...inp, steer: inp.slide ? 0 : keepLane(pp) }), (pp, t) => {
    if (t30 === null && pp.speed < 30 / 3.6) t30 = t;
  });
  console.log(`${name.padEnd(10)} to 30 km/h: ${t30 === null ? 'never' : t30.toFixed(1) + ' s'}  (after 12 s ${fmt(p.speed)})`);
}

console.log('\n== Carving, full lock on a flat road');
{
  for (const kmh of [10, 30, 50, 70]) {
    const p = make(0, kmh / 3.6);
    let t90 = null;
    let steady = 0;
    const samples = [];
    run(p, 1.5, { steer: 1 }, (pp, t) => samples.push([t, pp.yawRate]));
    steady = samples[samples.length - 1][1];
    for (const [t, r] of samples) if (t90 === null && r > 0.9 * steady) t90 = t;
    const radius = p.speed / Math.max(1e-6, steady);
    console.log(`${String(kmh).padStart(3)} km/h: radius ${radius.toFixed(1).padStart(5)} m, lat ${(p.speed * steady / 9.81).toFixed(2)} g, turn-in ${t90?.toFixed(2)} s, lean ${(p.lean * 57.3).toFixed(0)}°, roll ${(p.roll * 57.3).toFixed(1)}°, sliding ${p.sliding}`);
  }
}

console.log('\n== Powerslide from 60 km/h on 8%');
{
  const p = make(0.08, 60 / 3.6);
  let maxSlip = 0;
  run(p, 1.5, { slide: true, steer: 0 }, (pp) => (maxSlip = Math.max(maxSlip, Math.abs(pp.slip))));
  const after = p.speed;
  // Steer out to close it down, then release.
  run(p, 0.6, { slide: true, steer: -1 * p.slideDir });
  const closed = p.slip;
  const crash = run(p, 0.8, { steer: 0 });
  console.log(`1.5 s slide: ${fmt(after)}, max slip ${(maxSlip * 57.3).toFixed(0)}°, closed to ${(closed * 57.3).toFixed(0)}°, 0.8 s after release ${fmt(p.speed)}, slip ${(p.slip * 57.3).toFixed(0)}°, ${crash !== null ? 'CRASH: ' + p.crashReason : 'rode away'}`);
  // Letting go while fully sideways (brake held to throw it wide) instead.
  const q = make(0.08, 60 / 3.6);
  run(q, 0.5, { slide: true, steer: 0, down: true });
  const at = q.speed;
  const c2 = run(q, 1, { steer: 0 });
  console.log(`let go fully sideways at ${fmt(at)}: ${c2 !== null ? 'CRASH: ' + q.crashReason : 'rode away'}`);
}

// Throwing a slide while steering puts a hand down, so these throw it straight
// and steer once it's going.
const throwStraight = (p) => run(p, 0.05, { slide: true, steer: 0 });

console.log('\n== Steering mid-slide (50 km/h on 6%, 1.2 s): sideways travel');
for (const steer of [-1, 0, 1]) {
  const p = make(0.06, 50 / 3.6);
  throwStraight(p);
  run(p, 1.15, { slide: true, steer });
  console.log(`steer ${String(steer).padStart(2)}: moved ${p.pos.x.toFixed(2).padStart(6)} m across, ${fmt(p.speed)}, slip ${(p.slip * 57.3).toFixed(0)}°`);
}
{
  const p = make(0.06, 50 / 3.6);
  run(p, 1.2, { slide: true, steer: 0, down: true });
  console.log(`brake held (full scrub): ${fmt(p.speed)}, slip ${(p.slip * 57.3).toFixed(0)}°`);
}

console.log('\n== Letting go of a slide keeps your line (50 km/h on 6%, 1.5 s slide, then 1.5 s)');
for (const steer of [-0.5, 0, 0.5]) {
  const p = make(0.06, 50 / 3.6);
  throwStraight(p);
  run(p, 1.45, { slide: true, steer });
  const before = Math.atan2(p.vel.x, -p.vel.y);
  let swing = 0;
  const crash = run(p, 1.5, { steer: 0 }, (pp) => {
    swing = Math.max(swing, Math.abs(Math.atan2(pp.vel.x, -pp.vel.y) - before));
  });
  console.log(`slide steer ${String(steer).padStart(4)}: heading swing after release ${(swing * 57.3).toFixed(0).padStart(3)}°, ${crash !== null ? 'CRASH: ' + p.crashReason : 'rode away'}`);
}

console.log('\n== 180 to fakie: open the slide wide, then let go (30 km/h, flat)');
{
  const p = make(0.0, 30 / 3.6);
  let fakie = false;
  throwStraight(p);
  run(p, 0.75, { slide: true, steer: 1, down: true }, (pp) => (fakie ||= pp.events.includes('fakie')));
  // Let go past sideways: the rider carries it round instead of back.
  for (let t = 0; t < 1.2 && !fakie; t += DT) {
    p.update(DT, { slide: false, steer: 0 });
    fakie ||= p.events.includes('fakie');
  }
  console.log(`slip after release ${(p.slip * 57.3).toFixed(0)}°, fakie ${p.fakie}, speed ${fmt(p.speed)}`);
}

console.log('\n== Slides holding a turn (50 km/h on 6%, 1.2 s): thrown straight vs mid-carve');
for (const steer of [0.4, 0.8]) {
  for (const hand of [false, true]) {
    const p = make(0.06, 50 / 3.6);
    if (hand) run(p, 0.4, { steer }); // carving when it's thrown: hand down
    else throwStraight(p);
    const h0 = Math.atan2(p.vel.x, -p.vel.y);
    let maxSlip = 0;
    const crash = run(p, 1.2, { slide: true, steer }, (pp) => (maxSlip = Math.max(maxSlip, Math.abs(pp.slip))));
    const turned = Math.atan2(p.vel.x, -p.vel.y) - h0;
    p.animate(DT);
    const glove = p.gloveOnRoad(new THREE.Vector3());
    const gap = glove ? `glove ${(glove.y - p.pos.y).toFixed(2)} m above road` : 'no glove down';
    const end = crash !== null ? 'CRASH: ' + p.crashReason : p.highsideRisk ? 'letting go now highsides' : 'safe to let go';
    console.log(`steer ${steer} ${p.handDown ? 'hand down' : 'stood up '}: path turned ${(turned * 57.3).toFixed(0).padStart(3)}°, ${fmt(p.speed)}, max slip ${(maxSlip * 57.3).toFixed(0)}°, ${gap}, ${end}`);
  }
}

console.log('\n== Pushing from a standstill on the flat (one tap per second)');
{
  const p = make(0, 0);
  const out = [];
  let n = 0;
  run(p, 10, (pp, t) => ({ push: t % 1 < 0.1 }), (pp) => {
    if (++n % 120 === 0) out.push(fmt(pp.speed));
  });
  console.log(`every 2 s: ${out.join(' | ')}`);
  const q = make(0, 0);
  run(q, 10, { up: true });
  console.log(`holding W for 10 s: ${fmt(q.speed)}`);
}

console.log('\n== A strong speed wobble at 85 km/h (flat, held for 1 s)');
{
  const p = make(0, 85 / 3.6);
  let minYaw = 0, maxYaw = 0, slid = 0;
  run(p, 1, () => {
    p.wobble = 0.8;
    return { tuck: 1 };
  }, (pp) => {
    minYaw = Math.min(minYaw, pp.yaw);
    maxYaw = Math.max(maxYaw, pp.yaw);
    if (pp.sliding) slid++;
  });
  console.log(`yaw swing ±${(((maxYaw - minYaw) / 2) * 57.3).toFixed(1)}°, sliding frames ${slid}/60, lateral drift ${p.pos.x.toFixed(2)} m`);
}

console.log('\n== Speed wobbles: 40 s at a held speed (wobble 1 throws you; warning shows above 0.3)');
for (const kmh of [80, 95, 110, 125]) {
  const row = [];
  for (const [name, inp, steer] of [
    ['tucked, smooth', { tuck: 1 }, (p) => keepLane(p)],
    ['upright, smooth', {}, (p) => keepLane(p)],
    ['tucked, jerky', { tuck: 1 }, (p, t) => keepLane(p) + (Math.sin(t * 9) > 0 ? 0.6 : -0.6)],
  ]) {
    const p = make(0, kmh / 3.6);
    let peak = 0;
    const crash = run(p, 40, (pp, t) => {
      pp.vel.setLength(kmh / 3.6); // hold the speed and stay on the road
      pp.pos.x = 0;
      return { ...inp, steer: steer(pp, t) };
    }, (pp) => (peak = Math.max(peak, pp.wobble)));
    row.push(`${name} ${crash !== null ? `CRASH ${crash.toFixed(1)} s${p.crashReason.startsWith('Speed') ? '' : ' (' + p.crashReason + ')'}` : `peak ${peak.toFixed(2)}`}`);
  }
  console.log(`${String(kmh).padStart(3)} km/h: ${row.join('  |  ')}`);
}

console.log('\n== Running into the edge of the road (rail on the left, gravel verge on the right)');
for (const [what, side] of [['guardrail', -1], ['gravel', 1]]) {
  const rows = [];
  for (const kmh of [15, 30, 50, 70]) {
    for (const deg of [3, 8, 15, 30]) {
      const p = make(0, kmh / 3.6);
      p.road.c.fill(side < 0 ? 1 : 0); // mountain on the right puts the rail on the left
      const a = (side * deg * Math.PI) / 180;
      p.pos.x = side * 3.5;
      p.yaw = a;
      p.vel.set(Math.sin(a) * (kmh / 3.6), -Math.cos(a) * (kmh / 3.6));
      run(p, 3, { steer: 0 });
      rows.push(`${String(kmh).padStart(2)} km/h ${String(deg).padStart(2)}°: ${p.crashed ? 'CRASH' : 'ok'}`);
    }
  }
  console.log(`${what}:`);
  for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).join('   '));
}

console.log('\n== A crude autopilot down a generated road, plus step cost');
{
  const road = new Road(42);
  road.ensure(9000);
  const p = new Player(scene, road, terrain, TUNING);
  p.reset(400);
  const f = {};
  let maxLat = 0;
  const t0 = performance.now();
  let steps = 0;
  const crash = run(p, 120, (pp) => {
    road.sample(pp.s + Math.max(4, pp.speed * 0.6), f);
    const travel = Math.atan2(pp.vel.x, -pp.vel.y);
    const hErr = Math.atan2(Math.sin(f.heading - travel), Math.cos(f.heading - travel));
    const want = f.kappa * pp.speed * pp.speed; // lateral accel the bend needs
    const tooFast = Math.abs(want) > 6.5;
    steps++;
    return {
      steer: Math.max(-1, Math.min(1, 1.6 * hErr - 0.2 * (pp.d - 1.75) + f.kappa * 4)),
      tuck: tooFast ? 0 : 1,
      air: tooFast ? 1 : 0,
      slide: Math.abs(want) > 9,
    };
  }, (pp) => (maxLat = Math.max(maxLat, Math.abs(pp.accLocal.x))));
  const ms = (performance.now() - t0) / steps;
  console.log(`${crash !== null ? `crashed at ${crash.toFixed(0)} s: ${p.crashReason}` : 'survived 120 s'}, ${(p.distance / 1000).toFixed(2)} km, top ${fmt(p.topSpeed)}, max lateral ${(maxLat / 9.81).toFixed(2)} g`);
  console.log(`${ms.toFixed(3)} ms per 60 Hz frame of physics + pose (this machine)`);
}
