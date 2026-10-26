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
| `W` / `↑` | RT | Tap / drag forward | Push (slow) or tuck (fast). On touch, a tap is one push and dragging further forward tucks lower |
| | | Drag back | Air brake: stand tall with arms out to catch the wind |
| `S` / `↓` | LT (analogue) | | Air brake at speed (stand tall, chest to the road, arms wide); footbrake once slow |
| `Space` / `Shift` (hold) | A, LB or RB (hold) | Flick back and hold (or hold a second finger) | Powerslide. Steer left/right to guide it (into the slide opens it a little); hold brake to throw it fully sideways and scrub hard, tuck to close it down and carry speed |
| `C` | Y | | Cycle camera (chase, low, helmet) |
| `P` / `Esc` | ☰ Menu | | Pause |
| `M` / `U` / `F` | | | Mute, km/h or mph, FPS counter |

Touch has no buttons: the whole screen is one invisible analogue stick, centred
wherever your finger lands.

In menus, use the d-pad, left stick or arrow keys to move between buttons, A or
Enter to select, B or Esc to go back, and Y to cycle the graphics setting.

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
mode is the old random mountain pass, with its own best score.

Alpine Meadows is built. The other seven biomes (Dartmoor, Hillside Suburbs,
Pine Forest, Desert Canyon, City at Night, Coastal Cliffs and High Alpine Pass)
show as coming soon.

There is one difficulty. The levels set how hard a run is, and three hazards
are always on:

- **Speed wobbles** above about 72 km/h, worse when you ride upright or steer
  jerkily. Tuck and stay smooth, or throw a slide to kill them.
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
  offset (`d`, metres, + = right). Only `grit` exists so far.
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

Auto picks Low on phones, Medium on iPad and Android tablets, and High on the
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
  `rider.py` (skinned rider in race leathers, helmet, shoes and gloves, rigged
  to the bones `SkeletonDriver` in `src/ik.js` expects). `preview.py` renders
  Cycles previews of any exported model.
- `node tools/shots.mjs [url] [outDir] [quality] [views]` boots the game in
  headless Chromium and saves fixed camera views (chase, rider, board, road,
  vista, trees, forest, verge, cutting, boulder) for before/after comparisons.

## How it works

- **Road** (`src/road.js`): the centreline is built from clothoid-style
  transitions between straights, big sweepers, tight bends and near-hairpins.
  A level supplies the pieces; endless mode rolls them at random, with a
  varying 5–14% grade. The heading is kept within about ±66° of
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
  - Top speeds land around 50 km/h on a 5% grade and 90 km/h on 12% in a tuck.
    `npm run sim` prints these and other numbers from a headless run.
- **Rider pose** (`src/riderpose.js`, `src/ik.js`): the body is solved from
  the physics. Feet stay planted on the rolling deck, the hips lean with the
  balance model, and IK places knees and elbows. The joints don't depend on
  the model, so `SkeletonDriver` in `src/ik.js` can drive a skinned rig too.
- **Traffic** (`src/traffic.js`): downhill cars share your lane and slow for
  bends. Uphill cars come at you in the other lane. Close passes score bonus
  points.
- **Audio** (`src/audio.js`): wheel roar, wind, slide hiss, doppler-shifted
  engines and horns, all synthesised with WebAudio.

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

`pwa/plugin.js` writes `dist/sw.js` at build time. It precaches every built file
under a cache named after a hash of the build, so each deploy gets a fresh
cache and the old one is deleted. Page loads go network first, so an online
player always gets the latest build; an open app picks up a new build when it
returns to the title or crash screen, never mid-run. The service worker is
only registered in production builds, not under `npm run dev`.

The icons are rendered from `public/icons/icon.svg` with `npm run icons`.
