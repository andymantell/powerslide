# Powerslide

A browser-based, fully 3D downhill longboarding game. Ride hand-built levels
down a mountain pass (or an endless random one), tuck for speed, throw
powerslides to scrub it before the bends, and dodge two-way traffic.

Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/).
Every texture, model and sound is generated, either at run time or by the
scripts in `tools/` (Blender for models), so all assets are reproducible.

## Play locally

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Controls

| Keyboard | Xbox controller | Touch | Action |
| --- | --- | --- | --- |
| `A` / `D` or `←` / `→` | Left stick | Drag left / right | Lean and carve |
| `W` / `↑` | A (push), RT (tuck, analogue) | Tap / drag forward | Push (slow) or tuck (fast). On touch, a tap is one push and dragging further forward tucks lower; on a controller, squeezing RT harder tucks lower |
| | | Drag back | Air brake: stand tall with arms out to catch the wind |
| `S` / `↓` | LT (analogue) | | Air brake at speed (stand tall, chest to the road, arms wide); footbrake once slow |
| `Space` / `Shift` (hold) | X, LB or RB (hold) | Flick back and hold (or hold a second finger) | Powerslide. Steer left/right to guide it (into the slide opens it a little); hold brake to throw it fully sideways and scrub hard, tuck to close it down and carry speed |
| `C` | Y | | Cycle camera (chase, low, helmet) |
| `P` / `Esc` | ☰ Menu | ☰ button (top right) | Pause |
| `R` | ⧉ View | ↻ button (top right) | Restart the level (or a fresh endless run) |
| `M` / `U` / `F` | | | Mute, mph or km/h, FPS counter |

Apart from the two buttons in the top right, touch has no buttons: the rest of the screen is one invisible analogue stick, centred
wherever your finger lands. Lifting your finger centres the steering but keeps
the current tuck or air brake; the next touch carries on from there.

Settings has an optional **Tilt** steering mode for touch screens: turn the
device like a steering wheel (Low / Medium / High sensitivity). Swiping left and
right then does nothing; everything else stays the same. Straight ahead is
however the device is held when a run starts or resumes. iOS asks for motion
access the first time.

In menus, use the d-pad, left stick or arrow keys to move between buttons, A or
Enter to select, and B or Esc to go back.

**Settings** (from the title screen): speed in mph (the default) or km/h, and
graphics.

**Xbox:** Edge on Xbox may use the controller to move a cursor rather than
passing it to the game. If so, hold the Menu button (or select the controller
icon in the address bar) and choose *Use game controls*. The game shows this
tip when it detects an Xbox.

## Levels

The campaign is a run of biomes, each with 10 levels that unlock strictly in
order. Finishing a biome's last level opens the next biome. Each level has three
stars: one for finishing, one for beating the target time and one for beating
the target score (distance plus slide, close-pass and 180 bonuses). Later
levels have checkpoints: crash after one and you can restart from it. Endless
mode is the old random mountain pass, set up on its own screen first: presets,
the road's steepness, corners and grit, rider physics (speed boost, grip,
gravity, wind, wobbles, highsides), biome, road surface, weather and traffic.
A road code (the seed) and a SHARE link let someone else ride the same road
with the same settings. The setup is remembered, and each mix of settings
keeps its own best score. Endless also has things the campaign never does
(`src/extras.js`): roadworks, where cones close the edge of the road over loose
chippings (a clean run through scores a bonus), "YOUR SPEED" radar signs that
score how fast you pass, and a road that gets steeper, twistier and busier the
further you go. It shares the campaign's set pieces and roadside furniture:
`src/scenery.js` dresses the endless road a stretch at a time, 2.3 km ahead of
the rider (before the terrain there builds), using `Structures.add`/`buildJob`,
`dressRange` and `Props.finish(true)`, and drops them again behind.

Alpine Meadows is built. The other seven biomes (Dartmoor, Hillside Suburbs,
Pine Forest, Desert Canyon, City at Night, Coastal Cliffs and High Alpine Pass)
show as coming soon.

There is one difficulty. The levels set how hard a run is, and three hazards
are always on:

