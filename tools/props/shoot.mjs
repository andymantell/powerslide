// Screenshots the prop sheet: node tools/props/shoot.mjs out.png [query]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const out = process.argv[2] || 'props.png';
const query = process.argv[3] || '';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: +(process.env.SHOT_DPR || 1) });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5173/tools/props/?${query}`);
await page.waitForFunction(() => window.__propsReady, null, { timeout: 300000 });
await page.screenshot({ path: out });
await browser.close();
