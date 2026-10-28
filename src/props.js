// Trackside props from tools/blender/props.py: buildings, animals, fences,
// signs and the rest. A level lists them in "props" (see the README, "Making
// levels"); biomes add their own roadside furniture (dressing.js). Each prop
// type is one InstancedMesh for the whole level with the shared prop material,
// refilled with the instances within that type's draw distance as the rider
// moves, so draw calls stay at one per type in view.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { trackLoad } from './ground.js';
import { createPropMaterial } from './propmat.js';

const MODEL = new URL('./assets/models/props.glb', import.meta.url).href;
// Each biome's own props (tools/blender/props_<biome>.py), loaded on top.
const PACKS = {
  dartmoor: new URL('./assets/models/props_dartmoor.glb', import.meta.url).href,
  suburbs: new URL('./assets/models/props_suburbs.glb', import.meta.url).href,
  forest: new URL('./assets/models/props_forest.glb', import.meta.url).href,
  canyon: new URL('./assets/models/props_canyon.glb', import.meta.url).href,
  // The city shares the suburbs' street furniture.
  city: [new URL('./assets/models/props_suburbs.glb', import.meta.url).href, new URL('./assets/models/props_city.glb', import.meta.url).href],
  // The coast borrows Dartmoor's cottages, gorse and signs and the suburbs'
  // beach huts, lampposts and train.
  coast: [
    new URL('./assets/models/props_dartmoor.glb', import.meta.url).href,
    new URL('./assets/models/props_suburbs.glb', import.meta.url).href,
    new URL('./assets/models/props_coast.glb', import.meta.url).href,
  ],
  pass: new URL('./assets/models/props_pass.glb', import.meta.url).href,
};

