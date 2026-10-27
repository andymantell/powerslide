// node tools/sky/shoot.mjs out.png 'time=dusk&weather=cloudy'
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const [out = 'sky.png', query = ''] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${process.env.SHOT_URL || 'http://localhost:5173/'}tools/sky/?${query}`);
await page.waitForFunction(() => document.title === 'Sky ready', null, { timeout: 300000 });
await page.screenshot({ path: out, timeout: 300000 });
await browser.close();