- **Speed wobbles** above about 72 km/h. They build gradually with speed and
  settle rather than running away: a smooth tuck keeps them small up to about
  110 km/h and ridable past 160 km/h, riding upright or steering jerkily makes them worse, and only
  fighting them hard or riding far too fast throws you. Throw a slide to kill
  them.
- **Highsides:** letting go of a slide while the board is still well sideways
  at speed throws you. Steer out of the slide to close it down first. A warning
  shows when releasing would highside.
- **Grit:** sandy patches that cost a lot of grip. Levels place them by hand;
  in endless mode they collect on the inside of tight bends.

### Making levels

Each level is a JSON file, `src/levels/<biome>/NN.json`, numbered from `01`.
Biomes and their rules (tightest bend, slope range) are in `src/biomes.js`.

```json
{
  "id": "alpine-03",
  "name": "Cowbell Corner",
  "biome": "alpine",
  "seed": 1303,
  "hint": "Shown on the level card and as the run starts.",
  "pieces": [
    { "straight": 150, "grade": 0.06 },
    { "bend": "right", "radius": 160, "length": 140 },
    { "bend": "left", "radius": 40, "length": 55, "grade": 0.07 }
  ],
  "features": [{ "type": "grit", "at": 420, "d": -1.5, "len": 6, "width": 1.5 }],
  "checkpoints": [700],
  "traffic": { "density": 0.3, "speed": 1 },
  "targets": { "time": 140, "score": 1900 }
}
```

- `pieces` is the road from the start line down, in metres. A `grade` is the
  downhill slope (0.06 = 6%) and carries on until a later piece changes it.
  The road builder eases in and out of every bend, so a short, tight bend
  turns less sharply than its radius suggests.
- `features` are placed by distance from the start (`at`, metres) and lateral
  offset (`d`, metres, + = right), or span `from` to `to`. Besides `grit`,
  they are set pieces that shape the ground around them (`src/structures.js`):
  `bridge` (stone viaduct over a gorge, `depth`), `covered` (timber covered
  bridge), `stream` (stone arch over a stream, with a waterfall above when
  `fall`), `gallery` (avalanche gallery), `lake`, `cableway` (gondolas
  crossing overhead at `angle` degrees), `bunting` (flags over the road,
  `count` and `every`) and `flat` (gentle ground either side for a village or
  farm, `width`). Bridges and galleries have walls on both sides. Dartmoor
  adds `walls` (dry-stone walls) and `hedge` (Devon hedge banks) along a
  stretch, on both sides or one (`side`), which you crash into like a
  guardrail; `grid` (a cattle grid that rattles the board, with a gate and a
  warning sign) and `ford` (water over a dip in the lane that slows you).
  Hillside Suburbs adds `street` (kerb, pavement, lampposts and front-garden
  walls, hedges and fences along a stretch, `side` for one side, `"style":
  "prom"` for seafront railings; the kerb is what you crash into),
  `junction` (a side road coming in on `side`, `length` m long, with give-way
  lines and houses; cars pull out of it), `roundabout` (a painted mini
  roundabout with side roads both ways), `zebra` (a zebra crossing with
  flashing beacons), `bump` (a speed hump: a jolt and lost speed, or a crash
  above about 47 km/h) and `railbridge` (the road under a brick railway
  bridge on an embankment, with a train crossing every `every` seconds). Pine
  Forest adds `tunneltree` (the road runs through a tunnel cut in a giant
  redwood; its walls are what you crash into), `trestle` (an old timber
  railway trestle `height` m over the road, on banks where the ground
  reaches it), `logbridge` (a log bridge over a rushing river), `smoke`
  (chimney smoke `h` m up at `at`/`d`, `"side": "valley"` as for props),
  `firebreak` (a strip cleared of trees across the road, `width`), and
  `burnt` and `clearing` (no living trees out to `far` m along a stretch:
  dress a burnt one with `snag` props). Desert Canyon adds `arch` (the road
  runs under a natural rock arch at `at`), `slot` (sheer banded sandstone
  walls `height` m high either side, from/to), `dam` (the road runs along the
  crest of a dam: reservoir on `side`, a drop of `depth` m on the other),
  `railway` (a freight line running beside the road at `d` m, with trains
  every `every` seconds), `raildeck` (the road crosses a railway cutting on a
  bridge at `angle`) and `dust` (dust blowing across the road; `"wind":
  "right"` reverses it).
