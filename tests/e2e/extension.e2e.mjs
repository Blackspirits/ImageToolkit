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
  // Mislabelled responses: an SVG sent as text/plain, and an HTML error page behind a .jpg URL.
  'plain.svg': Buffer.from('<?xml version="1.0"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'),
  'fake.jpg': Buffer.from('<!doctype html><title>Not found</title><p>Sorry'),
  'page.html': Buffer.from('<!doctype html><title>t</title><body><img src="anim.gif"><img src="logo.svg"><img src="photo.png" srcset="photo.png 1x, wide.png 2x"><div style="position:fixed;inset:0 auto auto 0;width:50px;height:50px;background:url(wide.png)"></div><a href="javascript:alert(1)//x.png">x</a></body>'),
};
const TYPES = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', html: 'text/html' };
const TYPE_OVERRIDES = { 'plain.svg': 'text/plain', 'fake.jpg': 'text/html' };

let server, base, ctx, sw, id, ui;
const hits = new Map(); // GET requests per path, to check that work is not repeated
let hugeBytesSent = 0;   // bytes the "huge" endpoint managed to push before the client hung up

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
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const name = decodeURIComponent(url.pathname.slice(1));
    if (req.method === 'GET') hits.set(name, (hits.get(name) || 0) + 1);

    // Endless chunked body without Content-Length: the client must stop reading at its cap.
    if (name === 'huge') {
      hugeBytesSent = 0;
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(256 * 1024);
      const pump = () => {
        while (!res.destroyed && hugeBytesSent < 200 * 1024 * 1024) {
          hugeBytesSent += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      res.on('close', () => res.destroy());
      pump();
      return;
    }
    // Refuses <img> loads (like hotlink protection) but serves fetches.
    if (name === 'hotlink.png' && req.headers['sec-fetch-dest'] === 'image') { res.writeHead(403); res.end(); return; }

    const delay = Number(url.searchParams.get('delay')) || 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const body = name === 'hotlink.png' ? FIXTURES['wide.png'] : FIXTURES[name];
    if (!body) { res.writeHead(404); res.end(); return; }
    // "noext" is served without a useful type, like many CDNs do.
    res.writeHead(200, { 'content-type': TYPE_OVERRIDES[name] || TYPES[name.split('.').pop()] || 'application/octet-stream', 'cache-control': 'no-store', 'content-length': body.length });
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

test('"Original" trusts content over a wrong MIME type, but never saves HTML as an image', async () => {
  const svg = await send({ action: 'processAndReturnData', imageUrl: base + 'plain.svg', instructions: { passthrough: true } });
  assert.equal(svg.format, 'svg');
  assert.ok(Buffer.from(svg.dataUrl.split(',')[1], 'base64').equals(FIXTURES['plain.svg']));
  const html = await send({ action: 'processAndReturnData', imageUrl: base + 'fake.jpg', instructions: { passthrough: true } });
  assert.match(html.error, /Unsupported image type/);
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

test('the format advisor downloads the image once and reports every format', async () => {
  hits.delete('wide.png');
  const r = await send({ action: 'analyzeFormats', imageUrl: base + 'wide.png' });
  assert.deepEqual(r.results.map((x) => x.format), ['png', 'jpeg', 'webp']);
  assert.ok(r.results.every((x) => x.size > 0));
  assert.equal(r.originalSize, FIXTURES['wide.png'].length);
  assert.equal(r.hasAlpha, false);
  assert.equal(hits.get('wide.png'), 1);
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


// ---------- Regression tests for the second audit ----------

async function freshPanel() {
  await ui.bringToFront();
  await ui.reload();
  await ui.waitForSelector('#image-grid', { state: 'attached' });
}

test('preview actions follow the image, not its position, when the grid re-sorts', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([
    { src: b + 'photo.png', width: 30, height: 20 },
    { src: b + 'wide.png', width: 40, height: 20 },
  ]), base);
  await ui.evaluate((b) => openPreview(b + 'wide.png'), base);
  // A late probe makes photo.png the largest image: the pixel sort puts it first.
  await ui.evaluate((b) => { const img = state.images.find((i) => i.src === b + 'photo.png'); img.width = 3000; img.height = 2000; updateDerived(img); applyFilters(); }, base);
  assert.equal(await ui.evaluate(() => state.filtered[0].src.split('/').pop()), 'photo.png');
  assert.equal(await ui.evaluate(() => currentPreview().src.split('/').pop()), 'wide.png');
  assert.match(await ui.textContent('#preview-meta'), /2\/2/);
  await ui.evaluate(() => closePreview());
});

test('the preview dialog keeps focus inside and makes the background inert', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([{ src: b + 'photo.png', width: 30, height: 20 }]), base);
  await ui.evaluate((b) => openPreview(b + 'photo.png'), base);
  assert.equal(await ui.evaluate(() => document.querySelector('.views').hasAttribute('inert')), true);
  for (let i = 0; i < 12; i++) await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.getElementById('preview-modal').contains(document.activeElement)), true);
  await ui.keyboard.press('Escape');
  assert.equal(await ui.evaluate(() => document.querySelector('.views').hasAttribute('inert')), false);
});

