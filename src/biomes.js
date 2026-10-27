// The campaign's biomes, in unlock order. `rules` bound what a level in the
// biome may contain; tools/levels.mjs checks every level against them.
// Biomes without levels yet show as locked on the level select.
//
// `look` names each biome's entries in ATMOSPHERE (sky.js), GROUND_SETS
// (ground.js), MARKINGS (roadmat.js) and the tree species in conifers.glb
// (tools/blender/tree.py). A missing entry falls back to the alpine one.

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
    look: { markings: 'uk', lane: 2.7 },
  },
  { id: 'suburbs', name: 'Hillside Suburbs', blurb: 'Parked cars, speed bumps and side roads.' },
  { id: 'forest', name: 'Pine Forest', blurb: 'Blind bends and grit on the inside line.' },
  { id: 'canyon', name: 'Desert Canyon', blurb: 'Long, steep straights fast enough to wobble.' },
  { id: 'city', name: 'City at Night', blurb: 'Steep streets, tram lines and buses.' },
  { id: 'coast', name: 'Coastal Cliffs', blurb: 'Hairpins, side winds and a long drop to the sea.' },
  { id: 'pass', name: 'High Alpine Pass', blurb: 'Switchbacks, meltwater and everything at once.' },
];

// A biome's look, with the alpine defaults filled in.
// A level's "sky" block ({ time, weather }) adds its time of day and weather.
export function lookOf(biome, level) {
  const id = biome?.id || 'alpine';
  return { atmosphere: id, ground: id, markings: id, species: 'spruce', lane: 3.5, time: 'day', weather: 'clear', ...biome?.look, ...level?.sky };
}
