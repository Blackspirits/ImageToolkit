// End-to-end tests: loads the unpacked extension in Chromium (Playwright) and drives
// the real service worker, offscreen document, content script and pages.
// Run with: npm run test:e2e   (needs `npm install` and `npx playwright install chromium`)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------- Fixtures ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width, height, rgba = [255, 0, 0, 255]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgba).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const FIXTURES = {
  'anim.gif': Buffer.from('R0lGODlhAQABAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJCgAAACwAAAAAAQABAAACAkQBACH5BAkKAAAALAAAAAABAAEAAAICTAEAOw==', 'base64'),
  'logo.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'),
  'photo.png': png(30, 20),
  'wide.png': png(40, 20, [0, 128, 255, 255]),
  'noext': png(8, 8),
  'page.html': Buffer.from('<!doctype html><title>t</title><body><img src="anim.gif"><img src="logo.svg"><img src="photo.png" srcset="photo.png 1x, wide.png 2x"><div style="position:fixed;inset:0 auto auto 0;width:50px;height:50px;background:url(wide.png)"></div><a href="javascript:alert(1)//x.png">x</a></body>'),
};
const TYPES = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', html: 'text/html' };

let server, base, ctx, sw, id, ui;

async function send(message) {
  return ui.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    const body = FIXTURES[name];
    if (!body) { res.writeHead(404); res.end(); return; }
    // "noext" is served without a useful type, like many CDNs do.
    res.writeHead(200, { 'content-type': TYPES[name.split('.').pop()] || 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;

  ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'itk-')), {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  id = new URL(sw.url()).host;
  ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
});

after(async () => {
  await ctx?.close();
  server?.close();
});

test('"Original" keeps the exact bytes and detects the real type', async () => {
  for (const [name, type] of [['anim.gif', 'gif'], ['logo.svg', 'svg'], ['photo.png', 'png'], ['noext', 'png']]) {
    const r = await send({ action: 'processAndReturnData', imageUrl: base + name, instructions: { passthrough: true } });
    assert.equal(r.format, type, name);
    assert.ok(Buffer.from(r.dataUrl.split(',')[1], 'base64').equals(FIXTURES[name]), `${name} bytes differ`);
  }
});

test('AVIF falls back to WebP and reports it', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'avif', quality: 0.8 } });
  assert.ok(['avif', 'webp'].includes(r.format));
  assert.ok(r.dataUrl.startsWith(`data:image/${r.format};`));
});

test('saved files are named after the produced format', async () => {
  const avif = await send({ action: 'processAndSave', imageUrl: base + 'photo.png', instructions: { format: 'avif', saveAs: false, silent: true } });
  assert.match(avif.filename, /^photo\.(avif|webp)$/);
  assert.equal(avif.filename.split('.').pop(), avif.format);
  const svg = await send({ action: 'processAndSave', imageUrl: base + 'logo.svg', instructions: { passthrough: true, saveAs: false, silent: true } });
  assert.equal(svg.filename, 'logo.svg');
  assert.equal(svg.dataUrl, undefined, 'save responses should not carry the image back');
});

test('fit mode letterboxes with transparency', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'wide.png', instructions: { format: 'png', cropWidth: 20, cropHeight: 20, fitMode: true } });
  assert.equal(r.width, 20);
  const alpha = await ui.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 20; c.height = 20;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return [x.getImageData(10, 0, 1, 1).data[3], x.getImageData(10, 10, 1, 1).data[3]];
  }, r.dataUrl);
  assert.deepEqual(alpha, [0, 255]);
});

test('oversized outputs are rejected with a clear error', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'png', width: 16000, height: 16000 } });
  assert.match(r.error, /too large/i);
});

test('unsupported URL schemes are refused', async () => {
  const r = await send({ action: 'fetchAsDataUrl', imageUrl: 'file:///etc/hostname' });
  assert.match(r.error, /Unsupported/);
});

test('scanner collects images, skips unsafe schemes and survives re-injection', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await page.bringToFront();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  const first = await send({ action: 'collectImages', tabId });
  const srcs = first.images.map((i) => i.src);
  for (const name of ['anim.gif', 'logo.svg', 'photo.png', 'wide.png']) assert.ok(srcs.includes(base + name), name);
  assert.ok(!srcs.some((s) => s.startsWith('javascript:')));
  // Injecting again must not throw or duplicate listeners.
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content.js'] }), tabId);
  const second = await send({ action: 'collectImages', tabId });
  assert.equal(second.images.length, first.images.length);
  await page.close();
});

