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
| `Space` / `Shift` (hold) | A, LB or RB (hold) | Flick back and hold (or hold a second finger) | Powerslide. Steer into it to open it up, steer out to close it |
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
    also calms speed wobbles, which shake the trucks on Pro.
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