- A piece's `ramp` (metres) makes its new grade come in that quickly instead
  of easing over a few hundred metres, for humps, crests and dips. A negative
  grade climbs.
- A biome can narrow the lanes (`look.lane`), keep traffic on the left
  (`drive: 'left'`) and drop guardrails (`rails: false`); see `src/biomes.js`.
  Its own props come from `props_<biome>.glb` (`tools/blender/props_<biome>.py`).
- `props` dress the roadside with buildings, animals, fences and the rest (the
  list is `PROP_TYPES` in `src/props.js`); see the top of `src/dressing.js` for
  single props, rows (`"face": "road"` for houses), scatters and props at
  every tight bend. `"side": "valley"` keeps a prop off the mountain side. Every tight bend also gets
  chevrons and a warning sign on its own (`"chevrons": false` turns them off).
- `terrain` tweaks the biome's ground for one level: `treeDensity`, `treeClear`
  (how close to the road trees grow), `relief`,
  `maxRelief` and `snowLine` (metres above the road).
- `sky` sets the time of day (`dawn`, `day`, `dusk`, `night`) and weather
  (`clear`, `cloudy`, `mist`, `rain`, `snow`). Rain also makes the road wet
  and less grippy. The sound follows it (rain, wind, night-time animals).
- `ambience` changes the biome's sounds for one level (see Sound below).
- `seed` fixes the scenery, the guardrail sides and the traffic, so every run
  of a level looks and plays the same.
- `traffic.density` scales how often cars spawn (0 = none); `speed` scales how
  fast they drive.

`npm run levels` checks every level: that the road never turns more than about
66° off downhill (past that it would cross itself), bends and slopes against
the biome's rules, features, checkpoints and targets. It also estimates how
long a quick, clean run takes; keep the target time comfortably above that.
`npm run levels -- draft alpine 42 1500 out.json` turns the random generator
into a 1.5 km draft level to hand-tune. Open `/?level=alpine-03` to jump
straight to a level (locked or not) while working on it.

## Graphics

Set on the Settings screen. Auto picks Low on phones, Medium on iPad and Android tablets, and High on the
Xbox and desktops. You can override this with Low, Medium, High or Ultra. The
setting controls antialiasing, shadow resolution and softness, terrain detail
and ground texturing, view distance, tree density, how far out trees are
drawn as full models (beyond that they are impostors) and how far and how
densely grass tufts are scattered. High adds bloom and
Ultra adds ambient occlusion. On top of the preset, dynamic resolution lowers the
render scale when the frame rate drops below about 48 fps and raises it again
when there is headroom. Press `F` to see the frame rate, render scale and
preset.

### Assets and visual tooling

- `tools/textures/gen.py` generates the tileable ground, road, bark, twig,
  grass tuft and deck textures in `src/assets/textures` (numpy, scipy and pillow).
- `tools/blender/*.py` build the models in `src/assets/models` with Blender's
  Python module (`pip install bpy` on Python 3.13): `tree.py` (spruces from
  branch cards), `rocks.py` (boulders), `board.py` (deck, trucks, wheels) and
  `rider.py` (skinned rider in race leathers; the helmet, shoes and gloves hang
  off the head, foot and hand bones, and `RIDER_RIG` in `src/rider.js` says how
  each bone follows the pose). `preview.py` renders Cycles previews of any
  exported model.
- `/tools/poses/` (with `npm run dev` running) draws the rider in every pose
  from several sides; `?pose=tuck,airbrake&view=front,side&zoom=neck&focus=haF`
  narrows it down. `node tools/poses/shoot.mjs out.png [query]` saves it.
  `node tools/poses/check.mjs` (no browser) measures arms going into the body
  and how far off centre the rider sits, across every pose and the steps between.
