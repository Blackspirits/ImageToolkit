// Renders the PNG icon set from the vector sources in docs/brand.
// Usage: npm run build:icons  (needs the Playwright Chromium used by the e2e tests)

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = (name) => `data:image/svg+xml;base64,${readFileSync(`docs/brand/${name}`).toString('base64')}`;
// Same drawing in all three; only stroke weight and finish change (see docs/brand/README.md).
const MASTER = svg('logo.svg'); // 64 px and up (every export here is 128 px or larger)
const COMPACT = svg('logo-compact.svg'); // 32/48 px
const MICRO = svg('logo-micro.svg'); // 16 px

// [output, source, canvas size, artwork size]
const TARGETS = [
  ['icons/icon16.png', MICRO, 16, 16],
  ['icons/icon32.png', COMPACT, 32, 32],
  ['icons/icon48.png', COMPACT, 48, 48],
  // Chrome Web Store: 96 px artwork with 16 px of transparent padding (room for the shadow).
  ['icons/icon128.png', MASTER, 128, 96],
  ['icons/logo16.png', MICRO, 16, 16],
  ['icons/logo32.png', COMPACT, 32, 32],
  ['icons/logo48.png', COMPACT, 48, 48],
  ['icons/logo128.png', MASTER, 128, 128],
  ['icons/logo256.png', MASTER, 256, 256],
  ['icons/logo256-rounded.png', MASTER, 256, 256],
  ['icons/logo512.png', MASTER, 512, 512],
  ['icons/logo512-rounded.png', MASTER, 512, 512],
  ['icons/logo1024.png', MASTER, 1024, 1024],
  ['icons/logo.png', MASTER, 1024, 1024],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [out, src, canvas, art] of TARGETS) {
  const pad = (canvas - art) / 2;
  const shadow = pad ? 'filter:drop-shadow(0 2px 4px rgba(27,15,92,.35))' : '';
  await page.setContent(`<body style="margin:0;background:transparent">
    <div id="c" style="width:${canvas}px;height:${canvas}px;padding:${pad}px;box-sizing:border-box">
      <img src="${src}" width="${art}" height="${art}" style="display:block;${shadow}">
    </div></body>`);
  await page.locator('img').evaluate((img) => img.decode());
  writeFileSync(out, await page.locator('#c').screenshot({ omitBackground: true }));
  console.log(`${out}  ${canvas}×${canvas}`);
}
await browser.close();
copyFileSync('docs/brand/logo.svg', 'icons/logo.svg');
