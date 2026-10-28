// Renders the audition sheet: each current prop beside its free-library
// candidates (tools/props/audition/candidates.json), in the prop sheet's light.
// Downloads go in tools/props/audition/dl (not committed): fetch_polyhaven.py
// for Poly Haven, fetch_itch.cjs for the Quaternius and Kenney packs (unzip
// them under dl/x/), as each candidate's `file` path expects.
//   python tools/blender/import_asset.py tools/props/audition/candidates.json tools/props/audition/out/audition.glb <downloads>
//   npm run dev, then node tools/props/audition.mjs outDir
// Writes one jpg per tile and outDir/audition.json (rows, candidates, licences, triangles).
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
const out = process.argv[2] || 'audition';
const here = new URL('./audition/', import.meta.url);
const cands = JSON.parse(fs.readFileSync(new URL('candidates.json', here)));
const stats = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('out/audition.json', here))).map((s) => [s.id, s]));
const ids = JSON.parse(fs.readFileSync(new URL('../sheet-ids.json', here)));
fs.mkdirSync(out, { recursive: true });

// One row per set of current props a candidate would replace.
const rows = [];
for (const c of cands) {
  if (!stats[c.id]) continue; // failed to convert
  const key = c.for[0];
  let r = rows.find((x) => x.key === key);
  if (!r) rows.push((r = { key, group: c.group, current: [], candidates: [] }));
  for (const n of c.for) if (!r.current.includes(n)) r.current.push(n);
  r.candidates.push(c);
}

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: +(process.env.SHOT_DPR || 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.SHOT_URL || 'http://localhost:5173/'}tools/props/sheet.html?audition&${process.env.SHEET_Q || ''}`);
await page.waitForFunction(() => window.__sheetReady, null, { timeout: 300000 });

const shoot = async (name, label, file) => {
  const size = await page.evaluate(([n, l]) => window.__sheet.show(n, l), [name, label]);
  await page.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 85 });
  return size;
};
const index = [];
for (const r of rows) {
  const cur = r.current[0];
  const num = String(ids[cur]).padStart(3, '0');
  const row = { key: r.key, group: r.group, current: r.current.map((n) => ({ name: n, id: String(ids[n]).padStart(3, '0') })), file: `${num}-${cur}.jpg`, candidates: [] };
  if (!fs.existsSync(`${out}/${row.file}`)) row.size = await shoot(cur, `${num} ${cur} (now)`, row.file);
  for (const c of r.candidates) {
    const file = `${num}-${c.id}.jpg`;
    const size = await shoot(c.id, `${c.lib} ${c.title}`, file);
    row.candidates.push({ id: c.id, title: c.title, lib: c.lib, url: c.url, licence: c.licence, author: c.author, tris: stats[c.id].tris, srcTris: stats[c.id].srcTris, size, file });
    console.log(num, cur, c.id);
  }
  index.push(row);
}
fs.writeFileSync(`${out}/audition.json`, `${JSON.stringify(index, null, 1)}\n`);
await browser.close();
