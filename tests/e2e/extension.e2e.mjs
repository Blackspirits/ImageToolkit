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

// Opaque PNG with a small fully transparent square (an alpha detail a sampled check misses).
function pngWithHole(size, hole) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * stride + 1 + x * 4;
      const inHole = x >= hole.x && x < hole.x + hole.size && y >= hole.y && y < hole.y + hole.size;
      raw[p] = 200; raw[p + 1] = 60; raw[p + 2] = 40; raw[p + 3] = inHole ? 0 : 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const MiB = 1024 * 1024;

const FIXTURES = {
  'anim.gif': Buffer.from('R0lGODlhAQABAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJCgAAACwAAAAAAQABAAACAkQBACH5BAkKAAAALAAAAAABAAEAAAICTAEAOw==', 'base64'),
  'logo.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'),
  'photo.png': png(30, 20),
  'wide.png': png(40, 20, [0, 128, 255, 255]),
  'noext': png(8, 8),
  // Mislabelled responses: an SVG sent as text/plain, and an HTML error page behind a .jpg URL.
  'plain.svg': Buffer.from('<?xml version="1.0"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'),
  'fake.jpg': Buffer.from('<!doctype html><title>Not found</title><p>Sorry'),
  // Icons painted by the page: currentColor (red from <body>), a CSS-class fill (green), a
  // Material-style icon whose viewBox is 960 units but which renders at 24 px, and a hidden
  // sprite sheet (not an image).
  'icons.html': Buffer.from('<!doctype html><title>i</title><style>.ic{fill:#00ff00}.mat{width:24px;height:24px}</style><body style="color:rgb(255,0,0)">'
    + '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>'
    + '<svg class="ic" viewBox="0 0 24 24" width="24" height="24"><path d="M0 0h24v24H0z"/></svg>'
    + '<svg id="mat" class="mat" viewBox="0 -960 960 960"><path fill="#333" d="M0 -960h960v960H0z"/></svg>'
    + '<svg style="display:none"><symbol id="s" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></symbol></svg></body>'),
  // Inline images built in the page: one larger than a scan item, then enough to pass the
  // scan's total budget.
  'heavy.html': Buffer.from('<!doctype html><title>h</title><body><script>'
    + 'const add=(mb,i)=>{const img=new Image();img.alt="h"+i;img.src="data:image/png;base64,"+String.fromCharCode(65+i).repeat(mb*1024*1024);document.body.append(img)};'
    + 'add(9,0);for(let i=1;i<=5;i++)add(6,i);</script></body>'),
  'holey.png': pngWithHole(2000, { x: 1000, y: 700, size: 4 }),
  'page.html': Buffer.from('<!doctype html><title>t</title><body><img src="anim.gif"><img src="logo.svg"><img src="photo.png" srcset="photo.png 1x, wide.png 2x"><div style="position:fixed;inset:0 auto auto 0;width:50px;height:50px;background:url(wide.png)"></div><a href="javascript:alert(1)//x.png">x</a></body>'),
  // Right-click targets: every way a page can show an image the context menu may be used on.
  // The page also builds a data: and a blob: copy of a PNG with its own script.
  'mislabel.png': png(16, 16, [0, 160, 0, 255]),
  'typed': png(12, 12, [160, 0, 160, 255]),
  'menu.html': Buffer.from('<!doctype html><title>m</title><body>'
    + '<img id="png" src="wide.png"><img id="jpg" src="photo.jpg"><img id="typed" src="typed"><img id="octet" src="noext">'
    + '<img id="mislabel" src="mislabel.png"><img id="cookie" src="auth/cookie.png"><img id="referer" src="ref/guard.png">'
    + '<img id="data"><img id="blob"><script>fetch("wide.png").then((r) => r.blob()).then((b) => {'
    + 'document.getElementById("blob").src = URL.createObjectURL(b);'
    + 'const fr = new FileReader(); fr.onload = () => { document.getElementById("data").src = fr.result; }; fr.readAsDataURL(b); });</script></body>'),
};
const TYPES = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', html: 'text/html' };
const TYPE_OVERRIDES = { 'plain.svg': 'text/plain', 'fake.jpg': 'text/html', 'mislabel.png': 'text/plain', typed: 'image/png' };

