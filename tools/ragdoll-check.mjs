// Headless ragdoll check: crashes the rider at several speeds on a straight
// test road and prints where the body and board end up, how long they take
// to stop, and the worst bone stretch or backwards knee seen on the way.
//   node tools/ragdoll-check.mjs
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const offline = (e) => /fetch failed/.test(String(e?.stack ?? e));
process.on('unhandledRejection', (e) => {
  if (!offline(e)) throw e;
});
const logError = console.error;
console.error = (...a) => a.some(offline) || logError(...a);
const { Player } = await import('../src/player.js');
const { TUNING } = await import('../src/settings.js');
const THREE = await import('three');
let seed = 7;
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

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
// A grass verge just below the road.
const terrain = { heightAt: (x, z) => z * 0.08 - 0.3 };
const DT = 1 / 60;
const BONES = [['hipF', 'kneeF', 0.46], ['kneeF', 'footF', 0.45], ['shF', 'elF', 0.3], ['elF', 'haF', 0.29]];

for (const [speed, side] of [[8, 0], [15, 0.4], [22, -0.4], [30, 1]]) {
  const p = new Player(scene, new TestRoad(0.08), terrain, TUNING);
  p.reset(100);
  p.vel.set(side * speed * 0.3, -speed);
  p.update(DT, {});
  p.crash('test');
  const start = p.pos.clone();
  let stop = null, stretch = 0, lowest = Infinity, maxH = -Infinity;
  for (let t = 0; t < 6; t += DT) {
    p.update(DT, {});
    const P = p.ragdoll.pos;
    for (const [a, b, l] of BONES) { const e = Math.abs(P[a].distanceTo(P[b]) - l) / l; if (e > stretch) { stretch = e; if (process.env.V) console.log(t.toFixed(2), a, b, e.toFixed(2), P[a].x.toFixed(2), (P[a].y - p.road.sample(p.s).y).toFixed(2), P[b].x.toFixed(2), (P[b].y - p.road.sample(p.s).y).toFixed(2)); } }
    const g = p.road.sample(p.s).y;
    lowest = Math.min(lowest, P.head.y - g);
    maxH = Math.max(maxH, P.hip.y - g);
    if (stop === null && p.ragdoll.speed < 0.3 && t > 0.5) stop = t;
    if (!Number.isFinite(P.hip.x)) throw new Error('NaN');
  }
  const b = p.model.board.position;
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.model.board.quaternion).y;
  console.log(`${(speed * 3.6).toFixed(0).padStart(3)} km/h: body slid ${p.pos.distanceTo(start).toFixed(1)} m, stopped at ${stop?.toFixed(1) ?? '>6'} s, peak hip ${maxH.toFixed(2)} m, head min ${lowest.toFixed(2)} m above road, worst stretch ${(stretch * 100).toFixed(1)}%; board ${b.distanceTo(start).toFixed(1)} m away, ${up > 0 ? 'wheels down' : 'wheels up'}`);
}