test('content scripts cannot use privileged actions', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const result = await sw.evaluate(async ({ url, target }) => {
    const [tab] = await chrome.tabs.query({ url });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (u) => new Promise((resolve) => chrome.runtime.sendMessage({ action: 'fetchAsDataUrl', imageUrl: u }, (r) => resolve(r ?? null))),
      args: [target],
    });
    return injection.result;
  }, { url: base + 'page.html', target: base + 'photo.png' });
  assert.equal(result, null);
  await page.close();
});

test('pages that cannot be scripted report "restricted"', async () => {
  const tabId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  assert.equal((await send({ action: 'collectImages', tabId })).error, 'restricted');
  assert.equal((await send({ action: 'startCapture', tabId })).error, 'restricted');
});

test('saving a setting keeps unrelated keys', async () => {
  await ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) => chrome.storage.sync.set({ settings: { ...settings, savedAtLeastW: 500, savedAtLeastH: 300 } })));
  await ui.reload();
  await ui.waitForSelector('#setting-quality', { state: 'attached' });
  await ui.evaluate(() => { const q = document.getElementById('setting-quality'); q.value = '70'; q.dispatchEvent(new Event('change')); });
  const settings = await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then((r) => (r.settings.defaultQuality === 70 ? r.settings : null))));
  assert.equal(settings.savedAtLeastW, 500);
  assert.equal(settings.savedAtLeastH, 300);
});

test('editor opens from a handoff, crops and saves', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const info = await waitFor(() => editor.textContent('#info-text'));
  assert.match(info, /40 × 20/);
  // Playwright renames intercepted downloads, so count PNG downloads instead of matching names.
  const countPng = () => sw.evaluate(() => chrome.downloads.search({ mime: 'image/png' }).then((d) => d.length));
  const before = await countPng();
  const toastText = await editor.evaluate(async () => {
    document.querySelector('#resize-format [data-value="png"]').click();
    await save();
    return document.getElementById('toasts').textContent;
  });
  assert.match(toastText, /PNG/);
  await waitFor(async () => (await countPng()) > before);
  await editor.close();
});

test('the panel copies images straight to the clipboard', async () => {
  // Chromium only grants clipboard-read to web origins, so read it back from a page.
  const reader = await ctx.newPage();
  await reader.goto(base + 'page.html');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await ui.bringToFront();
  await ui.evaluate((src) => copyImage(src), base + 'photo.png');
  assert.match(await ui.textContent('#toasts'), /./);
  await reader.bringToFront();
  const types = await reader.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  await reader.close();
});

test('context-menu copy writes the image from the focused page', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await page.bringToFront();
  await page.evaluate(() => navigator.clipboard.writeText('placeholder'));
  const result = await sw.evaluate(async ({ url, image }) => {
    const [tab] = await chrome.tabs.query({ url });
    return copyImageUrl(image, tab.id, { showNotification: false });
  }, { url: base + 'page.html', image: base + 'photo.png' });
  assert.deepEqual(result, { success: true });
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  await page.close();
});

test('area capture crops the selection and opens the editor', async () => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(base + 'page.html');
  await page.bringToFront();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  assert.deepEqual(await send({ action: 'startCapture', tabId }), { success: true });
  await page.waitForSelector('#imagetoolkit-capture-overlay');
  await page.bringToFront();
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 250, { steps: 5 });
  await page.mouse.up();
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html') && p !== page), 10000);
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const info = await waitFor(() => editor.textContent('#info-text'));
  const dpr = await page.evaluate(() => devicePixelRatio);
  assert.equal(info, `${200 * dpr} × ${150 * dpr} px`);
  assert.equal(await page.$('#imagetoolkit-capture-overlay'), null);
  await editor.close();
  await page.close();
});

test('batch download from the panel saves every image without dialogs', async () => {
  await ui.bringToFront();
  await ui.evaluate(() => document.querySelector('.tab[data-tab="images"]').click());
  const countDownloads = () => sw.evaluate(() => chrome.downloads.search({}).then((d) => d.length));
  const before = await countDownloads();
  await ui.evaluate((b) => {
    setImages(['photo.png', 'wide.png', 'anim.gif'].map((n) => ({ src: b + n, width: 0, height: 0 })));
    toggleSelectAll();
    document.getElementById('action-format').value = 'png';
  }, base);
  assert.equal(await ui.textContent('#action-bar-count'), '3');
  await ui.click('#action-download');
  await waitFor(async () => /3/.test(await ui.textContent('#progress-text')) && !(await ui.isDisabled('#action-download')), 15000);
  assert.match(await ui.textContent('#progress-text'), /3\D+3/);
  await waitFor(async () => (await countDownloads()) >= before + 3);
});
