// Level tools: `npm run levels` checks every level, `npm run levels -- draft`
// writes a draft level from the random road generator.
//
//   node tools/levels.mjs [check]
//   node tools/levels.mjs draft <biome> <seed> <metres> [out.json]
//
// The check builds each level's road exactly as the game does, then reports
// errors (the road would turn back on itself, bends or slopes outside the
// biome's rules, bad features, missing targets) and an estimate of the time
// a quick, clean rider would take. The estimate is a speed profile: tucked
// acceleration on the slope, cornering at a modest grip limit and braking
// into bends. The 2-star target time should sit comfortably above it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Road, START_S, DS, pieceLength } = await import('../src/road.js');
const { BIOMES } = await import('../src/biomes.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/levels');

// Rider model fitted to `npm run sim` (tucked terminal speeds of 52, 71 and
// 91 km/h on 5, 8 and 12%).
const G = 9.81;
const DRAG = 0.00159; // per metre: deceleration = DRAG * v^2
const ROLL = 0.158; // m/s^2
const LAT = 0.6 * G; // cornering a kid can hold, below the ~0.73 g limit
const BRAKE = 3.5; // m/s^2, slide or footbrake
const PUSH = 0.7; // m/s^2 of pushing below 5 m/s

export function estimate(road) {
  const i0 = Math.round(road.start / DS);
  const i1 = Math.round(road.finish / DS);
  const n = i1 - i0 + 1;
  const v = new Float64Array(n);
  v[0] = 6;
  for (let j = 1; j < n; j++) {
    const i = i0 + j;
    const p = v[j - 1];
    let a = G * road.g[i] - DRAG * p * p - ROLL;
    if (p < 5) a = Math.max(a, PUSH);
    const lim = Math.sqrt(LAT / Math.max(Math.abs(road.k[i]), 1e-6));
    v[j] = Math.min(lim, Math.sqrt(Math.max(0.25, p * p + 2 * a * DS)));
  }
  for (let j = n - 2; j >= 0; j--) v[j] = Math.min(v[j], Math.sqrt(v[j + 1] ** 2 + 2 * BRAKE * DS));
  let t = 0;
  let top = 0;
  let kMax = 0;
  for (let i = i0; i <= i1; i++) kMax = Math.max(kMax, Math.abs(road.k[i]));
  for (let j = 1; j < n; j++) {
    t += (2 * DS) / (v[j] + v[j - 1]);
    top = Math.max(top, v[j]);
  }
  return { time: t, top, tightest: 1 / kMax };
}

function checkLevel(file, biome) {
  const errors = [];
  const warns = [];
  const level = JSON.parse(fs.readFileSync(file, 'utf8'));
  const num = path.basename(file, '.json');
  const rules = biome.rules || {};
  if (level.id !== `${biome.id}-${num}`) errors.push(`id should be "${biome.id}-${num}"`);
  if (level.biome !== biome.id) errors.push(`biome should be "${biome.id}"`);
  for (const k of ['name', 'seed', 'pieces', 'targets']) if (level[k] === undefined) errors.push(`missing "${k}"`);
  if (errors.length) return { level, errors, warns };

  level.pieces.forEach((p, i) => {
    const where = `piece ${i + 1}`;
    if (p.straight === undefined && p.bend === undefined) errors.push(`${where}: needs "straight" or "bend"`);
    if (p.bend !== undefined) {
      if (p.bend !== 'left' && p.bend !== 'right') errors.push(`${where}: bend must be "left" or "right"`);
      if (!(p.radius > 0) || !(p.length > 0)) errors.push(`${where}: bend needs radius and length`);
      if (rules.minRadius && p.radius < rules.minRadius) errors.push(`${where}: radius ${p.radius} m is under the biome minimum of ${rules.minRadius} m`);
    }
    if (p.straight !== undefined && !(p.straight > 0)) errors.push(`${where}: straight needs a length`);
    if (p.grade !== undefined) {
      if (rules.maxGrade && p.grade > rules.maxGrade + 1e-9) errors.push(`${where}: grade ${p.grade} is over the biome maximum of ${rules.maxGrade}`);
      if (rules.minGrade !== undefined && p.grade < rules.minGrade - 1e-9) errors.push(`${where}: grade ${p.grade} is under the biome minimum of ${rules.minGrade}`);
    }
  });
  if (errors.length) return { level, errors, warns };

  const road = new Road(level.seed, level);
  road.ensure(road.finish + 50);
  const length = road.finish - road.start;
  if (road.headingOver > 0) {
    errors.push(`the road turns ${(road.headingOver * 57.3).toFixed(0)}° past the limit and gets forced back; add a bend the other way`);
  }
  for (const f of level.features || []) {
    const [a, b] = f.from !== undefined ? [f.from, f.to] : [f.at, f.at];
    if (!(a >= -300 && b <= length && a <= b)) errors.push(`feature ${f.type} at ${a}${b !== a ? `-${b}` : ''} m is off the level (0 to ${length.toFixed(0)} m)`);
  }
  for (const at of level.checkpoints || []) {
    if (!(at > 0 && at < length)) errors.push(`checkpoint at ${at} m is off the level`);
  }
  const t = level.targets;
  if (!(t.time > 0) || !(t.score > 0)) errors.push('targets need "time" (seconds) and "score"');

  const est = estimate(road);
  if (t.time && t.time < est.time) errors.push(`target time ${t.time} s is faster than the clean-run estimate of ${est.time.toFixed(0)} s`);
  if (t.score && t.score < length) warns.push(`target score ${t.score} is below the ${length.toFixed(0)} points for distance alone`);
  return { level, errors, warns, length, est };
}