// r: keep-out radius for trees, rocks and grass (m). pad: buildings get a level
// terrace of this radius cut into the slope. far: draw distance (m).
const BIG = { far: 1800 };
const MID = { far: 700 };
const SMALL = { far: 260 };
export const PROP_TYPES = {
  chalet: { r: 9, pad: 9, ...BIG },
  chalet_small: { r: 8, pad: 8, ...BIG },
  chalet_tall: { r: 10, pad: 10, ...BIG },
  farmhouse: { r: 9, pad: 9, ...BIG },
  church: { r: 15, pad: 15, ...BIG },
  barn: { r: 11, pad: 11, ...BIG },
  hut: { r: 9, pad: 9, ...BIG },
  chapel: { r: 6, pad: 6, ...BIG },
  sawmill: { r: 12, pad: 12, ...BIG },
  station: { r: 15, pad: 15, ...BIG },
  boathouse: { r: 6, ...BIG },
  pylon: { r: 4, ...BIG },
  summitcross: { r: 3, ...BIG },
  cow: { r: 1.5, ...MID },
  cow_pied: { r: 1.5, ...MID },
  cow_dun: { r: 1.5, ...MID },
  haybale: { r: 1.2, ...MID },
  logstack: { r: 5, ...MID },
  jetty: { r: 2, ...MID },
  rowboat: { r: 1, ...MID },
  woodpile: { r: 2, ...SMALL },
  fountain: { r: 3, ...MID },
  trough: { r: 1.6, ...SMALL },
  churns: { r: 1.2, ...SMALL },
  bench: { r: 1, ...SMALL },
  shrine: { r: 1, ...SMALL },
  fence: { r: 0.6, ...SMALL },
  chevron_r: { r: 0.6, ...SMALL },
  chevron_l: { r: 0.6, ...SMALL },
  warnsign_r: { r: 0.6, ...SMALL },
  warnsign_l: { r: 0.6, ...SMALL },
  snowpole: { r: 0.3, ...SMALL },
  flagpole: { r: 0.5, ...MID },
  banner: { r: 0.5, ...MID },
  fan_a: { r: 0.4, ...SMALL },
  fan_b: { r: 0.4, ...SMALL },
  fan_c: { r: 0.4, ...SMALL },
  gondola: { r: 0, ...MID },
  // Dartmoor
  tor_big: { r: 22, ...BIG },
  tor: { r: 14, ...BIG },
  tor_small: { r: 7, ...BIG },
  spoil: { r: 14, ...BIG },
  mast: { r: 6, ...BIG },
  prison: { r: 30, pad: 30, ...BIG },
  church_uk: { r: 15, pad: 15, ...BIG },
  inn: { r: 12, pad: 12, ...BIG },
  cottage: { r: 8, pad: 8, ...BIG },
  cottage_b: { r: 7, pad: 7, ...BIG },
  cottage_slate: { r: 7, pad: 7, ...BIG },
  tearoom: { r: 8, pad: 8, ...BIG },
  hawthorn: { r: 3, ...MID },
  sheep: { r: 0.8, ...MID },
  sheep_dark: { r: 0.8, ...MID },
  pony: { r: 1.2, ...MID },
  pony_dark: { r: 1.2, ...MID },
  pony_grey: { r: 1.2, ...MID },
  fieldwall: { r: 0.6, ...MID },
  ruin_a: { r: 3, ...MID },
  ruin_b: { r: 3, ...MID },
  clapper: { r: 6, ...MID },
  footbridge: { r: 5, ...MID },
  tractor: { r: 2, ...MID },
  car_red: { r: 2, ...MID },
  car_blue: { r: 2, ...MID },
  car_silver: { r: 2, ...MID },
  gorse: { r: 1, ...MID },
  gorse_big: { r: 1.5, ...MID },
  bracken: { r: 0.5, ...SMALL },
  phonebox: { r: 0.8, ...MID },
  picnic: { r: 1.2, ...SMALL },
  fingerpost: { r: 0.6, ...SMALL },
  sign_grid: { r: 0.5, ...SMALL },
  sign_pony: { r: 0.5, ...SMALL },
  sign_ford: { r: 0.5, ...SMALL },
  gate: { r: 0.5, ...SMALL },
  whitepost: { r: 0.3, ...SMALL },
  peat: { r: 2, ...SMALL },
  gauge: { r: 0.3, ...SMALL },
  duck: { r: 0.2, ...SMALL },
  duck_b: { r: 0.2, ...SMALL },
  // Hillside Suburbs
  semi: { r: 7, pad: 7, ...BIG },
  semi_b: { r: 7, pad: 7, ...BIG },
  semi_c: { r: 7, pad: 7, ...BIG },
  bungalow: { r: 6, pad: 6, ...BIG },
  bungalow_b: { r: 6, pad: 6, ...BIG },
  terrace: { r: 6, pad: 6, ...BIG },
  terrace_b: { r: 6, pad: 6, ...BIG },
  shops: { r: 10, pad: 10, ...BIG },
  school: { r: 16, pad: 16, ...BIG },
  church_hall: { r: 9, pad: 9, ...BIG },
  garden_centre: { r: 12, pad: 12, ...BIG },
  pier: { r: 4, ...BIG },
  oak: { r: 4, ...BIG },
  oak_big: { r: 6, ...BIG },
  bandstand: { r: 5, pad: 5, ...MID },
  swings: { r: 2, ...MID },
  slide: { r: 2, ...MID },
  train_car: { r: 0, ...MID },
  milk_float: { r: 2, ...MID },
  van: { r: 2.5, ...MID },
  car_white: { r: 2, ...MID },
  shed: { r: 1.5, ...MID },
  shed_b: { r: 1.5, ...MID },
  greenhouse: { r: 2, ...MID },
  hut_blue: { r: 1.2, ...MID },
  hut_yellow: { r: 1.2, ...MID },
  hut_pink: { r: 1.2, ...MID },
  hut_green: { r: 1.2, ...MID },
  lamppost: { r: 0.3, ...MID },
  busstop: { r: 1.5, ...MID },
  tpole: { r: 0.3, ...MID },
  railings: { r: 0.4, ...SMALL },
  garden_wall: { r: 0.4, ...SMALL },
  garden_wall_b: { r: 0.4, ...SMALL },
  garden_hedge: { r: 0.6, ...SMALL },
  cat_wall: { r: 0.4, ...SMALL },
  bin_green: { r: 0.4, ...SMALL },
  bin_black: { r: 0.4, ...SMALL },
  bin_blue: { r: 0.4, ...SMALL },
  postbox: { r: 0.4, ...SMALL },
  aboard: { r: 0.4, ...SMALL },
  bikerack: { r: 0.8, ...SMALL },
  belisha: { r: 0.3, ...SMALL },
  sign_school: { r: 0.3, ...SMALL },
  sign_20: { r: 0.3, ...SMALL },
  lollipop: { r: 0.3, ...SMALL },
  station_sign: { r: 1, ...SMALL },
  compost: { r: 0.6, ...SMALL },
  bollard: { r: 0.3, ...SMALL },
  keepleft: { r: 0.3, ...SMALL },
  // Pine Forest
  ranger_hut: { r: 9, pad: 9, ...BIG },
  mill: { r: 16, pad: 16, ...BIG },
  log_cabin: { r: 7, pad: 7, ...BIG },
  log_cabin_b: { r: 7, pad: 7, ...BIG },
  gift_shop: { r: 5, pad: 5, ...BIG },
  lookout: { r: 5, ...BIG },
  water_tank: { r: 3, ...BIG },
  water_tower: { r: 4, ...BIG },
  giant_tree: { r: 6, ...BIG },
  giant_tree_b: { r: 6, ...BIG },
  tunnel_tree: { r: 0, ...BIG },
  snag: { r: 1, ...BIG },
  snag_b: { r: 1, ...BIG },
  snag_c: { r: 1, ...BIG },
  log_stack: { r: 7, ...MID },
  log_stack_b: { r: 6, ...MID },
  log_pile: { r: 3.5, ...MID },
  log_loader: { r: 4, ...MID },
  logging_truck: { r: 4, ...MID },
  logging_truck_b: { r: 4, ...MID },
  timber_stack: { r: 3.5, ...MID },
  timber_stack_b: { r: 3.5, ...MID },
  flume: { r: 1, ...MID },
  jetty_long: { r: 2, ...MID },
  canoe: { r: 1, ...MID },
  canoe_green: { r: 1, ...MID },
  fallen_log: { r: 2, ...MID },
  fallen_log_b: { r: 2, ...MID },
  sign_fire: { r: 1.2, ...SMALL },
  picnic_table: { r: 1.2, ...SMALL },
  trail_map: { r: 1.2, ...SMALL },
  sign_forestry: { r: 1.2, ...SMALL },
  sign_forestry_b: { r: 1.2, ...SMALL },
  sign_trucks: { r: 0.4, ...SMALL },
  bear_bin: { r: 0.8, ...SMALL },
  stump: { r: 0.6, ...SMALL },
  stump_burnt: { r: 0.6, ...SMALL },
  sapling: { r: 0.4, ...SMALL },
  sapling_b: { r: 0.4, ...SMALL },
  fireweed: { r: 0.5, ...SMALL },
  // Desert Canyon
  mesa: { r: 90, ...BIG, far: 4000 },
  mesa_b: { r: 70, ...BIG, far: 4000 },
  butte: { r: 45, ...BIG, far: 4000 },
  butte_b: { r: 35, ...BIG, far: 4000 },
  hoodoo: { r: 2, ...BIG },
  hoodoo_b: { r: 2, ...BIG },
  boulder_red: { r: 3, ...MID },
  boulder_red_b: { r: 5, ...MID },
  rock_arch: { r: 0, ...BIG },
  saguaro: { r: 1, ...MID },
  saguaro_b: { r: 1, ...MID },
  saguaro_c: { r: 1, ...MID },
  joshua: { r: 1.5, ...MID },
  joshua_b: { r: 1.5, ...MID },
  barrel_cactus: { r: 0.6, ...SMALL },
  prickly_pear: { r: 0.8, ...SMALL },
  sagebrush: { r: 0.6, ...SMALL },
  sagebrush_b: { r: 0.8, ...SMALL },
  tumbleweed: { r: 0.5, ...SMALL },
  motel: { r: 22, pad: 22, ...BIG },
  neon_sign: { r: 1, ...BIG },
  carpark: { r: 0, ...MID },
  gas_station: { r: 9, pad: 9, ...BIG },
  diner: { r: 10, pad: 10, ...BIG },
  trading_post: { r: 10, pad: 10, ...BIG },
  saloon: { r: 8, pad: 8, ...BIG },
  store: { r: 7, pad: 7, ...BIG },
  bank: { r: 6, pad: 6, ...BIG },
  jail: { r: 5, pad: 5, ...BIG },
  windmill: { r: 2.5, ...BIG },
  water_tank_west: { r: 3, ...BIG },
  intake_tower: { r: 5, ...BIG },
  rusty_pump: { r: 0.8, ...SMALL },
  pickup: { r: 2.5, ...MID },
  pickup_b: { r: 2.5, ...MID },
  buried_car: { r: 3, ...MID },
  sand_fence: { r: 0.5, ...SMALL },
  viewpoint: { r: 6, ...MID },
  telescope: { r: 0.5, ...SMALL },
  hitching_rail: { r: 1, ...SMALL },
  wagon_wheel: { r: 0.6, ...SMALL },
  crossbuck: { r: 0.5, ...SMALL },
  signal_post: { r: 0.5, ...MID },
  locomotive: { r: 0, ...MID },
  boxcar: { r: 0, ...MID },
  tankcar: { r: 0, ...MID },
  hopper: { r: 0, ...MID },
  flatcar: { r: 0, ...MID },
  // City at Night (and the suburbs' street furniture)
  block_a: { r: 12, pad: 12, ...BIG },
  block_b: { r: 10, pad: 10, ...BIG },
  block_c: { r: 15, pad: 15, ...BIG },
  block_d: { r: 12, pad: 12, ...BIG },
  block_e: { r: 10, pad: 10, ...BIG },
  block_f: { r: 16, pad: 16, ...BIG },
  neon_a: { r: 12, pad: 12, ...BIG },
  neon_b: { r: 10, pad: 10, ...BIG },
  neon_c: { r: 15, pad: 15, ...BIG },
  neon_d: { r: 12, pad: 12, ...BIG },
  victorian_a: { r: 7, pad: 7, ...BIG },
  victorian_b: { r: 7, pad: 7, ...BIG },
  victorian_c: { r: 7, pad: 7, ...BIG },
  victorian_d: { r: 7, pad: 7, ...BIG },
  victorian_e: { r: 7, pad: 7, ...BIG },
  victorian_f: { r: 7, pad: 7, ...BIG },
  tower_a: { r: 22, pad: 22, ...BIG, far: 4000 },
  tower_b: { r: 24, pad: 24, ...BIG, far: 4000 },
  tower_c: { r: 18, pad: 18, ...BIG, far: 4000 },
  tower_d: { r: 20, pad: 20, ...BIG, far: 4000 },
  tower_e: { r: 28, pad: 28, ...BIG, far: 4000 },
  screen: { r: 0, ...BIG },
  billboard: { r: 0, ...BIG },
  tram: { r: 0, ...MID },
  tram_red: { r: 0, ...MID },
  tram_stop: { r: 0, ...MID },
  lantern_gate: { r: 0, ...BIG },
  food_stall: { r: 2, ...SMALL },
  food_stall_b: { r: 2, ...SMALL },
  food_stall_c: { r: 2, ...SMALL },
  market_stall: { r: 2.5, ...MID },
  market_stall_b: { r: 2.5, ...MID },
  market_stall_c: { r: 2.5, ...MID },
  market_stall_d: { r: 2.5, ...MID },
  crates: { r: 1, ...SMALL },
  stadium: { r: 80, pad: 80, ...BIG, far: 3000 },
  carpark_city: { r: 22, pad: 22, ...MID },
  ferris_legs: { r: 10, pad: 10, ...BIG, far: 3000 },
  ferris_wheel: { r: 0, ...BIG, far: 3000 },
  ferris_cab: { r: 0, ...BIG },
  carousel: { r: 8, pad: 8, ...MID },
  fair_stall: { r: 3, ...MID },
  fair_stall_b: { r: 3, ...MID },
  containers: { r: 14, pad: 14, ...BIG },
  containers_b: { r: 8, pad: 8, ...BIG },
  containers_c: { r: 20, pad: 20, ...BIG },
  crane: { r: 12, ...BIG, far: 3000 },
  ship: { r: 0, ...BIG, far: 3000 },
  warehouse: { r: 34, pad: 34, ...BIG },
  bollard_quay: { r: 0.5, ...SMALL },
  riverboat: { r: 0, ...MID },
  riverboat_b: { r: 0, ...MID },
  hydrant: { r: 0.3, ...SMALL },
  street_tree: { r: 2, ...MID },
  // Coastal Cliffs. Stacks, the arch, boats and the wreck stand at sea level
  // ("y": "sea" in a level's props).
  stack_a: { r: 0, ...BIG, far: 4000 },
  stack_b: { r: 0, ...BIG, far: 4000 },
  stack_c: { r: 0, ...BIG, far: 4000 },
  sea_arch: { r: 0, ...BIG, far: 4000 },
  reef: { r: 0, ...MID },
  lighthouse: { r: 6, pad: 6, ...BIG, far: 4000 },
  keepers: { r: 12, pad: 13, ...BIG },
  fisher_a: { r: 5, pad: 5, ...BIG },
  fisher_b: { r: 5, pad: 5, ...BIG },
  fisher_c: { r: 5, pad: 5, ...BIG },
  fisher_d: { r: 5, pad: 5, ...BIG },
  fisher_e: { r: 5, pad: 5, ...BIG },
  fisher_f: { r: 5, pad: 5, ...BIG },
  fisher_g: { r: 5, pad: 5, ...BIG },
  fisher_h: { r: 5, pad: 5, ...BIG },
  harbour_light: { r: 2, ...BIG },
  lifeboat_station: { r: 10, pad: 10, ...BIG },
  castle_keep: { r: 10, pad: 10, ...BIG, far: 3000 },
  castle_tower: { r: 5, pad: 5, ...BIG, far: 3000 },
  castle_wall: { r: 8, ...BIG },
  castle_gate: { r: 0, ...BIG, far: 3000 },
  flag: { r: 1, ...MID },
  boat_a: { r: 0, ...MID },
  boat_b: { r: 0, ...MID },
  boat_c: { r: 0, ...MID },
  boat_d: { r: 0, ...MID },
  dinghy: { r: 2, ...SMALL },
  dinghy_b: { r: 2, ...SMALL },
  wreck: { r: 0, ...BIG },
  turbine: { r: 5, ...BIG, far: 4000 },
  turbine_rotor: { r: 0, ...BIG, far: 4000 },
  windsock: { r: 1, ...MID },
  sign_wind: { r: 1, ...SMALL },
  sign_cliff: { r: 1, ...SMALL },
  cafe: { r: 14, pad: 14, ...BIG },
  camper: { r: 3, ...MID },
  camper_b: { r: 3, ...MID },
  camper_c: { r: 3, ...MID },
  ice_cream_van: { r: 3, ...MID },
  surf_school: { r: 5, ...MID },
  surfboard_rack: { r: 2, ...SMALL },
  lobster_pots: { r: 2, ...SMALL },
  fish_boxes: { r: 1, ...SMALL },
  bench_sea: { r: 1, ...SMALL },
  viaduct_bay: { r: 0, ...BIG, far: 3000 },
  // High Alpine Pass
  hospice: { r: 16, pad: 16, ...BIG },
  kennel: { r: 5, pad: 5, ...MID },
  stbernard: { r: 0.6, ...SMALL },
  stbernard_sit: { r: 0.6, ...SMALL },
  hotel: { r: 19, pad: 19, ...BIG },
  terrace: { r: 11, pad: 11, ...MID },
  powerhouse: { r: 15, pad: 15, ...BIG },
  souvenir_a: { r: 3, pad: 3, ...MID },
  souvenir_b: { r: 3, pad: 3, ...MID },
  pass_sign: { r: 2.5, ...MID },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`sign_hp_${i + 1}`, { r: 0.4, ...SMALL }])),
  sign_rockfall: { r: 0.5, ...SMALL },
  telescope: { r: 0.4, ...SMALL },
  panorama: { r: 1.2, ...SMALL },
  culvert: { r: 2, ...SMALL },
  rocknet: { r: 0.6, ...MID },
  snowplough: { r: 4, ...MID },
  ibex: { r: 0.8, ...MID },
  ibex_b: { r: 0.8, ...MID },
  marmot: { r: 0.3, ...SMALL },
};

