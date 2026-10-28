// The ambience's one-shot calls: birds, animals, bells, water, weather and
// distant town noise, each a recorded sound (src/samples.js) with a little
// random pitch so repeats don't sound identical. Ambience.play() and level
// spots use these names.
//
// sample: the recording's name (its variants are picked at random);
// rate: [min, max] playback speed; gain: level trim.
export const CALLS = {
  songbird: { sample: 'songbird', rate: [0.95, 1.08] },
  skylark: { sample: 'skylark', rate: [0.97, 1.03] },
  cuckoo: { sample: 'cuckoo', rate: [0.97, 1.03] },
  curlew: { sample: 'curlew', rate: [0.97, 1.03] },
  crow: { sample: 'crow', rate: [0.93, 1.05] },
  raven: { sample: 'raven', rate: [0.9, 1.0] },
  // Alpine choughs: a higher, squeakier corvid.
  chough: { sample: 'crow', rate: [1.35, 1.55], gain: 0.8 },
  gull: { sample: 'gull', rate: [0.95, 1.05] },
  raptor: { sample: 'raptor', rate: [0.95, 1.03] },
  marmot: { sample: 'marmot', rate: [0.95, 1.05] },
  owl: { sample: 'owl', rate: [0.97, 1.03] },
  woodpecker: { sample: 'woodpecker', rate: [0.95, 1.05] },
  sheep: { sample: 'sheep', rate: [0.92, 1.08] },
  pony: { sample: 'pony', rate: [0.95, 1.1] },
  cowbell: { sample: 'cowbell', rate: [0.9, 1.1] },
  dog: { sample: 'dog', rate: [0.92, 1.08] },
  duck: { sample: 'duck', rate: [0.95, 1.08] },
  chimes: { sample: 'chimes', rate: [0.9, 1.1], gain: 0.8 },
  mower: { sample: 'mower', rate: [0.95, 1.05] },
  siren: { sample: 'siren-far', rate: [0.97, 1.03] },
  farHorn: { sample: 'far-horn', rate: [0.9, 1.1] },
  tramBell: { sample: 'tram-bell', rate: [0.97, 1.03] },
  airHiss: { sample: 'air-hiss', rate: [0.9, 1.1] },
  wave: { sample: 'wave', rate: [0.9, 1.05] },
  foghorn: { sample: 'foghorn', rate: [0.97, 1.0] },
  buoy: { sample: 'buoy', rate: [0.97, 1.03] },
  thunder: { sample: 'thunder', rate: [0.8, 1.05], gain: 1.2 },
  churchBell: { sample: 'church-bell', rate: [0.98, 1.02] },
  saw: { sample: 'saw', rate: [0.95, 1.05] },
  phone: { sample: 'phone', rate: [1, 1] },
};

// Places that make a steady sound rather than calls: a level spot naming one
// of these plays it as a bed that fades with distance.
export const LOOPS = {
  stream: 'stream',
  water: 'water',
  waterfall: 'waterfall',
  surf: 'surf',
  pub: 'pub',
  tractorIdle: 'tractor-idle',
  mastHum: 'mast-hum',
};