let server, base, ctx, sw, id, ui;
const hits = new Map(); // GET requests per path, to check that work is not repeated
const fetchHits = new Map(); // the same, without <img> loads (grid thumbnails): extension fetches only
let hugeBytesSent = 0;   // bytes the "huge" endpoint managed to push before the client hung up
const traffic = { nolenBytes: 0, nolenGets: 0, hotBytes: 0, hotGets: 0 };

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
    if (req.method === 'GET' && req.headers['sec-fetch-dest'] !== 'image') fetchHits.set(name, (fetchHits.get(name) || 0) + 1);

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
    // 1 MiB images whose server never says how big they are (no Content-Length, no ranges).
    if (name.startsWith('nolen/')) {
      // A 1-byte range answer whose total is unknown ("bytes 0-0/*"): no size from headers.
      if (req.headers.range) {
        res.writeHead(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-0/*', 'cache-control': 'no-store' });
        res.write(Buffer.alloc(1));
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      if (req.method === 'HEAD') { res.end(); return; }
      traffic.nolenGets++;
      const chunk = Buffer.alloc(64 * 1024);
      let left = 16;
      const pump = () => {
        while (!res.destroyed && left > 0) {
          left--;
          traffic.nolenBytes += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      res.on('close', () => res.destroy());
      pump();
      return;
    }
    // Hotlink-protected 1 MiB images: <img> loads are refused, extension fetches are served.
    if (name.startsWith('hot/')) {
      if (req.headers['sec-fetch-dest'] === 'image') { res.writeHead(403); res.end(); return; }
      const body = Buffer.concat([FIXTURES['wide.png'], Buffer.alloc(MiB - FIXTURES['wide.png'].length)]);
      // Only whole-body downloads count (size probes use HEAD / 1-byte ranges).
      if (req.method === 'GET' && !req.headers.range) { traffic.hotGets++; traffic.hotBytes += body.length; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'content-length': body.length });
      res.end(body);
      return;
    }
    // Needs the session cookie, like an image behind a login.
    if (name === 'auth/cookie.png') {
      if (!/(?:^|;\s*)itk=1(?:;|$)/.test(req.headers.cookie || '')) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(FIXTURES['wide.png']);
      return;
    }
    // Classic anti-hotlink rule: only requests whose Referer is this site get the image.
    if (name === 'ref/guard.png') {
      if (!(req.headers.referer || '').startsWith(base)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(FIXTURES['wide.png']);
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
  for (const imageUrl of ['file:///etc/hostname', `blob:chrome-extension://${id}/x`, 'javascript:alert(1)//x.png', 'chrome://version']) {
    const r = await send({ action: 'fetchAsDataUrl', imageUrl });
    assert.match(r.error, /Unsupported/, imageUrl);
  }
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

test('inline SVG icons keep the colours the page paints them with', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'icons.html');
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'icons.html');
  const { images } = await send({ action: 'collectImages', tabId });
  const svgs = images.filter((i) => i.src.startsWith('data:image/svg+xml'))
    .map((i) => Buffer.from(i.src.split(',')[1], 'base64').toString('utf8'));
  assert.equal(svgs.length, 3);
  assert.ok(svgs.some((m) => /color:\s*rgb\(255, 0, 0\)/.test(m)), 'currentColor icon lost its colour');
  assert.ok(svgs.some((m) => m.includes('fill="rgb(0, 255, 0)"')), 'CSS fill was not kept');
  await page.close();
});

test('the "new images" banner counts only images the panel has not seen', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  await ui.evaluate(() => {
    window.__newImages = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m.action === 'newImagesAvailable') window.__newImages += m.count; });
  });
  await send({ action: 'collectImages', tabId });
  await page.evaluate((base) => {
    // Re-renders of known images, then one image the panel has never seen (twice).
    document.body.append(document.querySelector('img').cloneNode(true));
    document.querySelector('img[src="photo.png"]').setAttribute('src', 'photo.png');
    for (let i = 0; i < 2; i++) { const img = new Image(); img.src = base + 'noext'; document.body.append(img); }
  }, base);
  await waitFor(() => ui.evaluate(() => window.__newImages > 0));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await ui.evaluate(() => window.__newImages), 1);
  await page.close();
});

test('editor: crop and output sizes use the same rounding', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const [data, shown] = await editor.evaluate(async () => {
    editor.cropper.setData({ x: 0.6, y: 0.4, width: 20.8, height: 10.3 });
    await new Promise((r) => setTimeout(r, 50));
    const d = editor.cropper.getData(true);
    const v = (id) => Number(document.getElementById(id).value);
    return [[d.width, d.height], [v('crop-w'), v('crop-h'), v('out-w'), v('out-h')]];
  });
  assert.deepEqual(shown, [...data, ...data]);
  await editor.close();
});

// ---------- Release hardening ----------
const countDownloadsAll = () => sw.evaluate(() => chrome.downloads.search({}).then((d) => d.length));
const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u })).at(0).id, url);

test('scan payload is bounded: an oversized inline image is skipped and the total stays in budget', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'heavy.html');
  const { images, truncated } = await send({ action: 'collectImages', tabId: await tabIdOf(base + 'heavy.html') });
  const inline = images.filter((i) => i.src.startsWith('data:'));
  const limits = await ui.evaluate(() => ({ item: ITK.SCAN_MAX_ITEM_CHARS, total: ITK.SCAN_MAX_TOTAL_CHARS }));
  assert.equal(truncated, true);
  assert.ok(!inline.some((i) => i.alt === 'h0'), 'the 9 MiB image is larger than one scan item');
  assert.ok(inline.every((i) => i.src.length <= limits.item));
  assert.ok(inline.reduce((n, i) => n + i.src.length, 0) <= limits.total);
  assert.ok(inline.length >= 3 && inline.length < 5, `kept ${inline.length} of the 6 MiB images`);
  await page.close();
});

test('size probing has one byte budget for all images of a request', async () => {
  traffic.nolenBytes = 0; traffic.nolenGets = 0;
  const urls = Array.from({ length: 60 }, (_, i) => `${base}nolen/${i}.png`);
  const sizes = await send({ action: 'probeImageSizes', urls });
  // Without the budget every body would be read: 60 GETs, 60 MiB.
  assert.ok(traffic.nolenBytes < 20 * MiB, `read ${(traffic.nolenBytes / MiB).toFixed(1)} MiB`);
  assert.ok(traffic.nolenGets < 30, `${traffic.nolenGets} body downloads`);
  assert.ok(Object.values(sizes).every((v) => v === MiB), 'sizes that were measured are right');
});

test('hotlink fallback for previews and dimensions has a per-scan budget, reset by a new scan', async () => {
  // The panel's own first scan must be over, or it would reset the budget mid-test.
  await waitFor(() => ui.evaluate(() => document.getElementById('grid-loading').hidden));
  traffic.hotBytes = 0; traffic.hotGets = 0;
  await ui.evaluate((b) => {
    resetViaExtension();
    // Known file sizes: no size probes, so every whole-body GET is a preview/dimension fallback.
    setImages(Array.from({ length: 80 }, (_, i) => ({ src: `${b}hot/${i}.png`, width: 0, height: 0, fileSize: 1 })));
  }, base);
  const limits = await ui.evaluate(() => ({ ...LIMITS }));
  // Settled = the budget is spent, or nothing new for 2 s.
  let last = -1, since = Date.now();
  await waitFor(async () => {
    if (traffic.hotGets !== last) { last = traffic.hotGets; since = Date.now(); }
    return traffic.hotGets >= limits.fallbackFetches || (last > 0 && Date.now() - since > 2000);
  }, 30000);
  await new Promise((r) => setTimeout(r, 1500)); // anything over budget would arrive now
  assert.ok(traffic.hotGets <= limits.fallbackFetches, `${traffic.hotGets} fallback downloads`);
  assert.ok(traffic.hotBytes <= limits.fallbackBytes, `${(traffic.hotBytes / MiB).toFixed(1)} MiB`);
  assert.equal(await ui.evaluate(() => viaExtensionBudget.fetches <= 0 || viaExtensionBudget.bytes <= 0), true);
  await ui.evaluate(() => { resetViaExtension(); setImages([]); });
  assert.equal(await ui.evaluate(() => viaExtension.size), 0);
});

test('the preview byte budget is reserved up front: concurrent downloads never exceed it', async () => {
  await waitFor(() => ui.evaluate(() => document.getElementById('grid-loading').hidden));
  traffic.hotBytes = 0; traffic.hotGets = 0;
  // 3 MiB in total, 1 MiB per download, 1 MiB images and 4 downloads in parallel: without a
  // reservation, four start against the same untouched 3 MiB.
  await ui.evaluate((b) => {
    Object.assign(LIMITS, { fallbackBytes: 3 * 1024 * 1024, fallbackItemBytes: 1024 * 1024 });
    resetViaExtension();
    setImages(Array.from({ length: 12 }, (_, i) => ({ src: `${b}hot/r${i}.png`, width: 0, height: 0, fileSize: 1 })));
  }, base);
  let last = -1, since = Date.now();
  await waitFor(async () => {
    if (traffic.hotGets !== last) { last = traffic.hotGets; since = Date.now(); }
    return last > 0 && Date.now() - since > 2000;
  }, 30000);
  assert.ok(traffic.hotBytes <= 3 * MiB, `${(traffic.hotBytes / MiB).toFixed(1)} MiB downloaded`);
  assert.equal(traffic.hotGets, 3);
  await ui.evaluate(() => {
    Object.assign(LIMITS, { fallbackBytes: 48 * 1024 * 1024, fallbackItemBytes: 8 * 1024 * 1024 });
    resetViaExtension();
    setImages([]);
  });
});

test('ZIP refuses an oversized selection before and during the batch, with no download', async () => {
  const before = await countDownloadsAll();
  await ui.evaluate((b) => {
    LIMITS.zipBytes = 50; // smaller than the first file
    document.getElementById('toasts').replaceChildren();
    switchTab('images');
    setImages(['photo.png', 'wide.png', 'anim.gif'].map((n) => ({ src: b + n, width: 10, height: 10, fileSize: 0 })));
    state.images.forEach((i) => state.selected.add(i.src));
  }, base);
  await ui.evaluate(() => batchDownload(true));
  assert.match(await ui.textContent('#toasts'), /ZIP/);
  // Known sizes already over the limit: refused without processing anything. Grid thumbnails
  // of the same URLs may still be loading, so only the extension's own fetches count.
  const processed = fetchHits.get('photo.png') || 0;
  await ui.evaluate(() => { document.getElementById('toasts').replaceChildren(); state.images.forEach((i) => { i.fileSize = 1000; }); return batchDownload(true); });
  assert.match(await ui.textContent('#toasts'), /ZIP/);
  assert.equal(fetchHits.get('photo.png') || 0, processed);
  assert.equal(await countDownloadsAll(), before);
  await ui.evaluate(() => { LIMITS.zipBytes = 256 * 1024 * 1024; state.selected.clear(); setImages([]); });
});

test('large outputs skip the base64 message and still download completely', async () => {
  const result = await ui.evaluate(async () => {
    const small = await ITK.ui.saveBlob(new Blob([new Uint8Array(1024)], { type: 'application/zip' }), 'small-test.zip', false);
    const big = await ITK.ui.saveBlob(new Blob([new Uint8Array(37 * 1024 * 1024)], { type: 'application/zip' }), 'big-test.zip', false);
    return { small: small.via, big: big.via, id: big.downloadId };
  });
  assert.deepEqual([result.small, result.big], ['data', 'blob']);
  const item = await waitFor(() => sw.evaluate(async (id) => {
    const [d] = await chrome.downloads.search({ id });
    return d && d.state !== 'in_progress' ? d : null;
  }, result.id), 20000);
  assert.equal(item.state, 'complete');
  assert.equal(item.fileSize, 37 * MiB);
});

test('a 24 px icon with a 960-unit viewBox is 24×24, not 960×960, and is not "large"', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'icons.html');
  const { images } = await send({ action: 'collectImages', tabId: await tabIdOf(base + 'icons.html') });
  const svgs = images.filter((i) => i.src.startsWith('data:image/svg+xml'));
  assert.equal(svgs.length, 3, 'three visible icons; the hidden sprite sheet is not an image');
  assert.ok(svgs.every((i) => i.width === 24 && i.height === 24), JSON.stringify(svgs.map((i) => [i.width, i.height])));
  const material = svgs.find((i) => Buffer.from(i.src.split(',')[1], 'base64').toString().includes('-960'));
  assert.match(Buffer.from(material.src.split(',')[1], 'base64').toString(), /width="24" height="24"/);
  const inLarge = await ui.evaluate((list) => {
    setImages(list);
    document.getElementById('filter-size').value = 'large';
    applyFilters();
    const n = state.filtered.length;
    document.getElementById('filter-size').value = 'all';
    applyFilters();
    setImages([]);
    return n;
  }, svgs);
  assert.equal(inLarge, 0);
  await page.close();
});

test('sizes over the limit are refused at the privileged boundary, with zero downloads', async () => {
  const before = await countDownloadsAll();
  const saved = await send({ action: 'processAndSave', imageUrl: base + 'photo.png', instructions: { format: 'png', width: 20000, saveAs: false, silent: true } });
  assert.match(saved.error || '', /too large/);
  const cropped = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'png', cropWidth: 20000, cropHeight: 500 } });
  assert.match(cropped.error || '', /too large/);
  assert.equal(await countDownloadsAll(), before);
});

test('editor: a manual output size follows the crop shape and the canvas matches the fields', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const run = (steps) => editor.evaluate(async (steps) => {
    const out = [];
    for (const step of steps) {
      if (step.crop) editor.cropper.setData(step.crop);
      if (step.preset) document.querySelector(`[data-preset="${step.preset}"]`).click();
      if (step.unlock) document.getElementById('btn-lock').click();
      if (step.type) { const f = document.getElementById(step.type[0]); f.value = String(step.type[1]); f.dispatchEvent(new Event('input')); }
      await new Promise((r) => setTimeout(r, 30));
    }
    const shown = [+document.getElementById('out-w').value, +document.getElementById('out-h').value];
    const canvas = croppedCanvas('png');
    out.push(shown, [canvas.width, canvas.height]);
    return out;
  }, steps);
  // Typed width, then a square crop: the height follows, and the file is exactly that size.
  let [shown, canvas] = await run([{ crop: { x: 0, y: 0, width: 32, height: 18 } }, { type: ['out-w', 16] }, { crop: { x: 0, y: 0, width: 20, height: 20 } }]);
  assert.deepEqual(shown, [16, 16]);
  assert.deepEqual(canvas, shown);
  // Typed height keeps the height.
  [shown, canvas] = await run([{ type: ['out-h', 10] }, { crop: { x: 0, y: 0, width: 40, height: 20 } }]);
  assert.deepEqual(shown, [20, 10]);
  assert.deepEqual(canvas, shown);
  // Fixed preset, then unlock and reshape the crop: width kept, height follows, no stretch.
  [shown, canvas] = await run([{ preset: '1080x1080' }, { unlock: true }, { crop: { x: 0, y: 0, width: 40, height: 20 } }]);
  assert.deepEqual(shown, [1080, 540]);
  assert.deepEqual(canvas, shown);
  await editor.close();
});

test('area capture: a crop failure reports an error and never opens the whole screenshot', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await page.bringToFront();
  const editors = () => ctx.pages().filter((p) => p.url().includes('resize.html')).length;
  const before = editors();
  for (const rect of [{ x: 1e6, y: 1e6, width: 50, height: 50 }, { x: 0, y: 0, width: NaN, height: 10 }]) {
    const result = await sw.evaluate(async ({ url, rect }) => {
      const [tab] = await chrome.tabs.query({ url });
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (r) => new Promise((resolve) => chrome.runtime.sendMessage({ action: 'captureSelection', rect: r }, resolve)),
        args: [rect],
      });
      return injection.result;
    }, { url: base + 'page.html', rect });
    assert.ok(result?.error, JSON.stringify(result));
  }
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(editors(), before);
  await page.close();
});

test('upgrade: the 2.3.5 editor hand-off key is removed, idempotently', async () => {
  const left = await sw.evaluate(async () => {
    await chrome.storage.local.set({ _resizeImageUrl: 'data:image/png;base64,AAAA', keep: 1 });
    await cleanupLegacyStorage();
    await cleanupLegacyStorage();
    const r = await chrome.storage.local.get(null);
    await chrome.storage.local.remove('keep');
    return r;
  });
  assert.equal(left._resizeImageUrl, undefined);
  assert.equal(left.keep, 1);
});

test('advisor: a new source hides the previous figures at once and the old answer never shows', async () => {
  await ui.evaluate(() => switchTab('tools'));
  await ui.evaluate((u) => setToolSource(u, 'a.png'), base + 'photo.png?delay=600');
  await waitFor(() => ui.evaluate(() => !document.getElementById('format-advisor').hidden));
  // B loads slowly, so its own analysis starts late; A must already be gone.
  ui.evaluate((u) => setToolSource(u, 'b.png'), base + 'wide.png?delay=1500');
  await new Promise((r) => setTimeout(r, 50));
  const midway = await ui.evaluate(() => ({ hidden: document.getElementById('format-advisor').hidden, bars: document.getElementById('advisor-sizes').children.length }));
  assert.deepEqual(midway, { hidden: true, bars: 0 });
  await new Promise((r) => setTimeout(r, 900)); // A's analysis would have finished by now
  assert.equal(await ui.evaluate(() => document.getElementById('advisor-sizes').children.length), 0);
  await waitFor(() => ui.evaluate(() => document.getElementById('advisor-sizes').children.length > 0), 15000);
  await ui.evaluate(() => clearToolSource());
});

test('radio groups: named, one Tab stop, arrows change the option', async () => {
  await ui.evaluate(() => switchTab('tools'));
  const info = await ui.evaluate(async () => {
    const group = document.getElementById('convert-format');
    const label = document.getElementById(group.getAttribute('aria-labelledby'))?.textContent.trim();
    const stops = () => [...group.querySelectorAll('[role="radio"]')].filter((r) => r.tabIndex === 0).map((r) => r.dataset.value);
    const before = stops();
    group.querySelector('[tabindex="0"]').focus();
    return { label, before };
  });
  assert.ok(info.label);
  assert.equal(info.before.length, 1);
  await ui.keyboard.press('ArrowRight');
  const after = await ui.evaluate(() => {
    const group = document.getElementById('convert-format');
    const checked = [...group.querySelectorAll('[aria-checked="true"]')].map((r) => r.dataset.value);
    return { checked, focused: document.activeElement.dataset.value, stops: [...group.querySelectorAll('[tabindex="0"]')].length };
  });
  assert.equal(after.checked.length, 1);
  assert.equal(after.focused, after.checked[0]);
  assert.notEqual(after.checked[0], info.before[0]);
  assert.equal(after.stops, 1);
});

test('the image grid is one Tab stop with arrow-key navigation inside it', async () => {
  await ui.evaluate((b) => { switchTab('images'); setImages(Array.from({ length: 60 }, (_, i) => ({ src: `${b}photo.png?n=${i}`, width: 30, height: 20 }))); }, base);
  const stops = await ui.evaluate(() => [...document.querySelectorAll('#image-grid [tabindex]')].filter((n) => n.tabIndex >= 0).length);
  assert.equal(stops, 1);
  await ui.evaluate(() => document.querySelector('#image-grid .gcard[tabindex="0"]').focus());
  await ui.keyboard.press('ArrowRight');
  const moved = await ui.evaluate(() => ({ idx: [...document.getElementById('image-grid').children].indexOf(document.activeElement), stops: document.querySelectorAll('#image-grid [tabindex="0"]').length }));
  assert.deepEqual(moved, { idx: 1, stops: 1 });
  await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.getElementById('image-grid').contains(document.activeElement)), false);
  await ui.evaluate(() => setImages([]));
});

test('live observer: inline SVG, inline-style backgrounds and <picture> sources count as new', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await tabIdOf(base + 'page.html');
  await ui.evaluate(() => {
    window.__observed = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m.action === 'newImagesAvailable') window.__observed += m.count; });
  });
  await send({ action: 'collectImages', tabId });
  await page.evaluate((b) => {
    document.body.insertAdjacentHTML('beforeend',
      '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="teal"/></svg>'
      + `<div style="width:40px;height:40px;background-image:url(${b}hotlink.png)"></div>`
      + `<picture><source srcset="${b}noext"><img src="${b}photo.png"></picture>`);
  }, base);
  await waitFor(() => ui.evaluate(() => window.__observed > 0));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await ui.evaluate(() => window.__observed), 3);
  await page.close();
});

test('transparency in a small area of a large image is detected', async () => {
  const holey = await send({ action: 'analyzeFormats', imageUrl: base + 'holey.png' });
  assert.equal(holey.hasAlpha, true);
  const opaque = await send({ action: 'analyzeFormats', imageUrl: base + 'photo.png' });
  assert.equal(opaque.hasAlpha, false);
});

// ---------- Context menu: "Save as PNG/JPG/WebP/AVIF" ----------
// The native menu cannot be clicked headless, so the real onClicked listener is dispatched
// with the info Chrome would pass (srcUrl = the image's current URL). Save As is turned off
// because a file dialog cannot be answered headless.
let menuPage;
async function openMenuPage() {
  if (menuPage) return menuPage;
  FIXTURES['photo.jpg'] = Buffer.from((await ui.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 48; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#0080ff'; g.fillRect(0, 0, 48, 32);
    return c.toDataURL('image/jpeg', 0.9);
  })).split(',')[1], 'base64');
  await ctx.addCookies([{ name: 'itk', value: '1', url: base }]);
  menuPage = await ctx.newPage();
  await menuPage.goto(base + 'menu.html');
  await menuPage.waitForFunction(() => [...document.images].every((im) => im.complete && im.naturalWidth > 0));
  return menuPage;
}

const MAGIC = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

async function saveFromMenu(imageId, fmt) {
  const page = await openMenuPage();
  const srcUrl = await page.evaluate((i) => document.getElementById(i).currentSrc, imageId);
  return sw.evaluate(async ({ srcUrl, fmt, pageUrl }) => {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, saveAs: false, showNotification: true } });
    const create = chrome.notifications.create;
    const notes = [];
    chrome.notifications.create = (...args) => { notes.push(args.find((a) => a && typeof a === 'object').message); };
    const known = new Set((await chrome.downloads.search({})).map((d) => d.id));
    try {
      const [tab] = await chrome.tabs.query({ url: pageUrl });
      chrome.contextMenus.onClicked.dispatch({ menuItemId: `save-as-${fmt}`, srcUrl, mediaType: 'image', pageUrl, frameId: 0 }, tab);
      for (let i = 0; i < 100; i++) {
        const d = (await chrome.downloads.search({})).find((x) => !known.has(x.id) && x.state !== 'in_progress');
        if (d) return { srcUrl, notes, download: { path: d.filename, state: d.state, error: d.error || null, mime: d.mime } };
        if (notes.length && !notes.some((n) => /→/.test(n))) return { srcUrl, notes, download: null };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { srcUrl, notes, download: null };
    } finally {
      chrome.notifications.create = create;
      await chrome.storage.sync.set({ settings });
    }
  }, { srcUrl, fmt, pageUrl: base + 'menu.html' });
}

async function assertSaved(imageId, fmt, produced) {
  const r = await saveFromMenu(imageId, fmt);
  assert.ok(r.download, `${imageId} → ${fmt}: no download (${r.srcUrl.slice(0, 40)}): ${JSON.stringify(r.notes)}`);
  assert.equal(r.download.state, 'complete', JSON.stringify(r.download));
  const bytes = fs.readFileSync(r.download.path);
  assert.ok(MAGIC[produced](bytes), `${imageId} → ${fmt}: the file is not ${produced}`);
  assert.ok(!r.notes.some((n) => /fail/i.test(n)), JSON.stringify(r.notes));
}

test('context menu: HTTP PNG → JPG', () => assertSaved('png', 'jpg', 'jpeg'));
test('context menu: PNG → PNG', () => assertSaved('png', 'png', 'png'));
test('context menu: PNG → WebP', () => assertSaved('png', 'webp', 'webp'));
test('context menu: PNG → AVIF falls back to a real WebP file', () => assertSaved('png', 'avif', 'webp'));
test('context menu: JPEG → PNG', () => assertSaved('jpg', 'png', 'png'));
test('context menu: data:image/png → JPG', () => assertSaved('data', 'jpg', 'jpeg'));
test('context menu: an image that needs the site cookie → JPG', () => assertSaved('cookie', 'jpg', 'jpeg'));
test('context menu: URL without extension but an image MIME → JPG', () => assertSaved('typed', 'jpg', 'jpeg'));
test('context menu: PNG served as application/octet-stream → JPG', () => assertSaved('octet', 'jpg', 'jpeg'));
test('context menu: PNG served as text/plain → JPG', () => assertSaved('mislabel', 'jpg', 'jpeg'));

// Images a page builds with its own script have a blob: URL; the extension can read it.
test('context menu: a blob: image created by the page → JPG', async () => {
  const page = await openMenuPage();
  assert.match(await page.evaluate(() => document.getElementById('blob').currentSrc), /^blob:http:\/\//);
  await assertSaved('blob', 'jpg', 'jpeg');
});

test('blob: images also copy and open in the editor (same fetch path)', async () => {
  const page = await openMenuPage();
  const blobUrl = await page.evaluate(() => document.getElementById('blob').currentSrc);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await page.bringToFront();
  const copied = await sw.evaluate(async ({ url, image }) => {
    const [tab] = await chrome.tabs.query({ url });
    return copyImageUrl(image, tab.id, { showNotification: false });
  }, { url: base + 'menu.html', image: blobUrl });
  assert.deepEqual(copied, { success: true });
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  // The editor loads its source through this message.
  const r = await send({ action: 'fetchAsDataUrl', imageUrl: blobUrl });
  assert.match(r.dataUrl || '', /^data:image\/png;base64,/, JSON.stringify(r).slice(0, 120));
  assert.equal(r.size, FIXTURES['wide.png'].length);
});

// Known limitation (same in 2.3.5): the extension's request carries no Referer, so a
// Referer-based hotlink rule refuses it. It must fail clearly and save nothing.
test('context menu: a Referer-protected image fails with a clear error and no file', async () => {
  const r = await saveFromMenu('referer', 'jpg');
  assert.equal(r.download, null);
  assert.ok(r.notes.some((n) => /HTTP 403/.test(n)), JSON.stringify(r.notes));
});