const DEG = Math.PI / 180;

export class Props {
  constructor(scene, renderer, terrain, pack = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.mat = createPropMaterial(renderer);
    this.geos = new Map();
    this.meshes = new Map(); // type -> InstancedMesh
    this.items = new Map(); // type -> Float32Array [x, y, z, yaw, scale] * n
    this.list = []; // { type, x, y, z, yaw, scale } while building a level
    this.lastX = Infinity;
    this.lastZ = Infinity;
    const loader = new GLTFLoader();
    for (const url of [MODEL, PACKS[pack]].flat().filter(Boolean)) {
      trackLoad(
        loader.loadAsync(url).then((gltf) => {
          gltf.scene.traverse((o) => {
            if (o.isMesh) this.geos.set(o.name, o.geometry);
          });
        }),
      );
    }
  }

  // World position and facing for a point beside the road: s along it, d
  // across (+ right). Without a yaw, the prop's front faces the road.
  static at(road, s, d, yaw) {
    const f = road.sample(s, {});
    const x = f.x + f.rightX * d;
    const z = f.z + f.rightZ * d;
    let a;
    // 'along' runs the prop's long (x) axis with the road; 'across', over it.
    if (yaw === 'along') a = Math.atan2(-f.dirZ, f.dirX);
    else if (yaw === 'across') a = Math.atan2(-f.rightZ, f.rightX);
    else {
      const side = d >= 0 ? -1 : 1; // face back across the road
      a = Math.atan2(f.rightX * side, f.rightZ * side) + (yaw || 0) * DEG;
    }
    return { x, z, yaw: a, f };
  }

