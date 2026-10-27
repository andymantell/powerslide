// Sound check: boots the game headless, plays scenes and records what comes
// out of the master bus, so the sound can be heard without an iPad.
//   node tools/audio-check.mjs [url] [outDir] [scene,scene,...]
// Scenes: menu, ride, and one per biome id (its ambience, with a run on top).
// Writes <scene>.webm (Opus) and prints each bus's loudness.
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
const out = process.argv[3] || 'sounds';
const BIOMES = ['alpine', 'dartmoor', 'suburbs', 'forest', 'canyon', 'city', 'coast', 'pass'];
const scenes = process.argv[4] ? process.argv[4].split(',') : ['menu', 'ride', ...BIOMES];
fs.mkdirSync(out, { recursive: true });

const browser = await pw.chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('powerslide.quality', '"low"'));
await page.goto(url);
await page.waitForFunction(() => window.__powerslide?.game.mode === 'title', null, { timeout: 300000 });
await page.mouse.click(5, 5); // the first touch starts the audio
await page.waitForFunction(() => window.__powerslide.audio.ctx?.state === 'running');

// Taps the master and each bus with an analyser, and records the master.
await page.evaluate(() => {
  const a = window.__powerslide.audio;
  const meter = (node) => {
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    node.connect(an);
    return an;
  };
  window.__meters = { master: meter(a.master), effects: meter(a.bus.effects), ambience: meter(a.bus.ambience), music: meter(a.bus.music) };
  window.__dest = a.ctx.createMediaStreamDestination();
  a.master.connect(window.__dest);
});

async function record(name, seconds, act, solo = null) {
  await page.evaluate((solo) => {
    const a = window.__powerslide.audio;
    for (const k of ['effects', 'ambience', 'music']) a.bus[k].gain.value = solo && solo !== k ? 0 : 1;
    if (!solo) a.applyVolume();
    a.ambience.log = [];
  }, solo);
  await page.evaluate(() => {
    window.__chunks = [];
    window.__peaks = { master: 0, effects: 0, ambience: 0, music: 0 };
    window.__sum = { master: 0, effects: 0, ambience: 0, music: 0, n: 0 };
    const rec = (window.__rec = new MediaRecorder(window.__dest.stream, { mimeType: 'audio/webm;codecs=opus' }));
    rec.ondataavailable = (e) => window.__chunks.push(e.data);
    rec.start();
    const buf = new Float32Array(2048);
    window.__meterT = setInterval(() => {
      for (const [k, an] of Object.entries(window.__meters)) {
        an.getFloatTimeDomainData(buf);
        let s = 0, p = 0;
        for (const x of buf) {
          if (!Number.isFinite(x)) window.__nan = true;
          s += x * x;
          p = Math.max(p, Math.abs(x));
        }
        window.__sum[k] += Math.sqrt(s / buf.length);
        window.__peaks[k] = Math.max(window.__peaks[k], p);
      }
      window.__sum.n++;
    }, 100);
  });
  await act();
  await page.waitForTimeout(seconds * 1000);
  const res = await page.evaluate(
    () =>
      new Promise((done) => {
        clearInterval(window.__meterT);
        window.__rec.onstop = async () => {
          const blob = new Blob(window.__chunks, { type: 'audio/webm' });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const n = window.__sum.n || 1;
          const rms = Object.fromEntries(['master', 'effects', 'ambience', 'music'].map((k) => [k, +(window.__sum[k] / n).toFixed(4)]));
          done({ data: btoa(bin), rms, peaks: window.__peaks, nan: !!window.__nan });
        };
        window.__rec.stop();
      }),
  );
  fs.writeFileSync(`${out}/${name}.webm`, Buffer.from(res.data, 'base64'));
  const peaks = Object.fromEntries(Object.entries(res.peaks).map(([k, v]) => [k, +v.toFixed(3)]));
  const extra = await page.evaluate(() => ({ calls: window.__powerslide.audio.ambience.log, top: Math.round(window.__powerslide.player.topSpeed * 3.6) }));
  console.log(name.padEnd(9), 'rms', JSON.stringify(res.rms), 'peak', JSON.stringify(peaks), res.nan ? 'NaN!' : '');
  console.log('          calls:', extra.calls.join(' '), '| top speed km/h:', extra.top);
}

const key = (k, ms) => page.keyboard.down(k).then(() => page.waitForTimeout(ms)).then(() => page.keyboard.up(k));
// A run: push off, tuck, carve, slide, hand-down slide, brake.
async function ride() {
  await page.evaluate(() => document.getElementById('start')?.click());
  await page.waitForFunction(() => window.__powerslide.game.mode === 'play', null, { timeout: 60000 }).catch(() => {});
  (async () => {
    await key('ArrowUp', 7000);
    await page.keyboard.down('ArrowLeft');
    await key('Space', 1800);
    await page.keyboard.up('ArrowLeft');
    await key('ArrowUp', 3000);
    await key('Space', 1500);
    await key('ArrowDown', 2500);
  })();
}

for (const name of scenes) {
  if (name === 'menu') await record('menu', 12, async () => {});
  else if (name === 'ride') await record('ride', 18, ride);
  else {
    await page.evaluate(async (b) => {
      const P = window.__powerslide;
      if (P.game.mode === 'play') P.game.mode = 'intro';
      P.audio.setScene({ biome: b });
      if (b === 'coast') P.audio.setWeather({ rain: 0, wind: 0.3 });
      if (b === 'forest') P.audio.setWeather('rain');
      if (b === 'city') P.audio.setTimeOfDay('night');
    }, name);
    await record(name, 20, async () => {}, 'ambience');
    await page.evaluate(() => {
      window.__powerslide.audio.setWeather({ rain: 0, wind: 0, thunder: false });
      window.__powerslide.audio.setTimeOfDay(13);
    });
  }
}
if (errors.length) console.log('errors:', errors.slice(0, 10));
await browser.close();
