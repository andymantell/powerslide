// Boots the game at each quality preset and fails if it doesn't reach the
// level intro, logs an error, or has a single draw call that runs too long.
// The headless GPU is software (draws are timed with a read-back after each),
// so timings are rough and only flag gross offenders (a
// draw that takes seconds here can make a phone browser drop the GPU):
// node tools/loadcheck.mjs [levelId] [presets]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const [level = 'alpine-07', presets = 'low,high'] = process.argv.slice(2);
const LONG_MS = +(process.env.LONG_MS || 5000);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
for (const q of presets.split(',')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((qq) => {
    localStorage.setItem('powerslide.quality', JSON.stringify(qq));
    window.__longest = 0;
    // Time every draw call to completion (finish), so one slow GPU draw
    // shows up even though the GPU runs in another process.
    const P = WebGL2RenderingContext.prototype;
    // The software renderer resolves MSAA (High and Ultra's post target)
    // painfully slowly, and that lands on the next draw's timing, though a
    // real GPU does it in hardware. Check those presets without it.
    const rsm = P.renderbufferStorageMultisample;
    P.renderbufferStorageMultisample = function (target, samples, ...rest) {
      return rsm.call(this, target, 0, ...rest);
    };
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const orig = P[name];
      P[name] = function (...a) {
        const t = performance.now();
        orig.apply(this, a);
        this.readPixels(0, 0, 1, 1, this.RGBA_INTEGER === 0 ? 0 : this.RGBA, this.FLOAT, window.__px || (window.__px = new Float32Array(4)));
        window.__longest = Math.max(window.__longest, performance.now() - t);
      };
    }
  }, q);
  const t0 = Date.now();
  await page.goto(`${process.env.SHOT_URL || 'http://localhost:5173/'}?level=${level}`);
  let ok = true;
  try {
    await page.waitForFunction(() => window.__powerslide?.game.mode === 'intro', null, { timeout: 400000 });
    await page.waitForFunction(() => window.__powerslide.bakeClouds(0), null, { timeout: 120000 });
  } catch {
    ok = false;
  }
  const longest = await page.evaluate(() => window.__longest).catch(() => -1);
  const bad = !ok || errors.length || longest > LONG_MS;
  failed ||= bad;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${q}: ${ok ? `loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s` : 'did not load'}, slowest draw ${longest | 0} ms${errors.length ? `, errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