- `tools/blender/props.py` builds every roadside prop into `props.glb`, with a
  colour and a surface kind (planks, shingles, masonry, plaster, glass, metal,
  lights) per vertex; `tools/textures/props.py` makes the detail texture the
  prop shader (`src/propmat.js`) adds on top. `/tools/props/` shows them all
  (`?only=chalet,barn`), and `node tools/props/shoot.mjs out.png [query]`
  saves it.
- `tools/blender/vehicles.py` builds the traffic into `vehicles.glb` (then
  meshopt-compresses it with gltf-transform). Car bodies are lofted from a
  side profile and plan width, with arches cut in and lamps, grilles and
  windows as material zones; lorries, the tractor and the motorbikes (with
  riders) are built from parts. Every type has a detailed and a far LoD, baked
  ambient occlusion in the vertex colours and a `meta` extra (size, wheels,
  lamps). `/tools/garage/` shows them all in the game's materials
  (`?types=hatch,van&views=fq,side,rq,front&night=1`), and
  `node tools/garage/shoot.mjs out.png [query]` saves it.
- `/tools/sky/?biome=alpine&time=dusk&weather=rain&quality=medium` draws just
  the sky (volumetric clouds included) in four directions, in a few seconds;
  `node tools/sky/shoot.mjs out.png [query]` saves it. In the game,
  `?time=` (dawn, day, dusk, night) and `?weather=` (clear, cloudy, mist,
  rain, snow) override the level's own sky for testing.
- `node tools/props/sheet.mjs [outDir] [name,name]` renders the numbered prop
  sheet for reviews: one image per prop (every prop pack, endless roadside
  signs and cones, traffic, trees, rocks, rider and board) on a 1 m grid with
  the rider beside it for scale, plus `index.json`. Numbers live in
  `tools/props/sheet-ids.json`, so feedback like "#42" keeps meaning the same
  prop; new props get the next free numbers.
- `node tools/loadcheck.mjs [levelId] [low,high]` boots a level at each
  preset and fails if it doesn't load, logs an error, or has a single draw
  call that runs for seconds (phones drop the GPU when that happens). Run it
  before pushing anything that renders at load time.
- `node tools/levelshots.mjs <levelId> [outDir] [quality] [at:view,...]`
  screenshots a level at points along the road (views: chase, high, side,
  back) for before/after comparisons of level dressing.
- `node tools/shots.mjs [url] [outDir] [quality] [views]` boots the game in
  headless Chromium and saves fixed camera views (chase, rider, board, road,
  vista, trees, forest, verge, cutting, distant, boulder, traffic, tail; `SHOT_PR=0.6` mimics a lowered render scale, `SHOT_NIGHT=1` darkens the scene to check headlamps and `SHOT_LEFT=1` switches to keep-left traffic) for before/after comparisons.
  vista, trees, forest, verge, cutting, distant, boulder, and sun and sky looking up; `SHOT_PR=0.6` mimics a lowered render scale) for before/after comparisons.

## Sound

Everything is synthesised with WebAudio at run time (nothing to download, so
it works offline). Volumes for master, effects, ambience and music are on the
Settings screen; `M` mutes. Safari only allows sound after a touch, so the
first touch, click or key starts it, and it sleeps while the game is hidden.

- **Rider and board** (`src/audio.js`): wheel roar and bearing hum that rise
  with speed and change with the surface (smooth, bumpy, wet, gravel, grit),
  slide hiss with a urethane squeal, the hand-down puck scrape with spark
  crackle, footbrake, push kicks, wind that a tuck cuts and an air brake
  catches (with flapping leathers), wobble rattle, guardrail clang and scrape,
  crash and ragdoll thuds, and the loose board clattering away.
- **Traffic**: each vehicle type has its own engine (gears, harmonics), tyre
  noise, horn and doppler. The traffic code names a car's type in `car.kind`
  (`car`, `taxi`, `van`, `suv`, `pickup`, `camper`, `bus`, `lorry`, `tractor`,
  `motorbike`, `police`, `ambulance`, `fire`, `icecream`, `horsebox`; see
  `ENGINES`). `car.siren = true` sounds an emergency vehicle's siren.