function check() {
  let bad = 0;
  for (const biome of BIOMES) {
    const dir = path.join(root, biome.id);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    console.log(`\n${biome.name} (${files.length} levels)`);
    files.forEach((f, i) => {
      if (f !== `${String(i + 1).padStart(2, '0')}.json`) console.log(`  ${f}: files should be numbered 01.json, 02.json, ...`);
    });
    for (const f of files) {
      const r = checkLevel(path.join(dir, f), biome);
      const head = `  ${f.padEnd(8)} ${String(r.level.name || '?').padEnd(22)}`;
      if (r.est) {
        const { time, top, tightest } = r.est;
        console.log(`${head} ${(r.length / 1000).toFixed(2)} km  tightest ${tightest.toFixed(0)} m  clean ~${time.toFixed(0)} s, top ~${(top * 3.6).toFixed(0)} km/h  targets ${r.level.targets.time} s / ${r.level.targets.score}`);
      } else {
        console.log(head);
      }
      for (const e of r.errors) console.log(`      ERROR ${e}`);
      for (const w of r.warns) console.log(`      warn  ${w}`);
      if (r.errors.length) bad++;
    }
  }
  if (bad) {
    console.log(`\n${bad} level(s) have errors`);
    process.exit(1);
  }
  console.log('\nAll levels OK');
}

// Records the random generator's segments into level pieces.
function draft(biomeId, seed, metres, out) {
  const biome = BIOMES.find((b) => b.id === biomeId);
  if (!biome) throw new Error(`unknown biome "${biomeId}"`);
  const rules = biome.rules || {};
  const road = new Road(seed);
  const pieces = [];
  const pick = road.pickSegment.bind(road);
  let total = 0;
  road.pickSegment = () => {
    pick();
    const s = road.state;
    if (road.count < START_S || total >= metres) return;
    const len = Math.round(s.segLeft);
    let grade = Math.round(s.gradeTarget * 100) / 100;
    if (rules.maxGrade) grade = Math.min(grade, rules.maxGrade);
    if (rules.minGrade !== undefined) grade = Math.max(grade, rules.minGrade);
    if (s.kappaTarget === 0) pieces.push({ straight: len, grade });
    else {
      const radius = Math.max(rules.minRadius || 0, Math.round(1 / Math.abs(s.kappaTarget)));
      pieces.push({ bend: s.kappaTarget > 0 ? 'right' : 'left', radius, length: len, grade });
    }
    total += len;
  };
  road.ensure(START_S + metres * 1.5 + 2000);
  const level = { id: `${biomeId}-NN`, name: 'Draft', biome: biomeId, seed, pieces, features: [], checkpoints: [], traffic: { density: 0.5, speed: 1 }, targets: { time: 0, score: 0 } };
  const built = new Road(seed, level);
  built.ensure(built.finish + 50);
  const est = estimate(built);
  level.targets = { time: Math.ceil((est.time * 1.25) / 5) * 5, score: Math.round((built.finish - built.start + 400) / 100) * 100 };
  const json = JSON.stringify(level, null, 2);
  if (out) fs.writeFileSync(out, json + '\n');
  else console.log(json);
}

const [cmd = 'check', ...args] = process.argv.slice(2);
if (cmd === 'check') check();
else if (cmd === 'draft') draft(args[0], Number(args[1] || 1), Number(args[2] || 1500), args[3]);
else console.log('usage: node tools/levels.mjs [check | draft <biome> <seed> <metres> [out.json]]');
