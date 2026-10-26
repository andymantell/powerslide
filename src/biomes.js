// The campaign's biomes, in unlock order. `rules` bound what a level in the
// biome may contain; tools/levels.mjs checks every level against them.
// Biomes without levels yet show as locked on the level select.

export const BIOMES = [
  {
    id: 'alpine',
    name: 'Alpine Meadows',
    blurb: 'Wide sweepers and gentle slopes. Learn to carve, tuck, brake and slide.',
    // Tucked top speed on 8% is about 71 km/h, just under wobble speed.
    rules: { minRadius: 18, maxGrade: 0.08, minGrade: 0.03 },
  },
  { id: 'dartmoor', name: 'Dartmoor', blurb: 'Narrow lanes, stone walls, ponies and mist.' },
  { id: 'suburbs', name: 'Hillside Suburbs', blurb: 'Parked cars, speed bumps and side roads.' },
  { id: 'forest', name: 'Pine Forest', blurb: 'Blind bends and grit on the inside line.' },
  { id: 'canyon', name: 'Desert Canyon', blurb: 'Long, steep straights fast enough to wobble.' },
  { id: 'city', name: 'City at Night', blurb: 'Steep streets, tram lines and buses.' },
  { id: 'coast', name: 'Coastal Cliffs', blurb: 'Hairpins, side winds and a long drop to the sea.' },
  { id: 'pass', name: 'High Alpine Pass', blurb: 'Switchbacks, meltwater and everything at once.' },
];