- **Ambience** (`src/ambience.js`, calls in `src/sfx.js`): `AMBIENCE[biome]`
  sets each biome's beds (`wind`, `water`, `surf`, `hum`, `insects`,
  `crickets`), the calls dropped in at random (cowbells, skylarks, sheep,
  ponies, gulls, sirens…) and an `echo`. Set pieces and props make their own
  sounds as you ride past (`spotsFor`): waterfalls, streams, church bells, the
  sawmill, cow herds, sheep and ponies, ducks, the inn, a parked tractor,
  fountains and fords; galleries ring with an echo and hedge banks close the
  sound in. Cattle grids rattle and fords splash under the board.
- **Music** (`src/music.js`): an optional four-chord loop per biome, with
  bass and drums while riding.

A level's `"ambience"` changes its biome's mix:

```json
"ambience": {
  "layers": { "water": 0.3, "wind": { "level": 0.5, "whistle": 0.4 } },
  "events": { "cowbell": 0, "marmot": { "every": [5, 12], "gain": 0.5 } },
  "spots": [{ "at": 820, "d": -30, "sound": "waterfall", "radius": 150, "gain": 0.7 }],
  "zones": [{ "from": 1200, "to": 1350, "echo": { "time": 0.07, "feedback": 0.45, "mix": 0.5 }, "muffle": 1800 }]
}
```

Setting a layer or event to 0 turns it off. A spot's `sound` is a bed
(`stream`, `waterfall`, `surf`) or any call in `CALLS` (repeated every
`every` seconds while in earshot). The weather and time of day come from the
level's `sky`, and code can change them at any time with
`audio.setWeather({ rain, wind, thunder })` (0..1) and
`audio.setTimeOfDay(hours or 'dawn' / 'day' / 'dusk' / 'night')`;
`audio.setEcho({ time, feedback, mix })` sets an echo (null goes back to the
biome's). `npm run sounds` records each biome headless into `sounds/` to
listen to, and `npm run clips` records every sound on its own into
`sounds/clips/` (both need `npm run build && npx vite preview` running).

## How it works

- **Road** (`src/road.js`): the centreline is built from clothoid-style
  transitions between straights, big sweepers, tight bends and near-hairpins.
  A level supplies the pieces; endless mode rolls them at random, with a
  varying 5–14% grade, scaled by the endless setup (`src/endless.js`). The heading is kept within about ±66° of
  downhill, so the road never crosses itself.
- **Terrain** (`src/terrain.js`): the height is a world-space function of
  distance to the road. One side rises into the mountain and the other drops
  into the valley, with ridged noise for peaks and snow. Detailed tiles near
  the rider and coarse tiles out to about 4 km are split by a circular cut in
  the shader.
- **Physics** (`src/player.js`): a rigid board and rider on two trucks.
  - *Lean to steer:* the rider leans, the deck rolls on its bushings, and the
    angled kingpins (48° front, 42° rear) turn that roll into steer. The front
    truck turns into the corner and the rear truck turns out of it.
  - *Balance:* the rider's centre of mass has to lean into a carve to match
    the cornering force, and leaning takes time. So turn-in is snappy when
    slow and gets lazier as speed builds, like a real board.
  - *Grip:* each truck's wheels grip up to about 6° of slip, then break away
    and slide on urethane at lower friction. Grip is solved per truck, so
    drifts, standup slides, hook-ups and 180s to fakie all come from one model.
  - *Weight shift:* weight goes onto the front foot to throw a slide (the tail
    steps out), in a tuck, and while pushing or footbraking. Weight forward
    also calms speed wobbles, which shake the trucks at speed.
  - *Drag* depends on the body: upright, a progressive tuck, or an air brake
    with roughly double the upright drag. Pushing is a kick at a time and
    stops helping once the road is faster than your foot.
  - Top speeds land around 58 km/h on a 5% grade and 97 km/h on 12% in a tuck.
    `npm run sim` prints these and other numbers from a headless run.
- **Rider pose** (`src/riderpose.js`, `src/ik.js`): the body is solved from
  the physics. Feet stay planted on the rolling deck, the hips lean with the
  balance model, and IK places knees and elbows. The joints don't depend on
  the model, so `SkeletonDriver` in `src/ik.js` can drive a skinned rig too.
- **Traffic** (`src/traffic.js`, `src/vehicles.js`): downhill vehicles share
  your lane and slow for bends. Uphill ones come at you in the other lane.
  Close passes score bonus points. Biomes with `drive: 'left'` (Dartmoor,
  Hillside Suburbs) keep left, and each biome has its own mix of vehicles
  (`MIXES`). Every vehicle gets its own paint, trim and wheels, and recent
  spawns are remembered so the same type or colour doesn't come straight
  back. Vehicles are placed from the road under both axles, so long ones
  follow bends; motorbikes lean. Emergency vehicles (`emergency` in `TYPES`)
  usually run with blue lights and `car.siren`: going your way they come from
  behind and pass you, and either way they pull out into the other lane to
  overtake when it's clear (never with a rider close ahead in it), while
  other traffic tucks in for them. They're drawn with instancing (a few draw
  calls per type and LoD, one per wheel style), with soft contact shadows,
  and at night, in rain or in mist their lamps light up, with light pools on
  the road and a few real spot lights (`carLights` in the quality presets).
