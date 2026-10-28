// Downloads every upload of a free itch.io page (Quaternius, Kenney) with a real browser,
// since the download links are made by the page script.
//   node tools/props/audition/fetch_itch.cjs https://quaternius.itch.io/lowpoly-cars outDir [regex]
const { chromium } = require('playwright');
const [,, P, O, rx = '.'] = process.argv;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(P);
  const url = await page.evaluate(async (P) => {
    const t = document.querySelector('meta[name=csrf_token]').getAttribute('value');
    const r = await fetch(P + '/download_url', { method: 'POST', body: new URLSearchParams({ csrf_token: t }) });
    return (await r.json()).url;
  }, P);
  await page.goto(url);
  await page.waitForTimeout(4000); // the upload list fills in after load
  const ups = await page.$$eval('.upload', (els) => els.map((e) => e.querySelector('.name')?.textContent.trim()));
  console.log(ups);
  const btns = await page.$$('.upload .download_btn');
  for (let i = 0; i < btns.length; i++) {
    if (!new RegExp(rx, 'i').test(ups[i])) continue;
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), btns[i].click()]);
    await d.saveAs(`${O}/${ups[i]}`);
    console.log('ok', ups[i]);
  }
  await b.close();
})();
