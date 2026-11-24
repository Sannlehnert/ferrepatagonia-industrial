const path = require('node:path');
const { chromium } = require(path.resolve(process.argv[2], 'frontend/node_modules/@playwright/test'));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try { const page = await browser.newPage(); await page.goto('about:blank'); console.log('Chromium ready: ' + browser.version()); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
