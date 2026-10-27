// Screenshots of a level at chosen distances along the road, for before and
// after comparisons of level dressing.
//   node tools/levelshots.mjs <levelId> [outDir] [quality] [at,at,...]
// `at` is metres from the start line; each may carry a view after a colon:
// chase (default, behind and above the rider), high (a raised view down the
// road), side (from the left verge, looking across), or back (looking uphill).
// Without `at`, it shoots five points spread along the level.
//   SHOT_URL (default http://localhost:5173/) and SHOT_DPR (2 = iPad) apply.
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

const [id, out = 'shots', quality = 'medium', list] = process.argv.slice(2);
if (!id) {
  console.log('usage: node tools/levelshots.mjs <levelId> [outDir] [quality] [at,at,...]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const base = process.env.SHOT_URL || 'http://localhost:5173/';

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: +(process.env.SHOT_DPR || 1) });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((q) => localStorage.setItem('powerslide.quality', JSON.stringify(q)), quality);
await page.goto(`${base}?level=${id}`);
await page.waitForFunction(() => window.__powerslide && window.__powerslide.game.mode === 'intro', null, { timeout: 590000 });

const length = await page.evaluate(() => window.__powerslide.road.finish - window.__powerslide.road.start);
const points = list
  ? list.split(',').map((p) => {
      const [at, view = 'chase'] = p.split(':');
      return { at: +at, view };
    })
  : [0.02, 0.25, 0.5, 0.75, 0.97].map((k) => ({ at: Math.round(k * length), view: 'chase' }));

for (const { at, view } of points) {
  await page.evaluate(async ({ at, view }) => {
    const P = window.__powerslide;
    P.freeze = true;
    for (const el of document.querySelectorAll('.panel, #hud, #fps, #runbtns')) el.classList.add('hidden');
    const { player, road, roadMesh, terrain, camera } = P;
    player.reset(road.start + at);
    player.animate?.(0.016);
    roadMesh.update(player.s);
    while (!terrain.update(player.pos.x, player.pos.z, 1e9));
    P.forest.update(player.pos.x, player.pos.z);
    P.forest.dirty = true;
    P.forest.update(player.pos.x, player.pos.z);
    P.boulders.update();
    P.props?.update(player.pos.x, player.pos.z, player.s, true);
    P.grass.fill(player.pos.x, player.pos.z);
    const f = road.sample(player.s, {});
    const p = player.pos;
    const fx = f.dirX, fz = f.dirZ, rx = f.rightX, rz = f.rightZ;
    const V = {
      chase: [-6, 2.6, 0, 30, 0.5, 0],
      high: [-20, 14, 0, 90, -4, 0],
      side: [6, 2.5, -9, 20, 2, 6],
      back: [12, 3, 0, -30, 1, 0],
    }[view] || [-6, 2.6, 0, 30, 0.5, 0];
    const [back, up, side, ahead, lookUp, lookSide] = V;
    camera.position.set(p.x + fx * back + rx * side, p.y + up, p.z + fz * back + rz * side);
    const ground = terrain.heightAt(camera.position.x, camera.position.z);
    camera.position.y = Math.max(camera.position.y, ground + 1);
    camera.lookAt(p.x + fx * ahead + rx * lookSide, p.y + lookUp, p.z + fz * ahead + rz * lookSide);
    camera.fov = 62;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    P.sun.position.copy(p).addScaledVector(P.SUN_DIR, 150);
    P.sun.target.position.copy(p);
    P.sun.target.updateMatrixWorld();
    P.renderFrame();
    await new Promise((r) => setTimeout(r, 50));
  }, { at, view });
  const file = `${out}/${id}-${String(at).padStart(4, '0')}-${view}.png`;
  await page.screenshot({ path: file, timeout: 590000 });
  console.log('shot', file);
}
await browser.close();
