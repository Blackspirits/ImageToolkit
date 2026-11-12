// End-to-end: full-page capture at a fractional display scale (Windows at 125%, page zoom).
// Its own browser, since the display scale is fixed at launch.
// Run with: npm run test:e2e

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 200 bands of 20 CSS px, each its own colour: every row of the capture tells where it came from.
const BANDS = 200;
const colour = (b) => [(b * 37) % 256, (b * 91) % 256, (b * 53) % 256];
const PAGE = `<!doctype html><html><head><style>body{margin:0}div{height:20px}</style></head><body>${
  Array.from({ length: BANDS }, (_, b) => `<div style="background:rgb(${colour(b).join(',')})"></div>`).join('')}</body></html>`;

let server, base, ctx, sw;

before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'itk-scale-')), {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    viewport: null, // the real window, so the screenshots are what a user's display gives
    args: ['--force-device-scale-factor=1.25', '--screen-info={1600x1200}', '--window-size=1000,800', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
});

after(async () => {
  await ctx?.close();
  server?.close();
});

async function captureBands(zoom) {
  const page = await ctx.newPage();
  await page.goto(base);
  const tab = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0]), base);
  if (zoom !== 1) {
    await sw.evaluate(([id, z]) => chrome.tabs.setZoom(id, z), [tab.id, zoom]);
    await page.waitForTimeout(400);
  }
  const known = new Set(ctx.pages());
  await sw.evaluate((id) => captureFullPage(id), tab.id);
  let viewer;
  for (let i = 0; i < 300 && !viewer; i++) {
    viewer = ctx.pages().find((p) => !known.has(p) && p.url().includes('view.html'));
    if (!viewer) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(viewer, 'the capture opens');
  await viewer.waitForSelector('#app[data-ready="true"]');
  // The band of every row down the middle of the capture (-1 for a blended edge row).
  const rows = await viewer.evaluate((colours) => {
    const img = document.getElementById('shot');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
    const out = [];
    for (let r = 0; r < c.height; r++) {
      let best = -1, bestDist = 1e9;
      colours.forEach((col, b) => {
        const dist = Math.abs(col[0] - d[r * 4]) + Math.abs(col[1] - d[r * 4 + 1]) + Math.abs(col[2] - d[r * 4 + 2]);
        if (dist < bestDist) { bestDist = dist; best = b; }
      });
      out.push(bestDist < 12 ? best : -1);
    }
    return out;
  }, Array.from({ length: BANDS }, (_, b) => colour(b)));
  await viewer.close();
  await page.close();
  return rows;
}

for (const zoom of [1, 1.1]) {
  test(`full-page capture at 125% display scale${zoom === 1 ? '' : ` and ${Math.round(zoom * 100)}% zoom`}: no seams between slices`, async () => {
    const runs = [];
    for (const b of await captureBands(zoom)) {
      if (b < 0) continue;
      const last = runs.at(-1);
      if (last && last.b === b) last.n++;
      else runs.push({ b, n: 1 });
    }
    // Every band once, in order: an empty line or a repeated strip between slices breaks a band.
    assert.deepEqual(runs.map((r) => r.b), Array.from({ length: BANDS }, (_, b) => b));
    const heights = runs.slice(1, -1).map((r) => r.n).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)];
    const odd = runs.slice(1, -1).filter((r) => Math.abs(r.n - typical) > 2);
    assert.deepEqual(odd, [], `every band is about ${typical} rows tall`);
  });
}
