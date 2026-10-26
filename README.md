# Powerslide

A browser-based, fully 3D downhill longboarding game. Bomb an endless,
procedurally generated mountain pass, tuck for speed, throw powerslides to
scrub it before the bends, and dodge two-way traffic.

Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/). Every
texture, model and sound is generated in code, so there are no asset files.

## Play locally

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | Lean and carve |
| `W` / `↑` | Push (slow) or tuck (fast) |
| `S` / `↓` | Footbrake |
| `Space` / `Shift` (hold) | Powerslide. Steering when you start picks the side |
| `C` | Cycle camera (chase, low, helmet) |
| `M` / `U` / `P` | Mute, km/h or mph, pause |

Gamepads are supported (left stick, RT tuck, LT brake, A/bumpers slide). On
touch devices, on-screen controls appear.

## How it works

- **Road** (`src/road.js`): the centreline is built from clothoid-style
  transitions between straights, big sweepers, tight bends and near-hairpins,
  with a varying 5–14% grade. The heading is kept within about ±66° of
  downhill, so the road never crosses itself.
- **Terrain** (`src/terrain.js`): the height is a world-space function of
  distance to the road. One side rises into the mountain and the other drops
  into the valley, with ridged noise for peaks and snow. Detailed tiles near
  the rider and coarse tiles out to about 4 km are split by a circular cut in
  the shader.
- **Physics** (`src/player.js`): a semi-realistic model with gravity along the
  grade, aero drag (upright vs. tuck CdA), rolling resistance and a tyre-style
  grip model. The wheels grip up to static friction, then slide with kinetic
  friction. Carves, drifts, standup slides and 180s to fakie all come from
  that one model. Top speeds land around 80–95 km/h on the steeper sections.
- **Traffic** (`src/traffic.js`): downhill cars share your lane and slow for
  bends. Uphill cars come at you in the other lane. Close passes score bonus
  points.
- **Audio** (`src/audio.js`): wheel roar, wind, slide hiss, doppler-shifted
  engines and horns, all synthesised with WebAudio.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`. To turn it on, go to **Settings → Pages** and set the source to
**GitHub Actions**.
