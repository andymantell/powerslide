// Level catalogue and saved progress. Levels live in src/levels/<biome>/NN.json
// (see the README for the format); Vite bundles them all at build time.

import { BIOMES } from './biomes.js';
import { store } from './settings.js';

const files = import.meta.glob('./levels/*/*.json', { eager: true, import: 'default' });

for (const b of BIOMES) b.levels = [];
for (const [path, level] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  const biome = BIOMES.find((b) => b.id === path.split('/')[2]);
  if (biome) biome.levels.push(level);
}

export { BIOMES };
export const LEVELS = BIOMES.flatMap((b) => b.levels);

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

// Progress: { [levelId]: { stars: [finished, time, score], bestTime, bestScore } }
const KEY = 'powerslide.levels';
let progress = store.get(KEY, {});

export function levelProgress(id) {
  return progress[id] || { stars: [false, false, false], bestTime: null, bestScore: 0 };
}

export function starCount(id) {
  return levelProgress(id).stars.filter(Boolean).length;
}

// Records a finished run and returns what it earned.
export function recordFinish(level, time, score) {
  const prev = levelProgress(level.id);
  const earned = [true, time <= level.targets.time, score >= level.targets.score];
  const entry = {
    stars: prev.stars.map((s, i) => s || earned[i]),
    bestTime: prev.bestTime === null ? time : Math.min(prev.bestTime, time),
    bestScore: Math.max(prev.bestScore, score),
  };
  progress = { ...progress, [level.id]: entry };
  store.set(KEY, progress);
  return {
    earned,
    newStars: entry.stars.filter(Boolean).length - prev.stars.filter(Boolean).length,
    bestTime: prev.bestTime === null || time < prev.bestTime,
    bestScore: score > prev.bestScore,
  };
}

const finished = (id) => levelProgress(id).stars[0];

// A biome opens once the previous biome's last level is finished.
export function biomeUnlocked(biome) {
  const i = BIOMES.indexOf(biome);
  if (!biome.levels.length) return false;
  if (i === 0) return true;
  const prev = BIOMES[i - 1];
  return prev.levels.length > 0 && finished(prev.levels[prev.levels.length - 1].id);
}

// Levels open strictly in order.
export function levelUnlocked(level) {
  const biome = BIOMES.find((b) => b.levels.includes(level));
  if (!biomeUnlocked(biome)) return false;
  const i = biome.levels.indexOf(level);
  return i === 0 || finished(biome.levels[i - 1].id);
}

// The level to offer first: the earliest unlocked level not yet finished.
export function nextLevel() {
  return LEVELS.find((l) => levelUnlocked(l) && !finished(l.id)) || LEVELS[LEVELS.length - 1] || null;
}

export function levelAfter(level) {
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  return next && levelUnlocked(next) ? next : null;
}

export function biomeOf(level) {
  return BIOMES.find((b) => b.levels.includes(level));
}