test('tabs follow the WAI-ARIA pattern (roving tabindex, arrow keys)', async () => {
  await freshPanel();
  await ui.focus('#tab-btn-images');
  await ui.keyboard.press('ArrowRight');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-tools');
  assert.equal(await ui.getAttribute('#tab-btn-tools', 'aria-selected'), 'true');
  assert.deepEqual(await ui.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.tabIndex)), [-1, 0, -1]);
  await ui.keyboard.press('End');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-settings');
  await ui.keyboard.press('Home');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-images');
});

test('quick successive setting changes are all kept', async () => {
  await freshPanel();
  await ui.evaluate(() => Promise.all([saveSettings({ defaultQuality: 61 }), saveSettings({ theme: 'dark' }), saveSettings({ zipDefault: true })]));
  const stored = await ui.evaluate(() => chrome.storage.sync.get('settings').then((r) => r.settings));
  assert.equal(stored.defaultQuality, 61);
  assert.equal(stored.theme, 'dark');
  assert.equal(stored.zipDefault, true);
  await ui.evaluate(() => saveSettings({ theme: 'auto', zipDefault: false }));
});

test('a slow earlier source in Tools never overwrites the newer one', async () => {
  await freshPanel();
  await ui.evaluate((b) => { setToolSource(b + 'photo.png?delay=900', 'slow'); return setToolSource(b + 'wide.png', 'fast'); }, base);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await ui.textContent('#tool-preview-name'), 'fast');
  assert.equal(await ui.inputValue('#resize-url-w'), '40');
  assert.equal(await ui.evaluate(() => state.tool.src.split('/').pop()), 'wide.png');
});

test('local files over the size limit are refused before being read', async () => {
  await freshPanel();
  await ui.evaluate(() => loadToolFile(new File([new Uint8Array(ITK.MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' })));
  assert.match(await ui.textContent('#toasts'), /40/);
  assert.equal(await ui.isHidden('#tool-preview'), true);
});

test('the format advisor in one window does not cancel another window', async () => {
  const other = await ctx.newPage();
  await other.goto(`chrome-extension://${id}/popup.html`);
  const [a, b] = await Promise.all([
    ui.evaluate((u) => chrome.runtime.sendMessage({ action: 'analyzeFormats', imageUrl: u }), base + 'photo.png?delay=300'),
    other.evaluate((u) => chrome.runtime.sendMessage({ action: 'analyzeFormats', imageUrl: u }), base + 'wide.png'),
  ]);
  assert.ok(a.results?.length === 3 && !a.superseded, JSON.stringify(a));
  assert.ok(b.results?.length === 3 && !b.superseded, JSON.stringify(b));
  await other.close();
});

test('hotlink-protected images still get their dimensions', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([{ src: b + 'hotlink.png', width: 0, height: 0 }]), base);
  const dims = await waitFor(() => ui.evaluate(() => (state.images[0].width ? [state.images[0].width, state.images[0].height] : null)), 10000);
  assert.deepEqual(dims, [40, 20]);
});

test('a download without Content-Length stops at the size cap', async () => {
  const r = await send({ action: 'fetchAsDataUrl', imageUrl: base + 'huge' });
  assert.match(r.error, /too large/i);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(hugeBytesSent < 80 * 1024 * 1024, `server pushed ${hugeBytesSent} bytes`);
});

test('closing Save As for a ZIP ends quietly instead of reporting success', async () => {
  await freshPanel();
  await ui.evaluate((b) => {
    // Simulate the user closing the Save As dialog.
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, callback) => (message?.action === 'downloadBlob' ? callback({ cancelled: true }) : original(message, callback));
    setImages([{ src: b + 'photo.png', width: 30, height: 20 }]);
    toggleSelectAll();
  }, base);
  await ui.evaluate(() => batchDownload(true));
  assert.equal(await ui.textContent('#toasts'), '');
  assert.equal(await ui.isHidden('#batch-progress'), true);
});

test('Shift-click ranges use the anchor image, not a stale position', async () => {
  await freshPanel();
  await ui.evaluate((b) => {
    setImages(['anim.gif', 'logo.svg', 'photo.png', 'wide.png', 'noext'].map((n, i) => ({ src: b + n, width: 10 * (5 - i), height: 10 })));
    state.sort = 'position';
    applyFilters();
    const byName = (n) => state.images.find((i) => i.src === b + n);
    selectFromClick(byName('noext'), false);          // anchor at the end
    document.getElementById('filter-type').value = 'png';
    applyFilters();                                  // only photo.png and wide.png remain (noext is 'other')
    state.selected.clear();
    selectFromClick(byName('wide.png'), true);       // anchor is gone: acts as a plain click
  }, base);
  assert.deepEqual(await ui.evaluate(() => [...state.selected].map((s) => s.split('/').pop())), ['wide.png']);
});

test('editor: "Custom" after a fixed preset lets the output follow the crop again', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  await editor.click('[data-preset="1080x1080"]');
  assert.equal(await editor.inputValue('#out-w'), '1080');
  await editor.click('[data-preset="custom"]');
  await editor.evaluate(() => editor.cropper.setData({ x: 0, y: 0, width: 32, height: 18 }));
  const out = [await editor.inputValue('#out-w'), await editor.inputValue('#out-h')].map(Number);
  assert.ok(Math.abs(out[0] / out[1] - 32 / 18) < 0.1, `output ${out} does not follow crop 32×18`);
  await editor.close();
});