- **Audio** (`src/audio.js`, `src/ambience.js`, `src/sfx.js`,
  `src/music.js`): see Sound above.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`. To turn it on, go to **Settings → Pages** and set the source to
**GitHub Actions**.

## Installing as an app

The deployed game is a Progressive Web App, so it can sit on the home screen and
run fullscreen and offline.

- **iPad / iPhone:** open the game in Safari, tap **Share → Add to Home Screen**.
- **Android:** open it in Chrome, tap **⋮ → Install app** (or accept the install banner).
- **Xbox / PC:** in Edge, open the **⋯** menu → **Apps → Install Powerslide**.

On the iPad the home screen app doesn't share storage with Safari, and either can
lose it. The Settings screen's Your stars section (`src/transfer.js`, ported from
push-pump-pop) copies progress as a code and merges it in the other copy, keeping
the better of each level's stars, time and score and each endless best (settings
stay as they are, and the graphics level never travels). The same code goes into a
backup file: Save backup shares it to Files / iCloud Drive / Google Drive, or
downloads it, and Load backup picks it. Installed copies also ask
`navigator.storage.persist()`.

`public/sw.js` is the service worker (only registered in production builds, not
under `npm run dev`). It goes network first for the page and unhashed files, so an
online player gets exactly what a browser tab would, and keeps a copy for offline
play. Hashed bundles in `assets/` are served from its cache.

### Updates

Each build gets an ID (the commit SHA in CI) baked into the bundle, stamped into
`index.html` as `<meta name="build-id">`, and written to `version.json` along with
the release notes. `src/version.js` polls `version.json` every minute, and whenever
the app comes back to the foreground. When a newer build is live, and a fresh
`index.html` really serves it, the game offers it:

- On a menu, a **New version!** box lists what's new with **RELOAD** and **LATER**.
  LATER shrinks it to a small pill.
- In a run, it's a small chip at the top. Tapping it ends the run and shows the
  notes on the title screen.

RELOAD unregisters the service worker, clears its cache and reloads with a
cache-busting `?v=` (iOS Safari and the GitHub Pages CDN otherwise hand back the
old page). If the reload still lands on an old build it retries up to 3 times.
After an update, **What's New** opens with the new updates marked NEW, and the title
screen shows the version and build time.

This is ported from [push-pump-pop](https://github.com/andymantell/push-pump-pop).

### Release notes

**Every change a player would notice needs a line in `changelog.json`,** in the same
commit as the change. Add it at the top of the top entry's `items`. Write it in plain
words for a kid, starting with `New:`, `Better:` or `Fixed:`, e.g. `"New: grit on the
road!"`.

The build groups lines into updates by the commit that added them (via `git blame`,
so the deploy checks out full history), and the game shows them that way: the update
prompt lists the lines the running copy doesn't have, and after an update the What's
New screen opens with the new updates marked. Don't reword old lines: a reworded line
moves to the commit that changed it and shows up as new.

The icons are rendered from `public/icons/icon.svg` with `npm run icons`.
