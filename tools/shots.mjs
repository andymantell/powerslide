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
await page.waitForFunction(() => window.__powerslide && window.__powerslide.game.mode === 'title', null, { timeout: 590000 });
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
  boulder: { target: 'boulder', back: 4, up: 1.5, ahead: 0, lookUp: 0.5, side: 1 },
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
  }, { ...v, pr: process.env.SHOT_PR ? +process.env.SHOT_PR : 0 });
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 590000 });
  console.log('shot', name);
}
await browser.close();