  // Starts a new level's set of props.
  begin() {
    this.list = [];
  }

  // Adds one prop. `y` is optional: by default it sits on the terrain (call
  // after the terrain mods are in place).
  add(type, x, z, yaw = 0, scale = 1, y = null) {
    // Parked cars are real traffic models: "car:<model>" (car:suv,
    // car:any), and the old car_red, car_blue and car_pass_* props.
    if (this.parked && (type.startsWith('car:') || type === 'car_red' || type === 'car_blue' || type.startsWith('car_pass'))) {
      this.terrain?.block(x, z, 2);
      this.parked(type.startsWith('car:') ? type.slice(4) : 'any', x, z, yaw, y);
      return null;
    }
    if (!PROP_TYPES[type]) {
      console.warn('unknown prop', type);
      return null;
    }
    const p = { type, x, y, z, yaw, scale };
    this.list.push(p);
    return p;
  }

  // Buildings: a level terrace on the slope and a keep-out circle. Call once
  // all props are added and before the terrain tiles build.
  shape() {
    const t = this.terrain;
    // Level at the ground height under the middle of each building, all
    // measured before any terrace goes in: on a steep street a row of
    // overlapping terraces would otherwise each take the last one's level.
    const pads = [];
    for (const p of this.list) {
      const def = PROP_TYPES[p.type];
      if (def.r) t.block(p.x, p.z, def.r * p.scale);
      if (def.pad && p.y === null) {
        p.y = t.heightAt(p.x, p.z);
        p.padded = true;
        pads.push(terrace(p.x, p.z, def.pad * p.scale, p.y));
      }
    }
    t.mods.push(...pads);
  }

