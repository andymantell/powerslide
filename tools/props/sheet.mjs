// Renders the numbered prop sheet: one image per prop, and an index.
//   npm run dev, then node tools/props/sheet.mjs [outDir] [only,names]
// Numbers are kept in tools/props/sheet-ids.json, so a prop keeps its number
// from one sheet to the next and new props get the next free ones.
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
const out = process.argv[2] || 'props-sheet';
const only = process.argv[3]?.split(',');
const IDS = new URL('./sheet-ids.json', import.meta.url);
const ids = fs.existsSync(IDS) ? JSON.parse(fs.readFileSync(IDS)) : {};
fs.mkdirSync(out, { recursive: true });

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: +(process.env.SHOT_DPR || 1) });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.SHOT_URL || 'http://localhost:5173/'}tools/props/sheet.html`);
await page.waitForFunction(() => window.__sheetReady, null, { timeout: 300000 });
const items = await page.evaluate(() => window.__sheet.items);

let next = Math.max(0, ...Object.values(ids)) + 1;
for (const it of items) if (!ids[it.name]) ids[it.name] = next++;
if (!only) fs.writeFileSync(IDS, `${JSON.stringify(ids, null, 1)}\n`);

const index = [];
for (const it of items) {
  if (only && !only.includes(it.name)) continue;
  const num = String(ids[it.name]).padStart(3, '0');
  const size = await page.evaluate(([n, l]) => window.__sheet.show(n, l), [it.name, `${num} ${it.name}`]);
  const file = `${num}-${it.name}.jpg`;
  await page.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 88 });
  index.push({ id: num, name: it.name, group: it.group, file, size });
  console.log(num, it.name, size);
}
fs.writeFileSync(`${out}/index.json`, `${JSON.stringify(index, null, 1)}\n`);
await browser.close();
