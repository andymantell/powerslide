// Renders public/icons/icon.svg to the PNG sizes the web app manifest and iOS need.
// Run with `npm run icons` after changing the SVG; the PNGs are committed.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Playwright is not a project dependency; use whichever copy is installed globally.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = new URL('../public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of Object.entries(sizes)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(name, dir).pathname, omitBackground: false });
}
await browser.close();
