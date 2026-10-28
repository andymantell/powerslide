// Renders every sound in the game on its own, for listening to one at a time:
// each ambience call and bed, the rider and board sounds (driven by a fake
// rider), each vehicle driving past, horns and menu sounds.
//   node tools/sound-clips.mjs [url] [outDir] [id,id,...]
// Writes <id>.webm per clip and clips.json (id, group, name) to outDir.
// Needs `npm run build && npx vite preview` running.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'sounds/clips';
const only = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(out, { recursive: true });

const CALLS = ['songbird', 'skylark', 'cuckoo', 'crow', 'raven', 'gull', 'raptor', 'marmot', 'chough', 'owl', 'woodpecker', 'sheep', 'pony', 'cowbell', 'dog', 'duck', 'chimes', 'mower', 'siren', 'farHorn', 'tramBell', 'airHiss', 'wave', 'foghorn', 'buoy', 'thunder', 'churchBell', 'saw', 'pub', 'phone', 'tractorIdle', 'mastHum'];
const BEDS = ['wind', 'water', 'stream', 'waterfall', 'surf', 'hum', 'insects', 'crickets', 'rain', 'pub', 'tractorIdle', 'mastHum'];
const RIDER = ['roll', 'rollBumpy', 'rollWet', 'gravel', 'grit', 'windTuck', 'airbrake', 'slide', 'handDown', 'footbrake', 'push', 'wobble', 'railScrape', 'grid', 'ford'];
const SHOTS = ['crash', 'thud', 'clack', 'carHit', 'rail', 'kick', 'cone', 'ding', 'fanfare', 'unlock', 'uiClick', 'uiBack', 'uiMove', 'uiTick'];
const VEHICLES = ['car', 'taxi', 'van', 'suv', 'pickup', 'camper', 'bus', 'lorry', 'tractor', 'motorbike', 'police', 'ambulance', 'fire', 'icecream', 'horsebox'];
const clips = [
  ...CALLS.map((n) => ({ id: `call-${n}`, group: 'call', name: n })),
  ...BEDS.map((n) => ({ id: `bed-${n}`, group: 'bed', name: n })),
  ...RIDER.map((n) => ({ id: `rider-${n}`, group: 'rider', name: n })),
  ...SHOTS.map((n) => ({ id: `shot-${n}`, group: 'shot', name: n })),
  ...VEHICLES.map((n) => ({ id: `vehicle-${n}`, group: 'vehicle', name: n })),
  ...VEHICLES.map((n) => ({ id: `horn-${n}`, group: 'horn', name: n })),
].filter((c) => !only || only.includes(c.id));

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('powerslide.quality', '"low"'));
await page.goto(url);
await page.waitForFunction(() => window.__powerslide?.game.mode === 'title', null, { timeout: 300000 });
await page.mouse.click(5, 5);
await page.waitForFunction(() => window.__powerslide.audio.ctx?.state === 'running' && window.__powerslide.audio.ready);

