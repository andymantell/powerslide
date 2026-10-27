// Screenshot harness for visual iteration: boots the game headless, freezes
// the loop and renders a fixed set of camera views to PNGs.
//   node tools/shots.mjs [url] [outDir] [quality]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// Playwright is preinstalled globally in CI/cloud images; fall back to that.
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const { chromium } = pw;
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'shots';
const quality = process.argv[4] || 'high';
const only = process.argv[5] ? process.argv[5].split(',') : null;
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// SHOT_DPR mimics a high-density screen such as the iPad's (2).
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: +(process.env.SHOT_DPR || 1) });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((q) => {
  localStorage.setItem('powerslide.quality', JSON.stringify(q));
  Math.random = (() => { let a = 12345; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
}, quality);
await page.goto(url);
await page.waitForFunction(() => window.__powerslide && ['title', 'intro'].includes(window.__powerslide.game.mode), null, { timeout: 590000 });
await page.evaluate(() => window.__powerslide.bakeClouds?.(Infinity));
await page.waitForTimeout(1500);

const views = {
  // name: [offset behind, height, look ahead, look height, side offset]
  chase: { back: 4.6, up: 1.8, ahead: 5, lookUp: 0.9, side: 0 },
  rider: { back: -2.2, up: 1.1, ahead: 0, lookUp: 0.75, side: 1.6 },
  board: { back: -0.9, up: 0.45, ahead: 0, lookUp: 0.08, side: 0.7 },
  road: { back: 2, up: 1.6, ahead: 30, lookUp: 0, side: -1.5 },
  vista: { back: 14, up: 7, ahead: 120, lookUp: 0, side: 3 },
  trees: { back: 2, up: 1.7, ahead: 25, lookUp: 2.5, side: -7 },
  forest: { back: -10, up: 3, ahead: 0, lookUp: 3, side: 25 },
  verge: { back: 0, up: 0.9, ahead: 14, lookUp: 0.4, side: 3.5 },
  cutting: { target: 'cutting' },
  distant: { target: 'distant' },
  // The sky, looking 18° up towards the sun and away from it.
  sun: { target: 'sky', toSun: 1 },
  sky: { target: 'sky', toSun: -1 },
  boulder: { target: 'boulder', back: 4, up: 1.5, ahead: 0, lookUp: 0.5, side: 1 },
  // The nearest vehicles: from the roadside, and following one.
  traffic: { target: 'traffic', side: 5, up: 1.6, back: -6 },
  tail: { target: 'traffic', side: 0.2, up: 2.2, back: 9, far: true },
};
for (const [name, v] of Object.entries(views)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(async (v0) => {
    let v = v0;
    const P = window.__powerslide;
    P.freeze = true;
    for (const id of ['title', 'controls', 'hud', 'fps']) document.getElementById(id)?.classList.add('hidden');
    const { player, camera, renderer, scene, terrain } = P;
    const fx = Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = -fz, rz = fx;
    let p = player.pos;
    if (v.target === 'sky') {
      const d = P.SUN_DIR;
      const h = Math.hypot(d.x, d.z) || 1;
      camera.position.set(p.x, p.y + 1.6, p.z);
      camera.lookAt(p.x + (d.x / h) * v.toSun * 100, p.y + 1.6 + 32, p.z + (d.z / h) * v.toSun * 100);
      camera.fov = 75;
      camera.updateProjectionMatrix();
      P.renderFrame();
      return;
    }
    if (v.target === 'boulder') {
      // Frame the biggest boulder near the rider.
      let best = null;
      const m = new P.camera.matrix.constructor();
      const pos = p.clone(), q = P.camera.quaternion.clone(), sc = p.clone();
      for (const mesh of P.boulders.meshes) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          m.decompose(pos, q, sc);
          const d = pos.distanceTo(p);
          if (d < 120 && sc.x < 1.6 && (!best || sc.x / (d + 20) > best.s / (best.d + 20))) best = { p: pos.clone(), s: sc.x, d };
        }
      }
      if (best) {
        p = best.p;
        v = { ...v, back: best.s * 4, up: best.s * 1.5, lookUp: best.s * 0.5, side: best.s * 1.5 };
      }
    }
    if (v.night) {
      // Fake a night for checking headlamps: no sun, no sky light.
      P.sun.intensity = 0.02;
      P.scene.environmentIntensity = 0.03;
      P.scene.background = new P.sun.color.constructor('#05070c');
      P.traffic.lights = 1;
    }
    if (v.left && !P.leftDone) {
      // Check keep-left traffic (SHOT_LEFT=1) without needing a left-hand level.
      P.leftDone = true;
      P.traffic.setPlace('dartmoor', 'left');
      P.player.side = -1;
      P.traffic.configure({ density: 1.4 }, 7);
      P.player.reset(P.player.s);
    }
    if (v.target === 'traffic') {
      // Drive the traffic on a few seconds so the road fills, then frame a vehicle.
      const { traffic } = P;
      for (let i = 0; i < 3; i++) traffic.spawn(player.s, i % 2 ? 1 : -1);
      for (let i = 0; i < 240; i++) traffic.update(1 / 60, player, []);
      const cars = traffic.cars.filter((c) => c.s > player.s + 15).sort((a, b) => a.s - b.s);
      const c = v.far ? cars.find((x) => x.dir > 0) || cars[0] : cars[0];
      if (c) {
        const cfx = Math.sin(c.yaw), cfz = -Math.cos(c.yaw);
        const crx = -cfz, crz = cfx;
        const back = v.far ? v.back : v.back + c.L / 2;
        camera.position.set(c.x - cfx * back + crx * v.side * Math.sign(c.lane || 1), c.y + v.up, c.z - cfz * back + crz * v.side * Math.sign(c.lane || 1));
        camera.lookAt(c.x, c.y + 0.9, c.z);
        camera.fov = 50;
        camera.updateProjectionMatrix();
        traffic.draw(camera);
        console.warn('traffic', c.type, c.dir, c.lane.toFixed(2));
        P.renderFrame();
        return;
      }
    }
    if (v.pr) {
      // Mimic dynamic resolution dropping the render scale.
      renderer.setPixelRatio(+v.pr);
      P.post?.setPixelRatio?.(+v.pr);
    }
    if (v.target === 'distant') {
      // Look across the valley at the hillside 150-400 m away, where trees are impostors.
      const side = terrain.heightAt(p.x + rx * 200, p.z + rz * 200) < terrain.heightAt(p.x - rx * 200, p.z - rz * 200) ? 1 : -1;
      const tx = p.x + rx * side * 260 + fx * 120, tz = p.z + rz * side * 260 + fz * 120;
      camera.position.set(p.x, p.y + 4, p.z);
      camera.lookAt(tx, terrain.heightAt(tx, tz) + 10, tz);
      camera.fov = 40;
      camera.updateProjectionMatrix();
      P.renderFrame();
      return;
    }

    if (v.target === 'cutting') {
      // Find the rockiest road cut ahead and look at it from the far lane.
      const { road } = P;
      const f = {}, fd = {};
      let best = null;
      for (let s = player.s - 400; s < player.s + 450; s += 6) {
        road.sample(s, f);
        for (const side of [-1, 1]) {
          const x = f.x + f.rightX * side * 10, z = f.z + f.rightZ * side * 10;
          road.field(x, z, fd);
          const h = terrain.heightFromField(x, z, fd, false);
          const hx = terrain.heightAt(x + 1, z), hz = terrain.heightAt(x, z + 1);
          const ny = 1 / Math.hypot(hx - h, 1, hz - h);
          const sf = terrain.surface(x, z, h - fd.roadY, fd.dist, ny);
          const score = sf.rock * (1 - sf.gravel) + Math.min(h - fd.roadY, 8) * 0.05;
          if (!best || score > best.score) best = { score, s, side, x, y: h, z };
        }
      }
      console.warn('cutting', JSON.stringify(best));
      road.sample(best.s - 14, f);
      const ex = f.x - f.rightX * best.side * 2.5, ez = f.z - f.rightZ * best.side * 2.5;
      camera.position.set(ex, f.y + 1.6, ez);
      camera.lookAt(best.x, best.y + 1.5, best.z);
      camera.fov = 60;
      camera.updateProjectionMatrix();
      P.grass.fill(ex, ez);
      P.renderFrame();
      return;
    }
    camera.position.set(p.x - fx * v.back + rx * v.side, p.y + v.up, p.z - fz * v.back + rz * v.side);
    camera.lookAt(p.x + fx * v.ahead, p.y + v.lookUp, p.z + fz * v.ahead);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    for (let i = 0; i < 1; i++) { P.renderFrame ? P.renderFrame() : renderer.render(scene, camera); await new Promise((r) => setTimeout(r, 50)); }
  }, { ...v, pr: process.env.SHOT_PR ? +process.env.SHOT_PR : 0, night: !!process.env.SHOT_NIGHT, left: !!process.env.SHOT_LEFT });
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 590000 });
  console.log('shot', name);
}
await browser.close();
