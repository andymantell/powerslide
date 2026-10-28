// The campaign's biomes, in unlock order. `rules` bound what a level in the
// biome may contain; tools/levels.mjs checks every level against them.
// Biomes without levels yet show as locked on the level select.
//
// `look` names each biome's entries in ATMOSPHERE (sky.js), GROUND_SETS
// (ground.js), MARKINGS (roadmat.js) and the tree species in models/trees
// (tools/trees/build.mjs): one name, or an array for a mix, where 'oak:2'
// takes that species' first two variants (see Forest). A missing entry falls
// back to the alpine one.
//
// `drive: 'left'` makes traffic keep left (and the rider starts in the left lane).

export const BIOMES = [
  {
    id: 'alpine',
    name: 'Alpine Meadows',
    blurb: 'Wide sweepers and gentle slopes. Learn to carve, tuck, brake and slide.',
    // Tucked top speed on 8% is about 71 km/h, just under wobble speed; the
    // short 10-11% pitches in later levels go past it, so brake before them.
    rules: { minRadius: 18, maxGrade: 0.11, minGrade: 0.02 },
    look: { atmosphere: 'alpine', ground: 'alpine', markings: 'alpine', species: 'spruce' },
  },
  {
    id: 'dartmoor',
    name: 'Dartmoor',
    blurb: 'Narrow lanes, stone walls, ponies and mist.',
    // Narrow lanes with tight, blind bends, steep pitches and short climbs
    // (negative grades) you carry speed into or push up. Traffic keeps left,
    // and there are no guardrails: walls and hedge banks line the lanes.
    rules: { minRadius: 16, maxGrade: 0.15, minGrade: -0.06 },
    drive: 'left',
    rails: false,
    look: { markings: 'uk', lane: 2.7, species: ['dwarfoak:3', 'hawthorn:2', 'rowan:1', 'ash:1', 'birch:1'] },
  },
  {
    id: 'suburbs',
    name: 'Hillside Suburbs',
    blurb: 'Parked cars, speed bumps and side roads.',
    // Streets down a steep hillside town: kerbs instead of guardrails, speed
    // humps to brake for, side roads cars pull out of, and some very steep
    // terraced streets. Traffic keeps left.
    rules: { minRadius: 14, maxGrade: 0.16, minGrade: -0.04 },
    drive: 'left',
    rails: false,
    look: { markings: 'uk', lane: 3.0, species: ['oak:2', 'ash:2', 'birch:2', 'rowan:2'] },
  },
  {
    id: 'forest',
    name: 'Pine Forest',
    blurb: 'Blind bends and grit on the inside line.',
    // A logging road through tall pines: the trees crowd the verges so bends
    // are blind, grit washes onto the inside of the bends, and the grades
    // are steady rather than steep. Guardrails on the drops.
    rules: { minRadius: 16, maxGrade: 0.12, minGrade: -0.03 },
    look: { species: 'pine', lane: 3.3 },
  },
  {
    id: 'canyon',
    name: 'Desert Canyon',
    blurb: 'Long, steep straights fast enough to wobble.',
    // A wide desert highway down through red rock: long straight pitches
    // steep enough to reach wobble speed, sweeping bends between them, and
    // sand blowing across the road. Guardrails on the drops.
    rules: { minRadius: 25, maxGrade: 0.14, minGrade: -0.03 },
    look: { lane: 3.6 },
  },
  {
    id: 'city',
    name: 'City at Night',
    blurb: 'Steep streets, tram lines and buses.',
    // Steep streets down a harbour city's hill after dark: kerbs and
    // pavements instead of guardrails, tram lines, buses, tight junction
    // corners and short climbs between the drops. Night by default.
    rules: { minRadius: 14, maxGrade: 0.17, minGrade: -0.04 },
    rails: false,
    look: { lane: 3.3, time: 'night', species: ['oak:2', 'ash:2', 'birch:2'] },
  },
  {
    id: 'coast',
    name: 'Coastal Cliffs',
    blurb: 'Hairpins, side winds and a long drop to the sea.',
    // A cliff road round a rocky coast: the sea on the drop side (the
    // `sea` feature), guardrails along it, tight bends round the coves,
    // side-wind gusts on the exposed headlands, and short climbs. Traffic
    // keeps left.
    rules: { minRadius: 16, maxGrade: 0.13, minGrade: -0.05 },
    drive: 'left',
    look: { markings: 'uk', lane: 3.0, species: ['hawthorn:2', 'dwarfoak:2'] },
  },
  {
    id: 'pass',
    name: 'High Alpine Pass',
    blurb: 'Switchbacks, meltwater and everything at once.',
    // Above the tree line: bare rock, old snow and meltwater across the
    // road, the steepest grades, switchbacks stacked up the face, galleries,
    // a dam and the hospice at the top. Guardrails on the drops.
    rules: { minRadius: 14, maxGrade: 0.15, minGrade: -0.04 },
    look: { markings: 'alpine', lane: 3.2 },
  },
];

// A biome's look, with the alpine defaults filled in.
// A level's "sky" block ({ time, weather }) adds its time of day and weather.
export function lookOf(biome, level) {
  const id = biome?.id || 'alpine';
  return { atmosphere: id, ground: id, markings: id, species: 'spruce', lane: 3.5, time: 'day', weather: 'clear', ...biome?.look, ...level?.sky };
}