  // Settles the remaining props on the finished terrain and fills the meshes.
  // append (endless, which dresses the road a stretch at a time): add these
  // to the props already placed instead of replacing them.
  finish(append = false) {
    // A new level starts from nothing: props of a type it doesn't use would
    // otherwise linger at the old road's positions, floating in its sky.
    if (!append) this.items.clear();
    const by = new Map();
    for (const p of this.list) {
      if (p.y === null) p.y = this.terrain.heightAt(p.x, p.z);
      if (!by.has(p.type)) by.set(p.type, append && this.items.has(p.type) ? [...this.items.get(p.type)] : []);
      by.get(p.type).push(p.x, p.y, p.z, p.yaw, p.scale);
    }
    for (const [type, arr] of by) this.items.set(type, new Float32Array(arr));
    if (!append) {
      for (const [type, mesh] of this.meshes) {
        if (!by.has(type)) mesh.count = 0;
      }
    }
    this.lastX = Infinity;
  }

  // A check for props that don't sit on the ground: every instance more than
  // `tol` m above or below the terrain under it, as { type, x, z, off }.
  // Run it from the console: __powerslide.props.floating().
  floating(tol = 1) {
    const out = [];
    for (const [type, arr] of this.items) {
      for (let i = 0; i < arr.length; i += 5) {
        const off = arr[i + 1] - this.terrain.heightAt(arr[i], arr[i + 2]);
        if (Math.abs(off) > tol) out.push({ type, x: arr[i], z: arr[i + 2], off: Math.round(off * 10) / 10 });
      }
    }
    return out;
  }

