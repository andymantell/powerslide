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

| Keyboard | Xbox controller | Touch | Action |
| --- | --- | --- | --- |
| `A` / `D` or `←` / `→` | Left stick | Drag left / right | Lean and carve |
| `W` / `↑` | RT | Tap / drag forward | Push (slow) or tuck (fast). On touch, a tap is one push and dragging further forward tucks lower |
| | | Drag back | Air brake: stand tall with arms out to catch the wind |
| `S` / `↓` | LT | | Footbrake |
| `Space` / `Shift` (hold) | A, LB or RB (hold) | Hold a second finger | Powerslide. Steer into it to open it up, steer out to close it |
| `C` | Y | | Cycle camera (chase, low, helmet) |
| `P` / `Esc` | ☰ Menu | | Pause |
| `M` / `U` / `F` | | | Mute, km/h or mph, FPS counter |

Touch has no buttons: the whole screen is one invisible analogue stick, centred
wherever your finger lands.

In menus, use A to ride, B to go back, X to switch difficulty and Y to cycle the
graphics setting.

**Xbox:** Edge on Xbox may use the controller to move a cursor rather than
passing it to the game. If so, hold the Menu button (or select the controller
icon in the address bar) and choose *Use game controls*. The game shows this
tip when it detects an Xbox.

## Difficulty

- **Cruiser:** forgiving grip and gentle traffic.
- **Pro:** less grip and faster, busier traffic. It adds three hazards:
  - **Speed wobbles** above about 72 km/h, worse when you ride upright or
    steer jerkily. Tuck and stay smooth, or throw a slide to kill them.
  - **Highsides:** letting go of a slide while the board is still well
    sideways at speed throws you. Steer out of the slide to close it down
    first. A warning shows when releasing would highside.
  - **Grit:** sandy patches, mostly on the inside of tight bends, that cost a
    lot of grip.

Best scores are kept separately per difficulty.

## Graphics

Auto picks Low on phones, Medium on iPad and Android tablets, and High on the
Xbox and desktops. You can override this with Low, Medium, High or Ultra. The
setting controls antialiasing, shadow resolution, terrain detail, view
distance and tree density. On top of the preset, dynamic resolution lowers the
render scale when the frame rate drops below about 48 fps and raises it again
when there is headroom. Press `F` to see the frame rate, render scale and
preset.

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
