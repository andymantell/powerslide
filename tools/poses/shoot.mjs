// Screenshots the pose sheet: node tools/poses/shoot.mjs out.png [query]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const out = process.argv[2] || 'poses.png';
const query = process.argv[3] || '';
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5173/tools/poses/?${query}`);
await page.waitForFunction(() => window.__posesReady, null, { timeout: 120000 });
await page.locator('canvas').screenshot({ path: out });
await browser.close();