  // Endless: forgets the props where keep(x, z) is false, so the lists
  // don't grow without end on a long ride.
  prune(keep) {
    for (const [type, arr] of this.items) {
      const out = [];
      for (let i = 0; i < arr.length; i += 5) if (keep(arr[i], arr[i + 2])) out.push(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], arr[i + 4]);
      if (out.length < arr.length) this.items.set(type, new Float32Array(out));
    }
  }

  clear() {
    this.items.clear();
    this.list = [];
    for (const mesh of this.meshes.values()) mesh.count = 0;
  }

  mesh(type, n) {
    let m = this.meshes.get(type);
    if (m && m.instanceMatrix.count >= n) return m;
    const geo = this.geos.get(type);
    if (!geo) return null;
    if (m) {
      this.scene.remove(m);
      m.dispose();
    }
    m = new THREE.InstancedMesh(geo, this.mat, Math.max(16, Math.ceil(n * 1.25)));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    this.scene.add(m);
    this.meshes.set(type, m);
    return m;
  }

  // Refills the instance lists with what's within each type's draw distance.
  update(px, pz, force = false) {
    if (!force && Math.hypot(px - this.lastX, pz - this.lastZ) < 30) return;
    if (!this.geos.size) return;
    this.lastX = px;
    this.lastZ = pz;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [type, arr] of this.items) {
      const far2 = PROP_TYPES[type].far ** 2;
      const mesh = this.mesh(type, arr.length / 5);
      if (!mesh) continue;
      let n = 0;
      for (let i = 0; i < arr.length; i += 5) {
        const x = arr[i], z = arr[i + 2];
        if ((x - px) ** 2 + (z - pz) ** 2 > far2) continue;
        q.setFromAxisAngle(up, arr[i + 3]);
        m.compose(pos.set(x, arr[i + 1], z), q, sc.setScalar(arr[i + 4]));
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// A flat terrace of radius r at height h, blending back to the slope over
// 8 m. It never reaches the road or its verge.
export function terrace(cx, cz, r, h) {
  const R = r + 8;
  const mod = (x, z, f, y) => {
    const dx = x - cx, dz = z - cz;
    if (Math.abs(dx) > R || Math.abs(dz) > R) return y;
    const d = Math.hypot(dx, dz);
    if (d > R) return y;
    const w = (1 - smooth(r, R, d)) * smooth(6, 9, f.dist);
    return y + (h - 0.05 - y) * w;
  };
  mod.pad = [cx, cz];
  return mod;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