// Stop the game feeding the audio, silence everything, and tap the master.
await page.evaluate(() => {
  const P = window.__powerslide;
  const a = P.audio;
  P.game.mode = 'paused';
  for (const k of ['effects', 'ambience']) a.bus[k].gain.value = 1;
  for (const l of Object.values(a.ambience.layers)) l.g.gain.value = 0;
  for (const v of a.voices) v.g.gain.value = v.tyre.g.gain.value = v.sirenG.gain.value = 0;
  window.__dest = a.ctx.createMediaStreamDestination();
  a.master.connect(window.__dest);
  const idle = () => ({
    crashed: false, speed: 0, mods: { rolling: 1 }, surface: 'asphalt', slideMode: false, sliding: false, slip: 0, dirt: 0,
    airbrake: 0, tuck: 0, handDown: false, handAmount: 0, brake: 0, pushT: -1, wobble: 0, ragdoll: null, boardLoose: false,
    water: 0, yaw: 0, vel: { x: 0, y: 0 }, s: 0,
  });
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  // Drives the rider sounds for `secs`, with `step(p, t)` setting the state.
  const drive = async (secs, step, before = () => {}) => {
    const p = idle();
    a.onRoad = true;
    before(p);
    const t0 = a.ctx.currentTime;
    let last = t0;
    while (a.ctx.currentTime - t0 < secs) {
      const now = a.ctx.currentTime;
      step(p, now - t0);
      a.updateRider(p, now - last);
      last = now;
      await wait(1 / 30);
    }
    const q = idle();
    a.onGrid = false;
    a.updateRider(q, 0.03);
    await wait(0.6);
  };
  // A vehicle driving past 4 m away, left to right, at v m/s.
  const pass = async (kind, v, extra = {}) => {
    const car = { kind, v, yaw: Math.PI / 2, x: 0, z: -4, ...extra };
    const p = idle();
    const cam = { position: { x: 0, z: 0 } };
    const secs = Math.min(16, 240 / v);
    a.assignT = 0;
    const t0 = a.ctx.currentTime;
    let last = t0;
    while (a.ctx.currentTime - t0 < secs) {
      const now = a.ctx.currentTime;
      car.x = -v * secs * 0.5 + v * (now - t0);
      a.updateTraffic(p, [car], cam, now - last);
      last = now;
      await wait(1 / 30);
    }
    a.updateTraffic(p, [], cam, 0.1);
    await wait(0.6);
  };
  const ramp = (a0, a1, t, T) => a0 + (a1 - a0) * Math.min(1, t / T);
  window.__play = async ({ group, name }) => {
    if (group === 'call') {
      a.ambience.play(name, 0.9, 0, 0);
      const end = a.ambience.playing[a.ambience.playing.length - 1];
      await wait(Math.max(1, end - a.ctx.currentTime) + 0.8);
    } else if (group === 'bed') {
      const l = a.ambience.make(name);
      l.g.gain.value = 0.6;
      if (name === 'wind') l.whistleG.gain.value = 0.2;
      await wait(8);
      l.g.gain.value = 0;
      l.stop();
    } else if (group === 'rider') {
      const R = {
        roll: [8, (p, t) => (p.speed = ramp(0, 25, t, 8))],
        rollBumpy: [5, (p) => ((p.speed = 15), (p.mods.rolling = 2.2))],
        rollWet: [5, (p) => (p.speed = 15), () => (a.scene.wet = 1)],
        gravel: [4, (p) => ((p.speed = 8), (p.surface = 'gravel'))],
        grit: [4, (p) => ((p.speed = 12), (p.dirt = 1))],
        windTuck: [8, (p, t) => ((p.speed = 22), (p.tuck = Math.floor(t / 2) % 2))],
        airbrake: [5, (p) => ((p.speed = 20), (p.airbrake = 1))],
        slide: [4, (p, t) => ((p.speed = ramp(16, 8, t, 4)), (p.slideMode = true), (p.slip = 0.7))],
        handDown: [4, (p, t) => ((p.speed = ramp(14, 7, t, 4)), (p.slideMode = p.handDown = true), (p.handAmount = 1), (p.slip = 0.9))],
        footbrake: [4, (p, t) => ((p.speed = ramp(6, 0.5, t, 4)), (p.brake = 1))],
        push: [5, (p, t) => ((p.speed = 3), (p.pushT = t % 0.8))],
        wobble: [5, (p) => ((p.speed = 22), (p.wobble = 0.8))],
        railScrape: [2, (p) => ((p.speed = 12), a.rail())],
        grid: [3, (p, t) => ((p.speed = 10), (a.onGrid = t > 1 && t < 1.6))],
        ford: [4, (p, t) => ((p.speed = 8), (p.water = t > 0.8 && t < 3 ? 0.1 : 0))],
      }[name];
      await drive(R[0], R[1], R[2]);
      a.scene.wet = 0;
    } else if (group === 'shot') {
      const S = {
        crash: () => a.crash(), thud: () => a.thud(1), clack: () => a.clack(1), carHit: () => a.carHit(), rail: () => a.rail(),
        kick: () => a.kick(), cone: () => a.cone(), ding: () => a.ding(), fanfare: () => a.fanfare(3), unlock: () => a.unlock(),
        uiClick: () => a.ui('click'), uiBack: () => a.ui('back'), uiMove: () => a.ui('move'), uiTick: () => a.ui('tick'),
      };
      a.lastRail = -1;
      S[name]();
      await wait(name === 'crash' || name === 'carHit' ? 2 : 1.4);
    } else if (group === 'vehicle') {
      const v = { tractor: 8, motorbike: 26, lorry: 16, bus: 15, icecream: 10, camper: 15 }[name] || 20;
      await pass(name, v, ['police', 'ambulance', 'fire'].includes(name) ? { siren: true } : {});
    } else if (group === 'horn') {
      a.honk(12, { kind: name });
      await wait(1.6);
    }
  };
});

for (const clip of clips) {
  await page.evaluate(() => {
    window.__chunks = [];
    const rec = (window.__rec = new MediaRecorder(window.__dest.stream, { mimeType: 'audio/webm;codecs=opus' }));
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start();
  });
  await page.evaluate((c) => window.__play(c), clip);
  const data = await page.evaluate(
    () =>
      new Promise((done) => {
        window.__rec.onstop = async () => {
          const bytes = new Uint8Array(await new Blob(window.__chunks).arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          done(btoa(bin));
        };
        window.__rec.stop();
      }),
  );
  fs.writeFileSync(`${out}/${clip.id}.webm`, Buffer.from(data, 'base64'));
  console.log(clip.id);
}
fs.writeFileSync(`${out}/clips.json`, JSON.stringify(clips, null, 1));
if (errors.length) console.log('errors:', errors.slice(0, 10));
await browser.close();
