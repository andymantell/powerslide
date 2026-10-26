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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((q) => {
  localStorage.setItem('powerslide.quality', JSON.stringify(q));
  Math.random = (() => { let a = 12345; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
}, quality);
await page.goto(url);
await page.waitForFunction(() => window.__powerslide && window.__powerslide.game.mode === 'title', null, { timeout: 180000 });
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
          if (d < 120 && (!best || sc.x / (d + 20) > best.s / (best.d + 20))) best = { p: pos.clone(), s: sc.x, d };
        }
      }
      if (best) {
        p = best.p;
        v = { ...v, back: best.s * 4, up: best.s * 1.5, lookUp: best.s * 0.5, side: best.s * 1.5 };
      }
    }
    camera.position.set(p.x - fx * v.back + rx * v.side, p.y + v.up, p.z - fz * v.back + rz * v.side);
    camera.lookAt(p.x + fx * v.ahead, p.y + v.lookUp, p.z + fz * v.ahead);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    for (let i = 0; i < 3; i++) { P.renderFrame ? P.renderFrame() : renderer.render(scene, camera); await new Promise((r) => setTimeout(r, 50)); }
  }, v);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  console.log('shot', name);
}
await browser.close();
